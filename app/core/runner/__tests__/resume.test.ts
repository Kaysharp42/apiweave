import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { RunScheduler, type SchedulerDeps } from "../scheduler"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { resumeEntries, seedResults } from "../resume"
import { startServer, type TestServer } from "./auth_test_servers"
import type { Run } from "@shared/types/Run"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowNode } from "@shared/types/WorkflowNode"

let db: InitializedDatabase
let workflows: WorkflowRepository
let runs: RunRepository
let scheduler: RunScheduler
let workspaceId: string
let api: TestServer
/** Paths the API answers 500 to, until a test clears them. */
let failing: Set<string>

beforeEach(async () => {
  db = initDatabase({ databasePath: ":memory:" })
  workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
  workspaceId = new WorkspaceRepository(db.kvStore).create({ name: "Local", slug: "local" }).workspaceId
  failing = new Set()
  api = await startServer((request, response) => {
    const path = request.url.split("?")[0]!
    if (failing.has(path)) return void response.writeHead(500).end()
    const body = path === "/login"
      ? { id: 42, token: "tok-abcdef-123", echo: request.headers["x-key"] ?? null }
      : { path, query: request.url.split("?")[1] ?? "", auth: request.headers["authorization"] ?? null }
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body))
  })
  scheduler = makeScheduler()
})

afterEach(async () => {
  await scheduler.shutdown(500)
  await api.close()
  db.close()
})

function makeScheduler(overrides: Partial<SchedulerDeps> = {}): RunScheduler {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new RunScheduler({
    runs, workflows, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng), clock, rng,
    resolveSecret: async () => ({ plaintext: "key-value-9876", scopeType: "workspace" }),
    ...overrides,
  })
}

const http = (nodeId: string, path: string, extra: Record<string, unknown> = {}): WorkflowNode =>
  ({ nodeId, type: "http-request", position: { x: 0, y: 0 }, config: { method: "GET", url: `${api.base}${path}`, ...extra } }) as WorkflowNode
const node = (nodeId: string, type: string, config?: Record<string, unknown>): WorkflowNode =>
  ({ nodeId, type, position: { x: 0, y: 0 }, ...(config ? { config } : {}) }) as WorkflowNode
const edge = (source: string, target: string): WorkflowEdge => ({ edgeId: `${source}-${target}`, source, target })

function linearWorkflow(...steps: WorkflowNode[]): string {
  const nodes = [node("start", "start"), ...steps, node("end", "end")]
  const edges = nodes.slice(1).map((next, index) => edge(nodes[index]!.nodeId, next.nodeId))
  return workflows.create({ workspaceId, name: "wf", nodes, edges }).workflowId
}

async function run(workflowId: string, resume?: { fromRunId?: string; nodeId?: string }): Promise<Run> {
  const runId = scheduler.enqueue({ workspaceId, workflowId, ...(resume ? { resume } : {}) })
  await scheduler.whenFinished(runId)
  return runs.getById(runId)!
}

const paths = (): string[] => api.received.map((request) => request.url.split("?")[0]!)

describe("rerun from a node", () => {
  it("starts at the node, reusing the source run's results and variables upstream", async () => {
    const workflowId = linearWorkflow(
      http("login", "/login", { extractors: { userId: "body.id" } }),
      http("profile", "/users/{{variables.userId}}", { queryParams: [{ key: "from", value: "{{login.body.id}}", active: true }] }),
    )
    failing.add("/users/42")
    const source = await run(workflowId)
    expect(source.status).toBe("failed")
    expect(source.failedNodes).toEqual(["profile"])

    failing.clear()
    api.received.length = 0
    const rerun = await run(workflowId, { nodeId: "profile" })

    expect(rerun.status).toBe("completed")
    expect(paths()).toEqual(["/users/42"])
    expect(api.received[0]!.url).toBe("/users/42?from=42")
    expect(rerun.resumeFromRunId).toBe(source.runId)
    expect(rerun.resumeFromNodeIds).toEqual(["profile"])
    expect(rerun.resumeMode).toBe("single")
    // Only what this run executed is its result; the seeded login is the source run's.
    expect(rerun.results.map((result) => result.nodeId)).toEqual(["profile"])
    expect(runs.listRunSummaries(workspaceId, { workflowId }, undefined, 5).items[0]!.resumeFromRunId).toBe(source.runId)
  })

  it("defaults to the latest run, and a rerun of a rerun still has the first run's upstream results", async () => {
    const workflowId = linearWorkflow(
      http("login", "/login"),
      http("profile", "/users/{{login.body.id}}"),
      http("orders", "/orders/{{login.body.id}}"),
    )
    failing.add("/users/42")
    await run(workflowId)
    const second = await run(workflowId, { nodeId: "profile" })
    expect(second.failedNodes).toEqual(["profile"])

    failing.clear()
    api.received.length = 0
    const third = await run(workflowId, {})
    expect(third.resumeFromRunId).toBe(second.runId)
    expect(third.resumeMode).toBe("all-failed")
    expect(third.status).toBe("completed")
    expect(paths()).toEqual(["/users/42", "/orders/42"])
  })

  it("refuses a rerun that needs a variable stored masked, before sending anything", async () => {
    const workflowId = linearWorkflow(
      http("login", "/login", { extractors: { authToken: "body.token" } }),
      http("profile", "/me", { headers: [{ key: "Authorization", value: "Bearer {{variables.authToken}}", active: true }] }),
    )
    failing.add("/me")
    const source = await run(workflowId)
    expect(source.variables["authToken"]).toBe("<SECRET>")

    failing.clear()
    api.received.length = 0
    expect(() => scheduler.enqueue({ workspaceId, workflowId, resume: { nodeId: "profile" } }))
      .toThrow(/\{\{variables\.authToken\}\} is stored masked/)
    // Passed with the run, it is not needed from history.
    const given = await (async () => {
      const runId = scheduler.enqueue({ workspaceId, workflowId, resume: { nodeId: "profile" }, variables: { authToken: "tok-given-456" } })
      await scheduler.whenFinished(runId)
      return runs.getById(runId)!
    })()
    expect(given.status).toBe("completed")
    expect(api.received.map((request) => request.headers["authorization"])).toEqual(["Bearer tok-given-456"])
    api.received.length = 0
    // From the node that sets it, the token is fresh and the rerun goes ahead.
    const fromLogin = await run(workflowId, { nodeId: "login" })
    expect(fromLogin.status).toBe("completed")
    expect(api.received.find((request) => request.url === "/me")?.headers["authorization"]).toBe("Bearer tok-abcdef-123")
  })

  it("refuses at run time to send a seeded value that was masked in the source run", async () => {
    const workflowId = linearWorkflow(
      http("login", "/login", { headers: [{ key: "X-Key", value: "{{secrets.API_KEY}}", active: true }] }),
      http("echo", "/echo/{{login.body.echo}}"),
    )
    failing.add("/echo/key-value-9876")
    const source = await run(workflowId)
    expect(source.failedNodes).toEqual(["echo"])

    failing.clear()
    api.received.length = 0
    const rerun = await run(workflowId, { nodeId: "echo" })
    expect(rerun.status).toBe("failed")
    expect(api.received).toEqual([])
    expect(rerun.results[0]!.error).toBe("Not rerun: {{login.body.echo}} was masked in the source run. Rerun from node login, or run the whole workflow.")
  })

  it("rejects a node that is not a step, a run still in flight, and a run with nothing failed", async () => {
    const workflowId = linearWorkflow(http("login", "/login"))
    expect(() => scheduler.enqueue({ workspaceId, workflowId, resume: {} })).toThrow("has no run to rerun from yet")
    const passed = await run(workflowId)
    expect(() => scheduler.enqueue({ workspaceId, workflowId, resume: { nodeId: "nope" } })).toThrow("not a step")
    expect(() => scheduler.enqueue({ workspaceId, workflowId, resume: { nodeId: "start" } })).toThrow("run the whole workflow")
    expect(() => scheduler.enqueue({ workspaceId, workflowId, resume: { fromRunId: passed.runId } })).toThrow("no failed step")
  })
})

describe("rerun failed branches", () => {
  it("reruns only the failed branch, and its merge joins the seeded branch that passed", async () => {
    const nodes = [
      node("start", "start"),
      http("a", "/a"),
      http("b", "/b"),
      node("merge", "merge", { mergeStrategy: "all" }),
      http("c", "/c/{{a.body.path}}"),
      node("end", "end"),
    ]
    const edges = [edge("start", "a"), edge("start", "b"), edge("a", "merge"), edge("b", "merge"), edge("merge", "c"), edge("c", "end")]
    const workflowId = workflows.create({ workspaceId, name: "branches", nodes, edges }).workflowId
    failing.add("/b")
    const source = await run(workflowId)
    expect(source.status).toBe("failed")
    expect(source.failedNodes).toContain("b")

    failing.clear()
    api.received.length = 0
    const rerun = await run(workflowId, { fromRunId: source.runId })

    expect(rerun.status).toBe("completed")
    expect(rerun.resumeFromNodeIds).toEqual(["b"])
    expect(paths()).toEqual(["/b", "/c//a"])
    expect(rerun.results.map((result) => result.nodeId).sort()).toEqual(["b", "c", "merge"])
  })
})

describe("resume planning", () => {
  const edges = [edge("start", "a"), edge("a", "b"), edge("b", "c"), edge("start", "x")]

  it("keeps only entries no other entry reaches", () => {
    expect(resumeEntries(edges, ["c", "a", "x", "a"])).toEqual(["a", "x"])
  })

  it("seeds the newest result per node and drops what a later rerun replaced", () => {
    const result = (nodeId: string, status: "passed" | "failed", error: string | null = null) =>
      ({ nodeId, status, duration: 1, error })
    const first = { runId: "1", results: [result("a", "passed"), result("b", "failed", "first"), result("c", "passed")] } as unknown as Run
    const second = { runId: "2", resumeFromNodeIds: ["b"], results: [result("b", "passed")] } as unknown as Run
    const seeded = seedResults([second, first], edges, new Set(["x"]))
    // c ran in the first run, but downstream of b, which the second run replaced: its old result is stale.
    expect(seeded.map((entry) => [entry.nodeId, entry.status])).toEqual([["a", "passed"], ["b", "passed"]])
  })
})
