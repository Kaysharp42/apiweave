import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import { EnvironmentRepository, RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { AGENT_RUN_DENIED_ERROR, RunScheduler, requestDestinations, type AgentRunApprovalRequest, type SchedulerDeps } from "../scheduler"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { buildHtmlReport, buildJUnitReport } from "../reporters"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import type { RunEvent } from "@shared/types/RunProgressEvent"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import { startFakeOAuthServer } from "./oauth_fake_server"
import { encodeStoredToken } from "../oauth"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let runs: RunRepository
let environments: EnvironmentRepository
let activeScheduler: RunScheduler | null = null

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
  environments = new EnvironmentRepository(db.kvStore)
  activeScheduler = null
})

afterEach(async () => {
  if (activeScheduler) {
    await activeScheduler.shutdown(500)
    activeScheduler = null
  }
  db.close()
})

function makeScheduler(overrides: Partial<SchedulerDeps> = {}): RunScheduler {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  const http = new SafeHttp()
  const functions = new DynamicFunctions(clock, rng)
  const s = new RunScheduler({ runs, workflows, environments, http, functions, clock, rng, ...overrides })
  activeScheduler = s
  return s
}

function seedWorkspace(): string {
  return workspaces.create({ name: "Local", slug: `local-${Math.floor(Math.random() * 1e9)}` }).workspaceId
}

function seedWorkflow(workspaceId: string, delayMs?: number): string {
  const nodes: WorkflowNode[] = delayMs
    ? [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "delay1", type: "delay", position: { x: 1, y: 0 }, config: { duration: delayMs } as never },
        { nodeId: "end", type: "end", position: { x: 2, y: 0 } },
      ]
    : [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "end", type: "end", position: { x: 1, y: 0 } },
      ]
  const edges: WorkflowEdge[] = delayMs
    ? [
        { edgeId: "e1", source: "start", target: "delay1" },
        { edgeId: "e2", source: "delay1", target: "end" },
      ]
    : [{ edgeId: "e1", source: "start", target: "end" }]
  return workflows.create({ workspaceId, name: "test-wf", nodes, edges }).workflowId
}

describe("RunScheduler", () => {
  describe("enqueue + drain + complete", () => {
    it("completes a simple start→end workflow", async () => {
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws)
      const scheduler = makeScheduler()

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf })
      expect(runs.getById(runId)).toBeDefined()

      await new Promise((resolve) => setTimeout(resolve, 300))

      const run = runs.getById(runId)
      expect(run?.status).toBe("completed")
      expect(scheduler.getActiveCount()).toBe(0)
    })

    // Canvas-only nodes are furniture. Left in the graph the executor answers
    // them with `{ status: "skipped" }`, a row in the timeline and JUnit report
    // for something that was never a step.
    it("never schedules canvas-only nodes", async () => {
      const ws = seedWorkspace()
      const wf = workflows.create({
        workspaceId: ws,
        name: "framed-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 }, parentId: "frame" },
          { nodeId: "end", type: "end", position: { x: 1, y: 0 } },
          { nodeId: "frame", type: "group", position: { x: -20, y: -20 }, config: { width: 300, height: 200 } },
          { nodeId: "note", type: "note", position: { x: 0, y: 220 }, config: { content: "Context" } },
        ] as WorkflowNode[],
        edges: [{ edgeId: "e1", source: "start", target: "end" }] as WorkflowEdge[],
      }).workflowId
      const events: RunEvent[] = []
      const scheduler = makeScheduler({ emitProgress: (_runId, event) => events.push(event) })

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf })
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(runs.getById(runId)?.status).toBe("completed")
      expect(Object.keys(runs.getById(runId)?.nodeStatuses ?? {})).toEqual(["start", "end"])
       expect(events.filter((e) => e.kind === "node.status" && (e.nodeId === "frame" || e.nodeId === "note"))).toEqual([])
    })

    // Regression: `runs_create` echoed `selectedEnvironmentId: null` even when
    // the workflow had one set, so an MCP agent triggering a run without an
    // explicit env left `{{env.*}}` placeholders as literal text and got a
    // 401 indistinguishable from bad credentials. enqueue() now inherits the
    // workflow's stored env when the caller omits it, so the run row carries
    // what will actually run.
    it("inherits the workflow's selectedEnvironmentId when enqueue omits it", async () => {
      const ws = seedWorkspace()
      const env = environments.create({ workspaceId: ws, name: "dev", variables: {} })
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "env-default-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          { nodeId: "end", type: "end", position: { x: 1, y: 0 } },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "end" }],
        selectedEnvironmentId: env.environmentId,
      }).workflowId
      const scheduler = makeScheduler()

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      const run = runs.getById(runId)
      expect(run?.selectedEnvironmentId).toBe(env.environmentId)
    })

    it("honours an explicit null selectedEnvironmentId (does not silently inherit)", async () => {
      const ws = seedWorkspace()
      const env = environments.create({ workspaceId: ws, name: "dev", variables: {} })
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "explicit-null-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          { nodeId: "end", type: "end", position: { x: 1, y: 0 } },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "end" }],
        selectedEnvironmentId: env.environmentId,
      }).workflowId
      const scheduler = makeScheduler()

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId, selectedEnvironmentId: null })
      expect(runs.getById(runId)?.selectedEnvironmentId).toBeNull()
    })

    it("substitutes selected environment variables in HTTP request URLs", async () => {
      const ws = seedWorkspace()
      const env = environments.create({
        workspaceId: ws,
        name: "dev",
        variables: { BASE_URL: "ftp://169.254.169.254/auth?token=opaque-credential" },
      })
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "env-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "http_1",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: { method: "GET", url: "{{env.BASE_URL}}" },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
      }).workflowId
      const events: RunEvent[] = []
      const scheduler = makeScheduler({
        emitProgress: (_runId, event) => events.push(event),
      })

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId, selectedEnvironmentId: env.environmentId })

      await new Promise((resolve) => setTimeout(resolve, 300))

      const failed = events.find(
        (event) => event.kind === "node.status" && event.nodeId === "http_1" && event.status === "failed",
      )
      expect(failed).toBeDefined()
      expect(failed?.error).not.toContain("{{env.BASE_URL}}")
      expect(failed?.error).toBe("Request configuration invalid")
      const persistedRun = runs.getById(runId)
      expect(persistedRun?.results[0]).toMatchObject({
        nodeId: "http_1",
        status: "failed",
        error: "Request configuration invalid",
        request: { url: "ftp://169.254.169.254/auth?<REDACTED>" },
      })
      expect(JSON.stringify(persistedRun)).not.toContain("opaque-credential")
    })

    it("persists a completed node result before a downstream delay finishes", async () => {
      const ws = seedWorkspace()
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "live node result",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "blocked-request",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: { method: "GET", url: "ftp://169.254.169.254", continueOnFail: true },
          },
          { nodeId: "wait", type: "delay", position: { x: 2, y: 0 }, config: { duration: 1_000 } as never },
          { nodeId: "end", type: "end", position: { x: 3, y: 0 } },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "blocked-request" },
          { edgeId: "e2", source: "blocked-request", target: "wait" },
          { edgeId: "e3", source: "wait", target: "end" },
        ],
      }).workflowId
      const scheduler = makeScheduler()

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      await new Promise((resolve) => setTimeout(resolve, 200))

      const liveRun = runs.getById(runId)
      expect(liveRun?.status).toBe("running")
      expect(liveRun?.results).toContainEqual(expect.objectContaining({
        nodeId: "blocked-request",
        status: "failed",
        error: "Request configuration invalid",
      }))
    })

    it("resolves inherited variables from a base environment, with the child overriding on conflict", async () => {
      const ws = seedWorkspace()
      const base = environments.create({
        workspaceId: ws,
        name: "base",
        variables: { BASE_URL: "ftp://169.254.169.254/base-only", REGION: "eu" },
      })
      const child = environments.create({
        workspaceId: ws,
        name: "staging",
        baseEnvironmentId: base.environmentId,
        variables: { BASE_URL: "ftp://169.254.169.254/child-override" },
      })
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "inherit-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "http_1",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: { method: "GET", url: "{{env.BASE_URL}}?region={{env.REGION}}" },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
      }).workflowId
      const scheduler = makeScheduler()

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId, selectedEnvironmentId: child.environmentId })

      await new Promise((resolve) => setTimeout(resolve, 300))

      const persistedRun = runs.getById(runId)
      // BASE_URL comes from the child (override wins); REGION is inherited from the base
      // untouched. The query string is redacted, same as the sibling
      // test above — assert on the path, which still proves both resolutions happened.
      expect(persistedRun?.results[0]).toMatchObject({
        nodeId: "http_1",
        request: { url: "ftp://169.254.169.254/child-override?<REDACTED>" },
      })
    })

    it("runs a Call Workflow node against another workflow in the same workspace, end to end", async () => {
      const ws = seedWorkspace()
      const target = workflows.create({
        workspaceId: ws,
        name: "target-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          { nodeId: "end", type: "end", position: { x: 1, y: 0 } },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "end" }],
        variables: { issuedId: "sub-value" },
      })
      const callerId = workflows.create({
        workspaceId: ws,
        name: "caller-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "call1",
            type: "workflow",
            position: { x: 1, y: 0 },
            config: { targetWorkflowId: target.workflowId, outputMapping: { callerId: "issuedId" } },
          },
          { nodeId: "end", type: "end", position: { x: 2, y: 0 } },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "call1" },
          { edgeId: "e2", source: "call1", target: "end" },
        ],
      }).workflowId

      const scheduler = makeScheduler()
      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: callerId })

      await new Promise((resolve) => setTimeout(resolve, 300))

      const persistedRun = runs.getById(runId)
      expect(persistedRun?.status).toBe("completed")
      expect(persistedRun?.variables).toMatchObject({ callerId: "sub-value" })
      const callResult = persistedRun?.results.find((r) => r.nodeId === "call1")
      expect(callResult?.status).toBe("passed")
      expect(callResult?.subWorkflow).toMatchObject({
        workflowId: target.workflowId,
        status: "passed",
        nodeCount: 2,
        failedNodeCount: 0,
        outputVariableNames: ["callerId"],
      })
    })

    it("records a failed sub-workflow as its own run in the target workflow's history", async () => {
      const ws = seedWorkspace()
      const target = workflows.create({
        workspaceId: ws,
        name: "target-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "sub_http",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: { method: "GET", url: "ftp://169.254.169.254/blocked" },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "sub_http" }],
      })
      const callerId = workflows.create({
        workspaceId: ws,
        name: "caller-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "call1",
            type: "workflow",
            position: { x: 1, y: 0 },
            config: { targetWorkflowId: target.workflowId },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "call1" }],
      }).workflowId

      const scheduler = makeScheduler()
      const callerRunId = scheduler.enqueue({ workspaceId: ws, workflowId: callerId })
      await new Promise((resolve) => setTimeout(resolve, 300))

      // The point of the fix: the callee has a run to open, terminal and with the
      // failing node's evidence on it — not an empty History.
      const childRuns = runs.listByWorkflow(target.workflowId, ws).items
      expect(childRuns).toHaveLength(1)
      const childRun = childRuns[0]!
      expect(childRun.status).toBe("failed")
      expect(childRun.failedNodes).toEqual(["sub_http"])
      expect(childRun.results).toContainEqual(expect.objectContaining({
        nodeId: "sub_http",
        status: "failed",
        error: "Request configuration invalid",
      }))

      // ...and the caller points at it, without absorbing the child's nodes.
      const callerRun = runs.getById(callerRunId)
      expect(callerRun?.results.find((r) => r.nodeId === "call1")?.subWorkflow).toMatchObject({
        workflowId: target.workflowId,
        runId: childRun.runId,
        status: "failed",
      })
      expect(callerRun?.results.map((r) => r.nodeId)).not.toContain("sub_http")
      expect(Object.keys(callerRun?.nodeStatuses ?? {})).not.toContain("sub_http")
    })

    it("resolves {{secrets.*}} through the runtime resolver and substitutes plaintext into the outgoing request", async () => {
      const ws = seedWorkspace()
      // The renderer seals against the scope public key (publicKeyFromSeed(seed));
      // the runtime opens with the same seed. Mirror that contract here.
      const seed = new Uint8Array(32).fill(7)
      const sealedBox = await import("../../secrets/sealed_box")
      const publicKey = await sealedBox.publicKeyFromSeed(seed)
      const sealedBody = await sealedBox.seal("local-secret-value", publicKey)

      // Local server (loopback allowed by SafeHttp) captures the actual outbound body.
      const { createServer } = await import("node:http")
      let receivedBody = ""
      const server = createServer((req, res) => {
        let data = ""
        req.on("data", (c) => (data += c))
        req.on("end", () => {
          receivedBody = data
          res.statusCode = 200
          res.end("{}")
        })
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const port = (server.address() as { port: number }).port

      const workflowId = workflows.create({
        workspaceId: ws,
        name: "secret-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "http_1",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: {
              method: "POST",
              url: `http://127.0.0.1:${port}/login`,
              body: JSON.stringify({ password: "{{secrets.kyra_admin_pass}}" }),
            },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
      }).workflowId

      const scheduler = makeScheduler({
        resolveSecret: async (name) => {
          if (name !== "kyra_admin_pass") return { plaintext: null, scopeType: null }
          return { plaintext: await sealedBox.openSealedBox(sealedBody, seed), scopeType: "workspace" }
        },
      })

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      await new Promise((resolve) => setTimeout(resolve, 400))

      server.close()
      const result = runs.getById(runId)?.results[0]
      expect(result).toMatchObject({ nodeId: "http_1", status: "passed" })
      // The secret must be substituted as plaintext into the request body.
      expect(receivedBody).toBe('{"password":"local-secret-value"}')
      expect(receivedBody).not.toContain("{{secrets.kyra_admin_pass}}")
    })
  })

  describe("secret masking", () => {
    const SECRET = "tok 9f8e7d6c"

    // Echoes the path, headers and body back, and hands out SECRET from /issue —
    // the worst case: an API that reflects credentials into what gets stored.
    async function startEchoServer(): Promise<{ port: number; requests: { url: string; headers: Record<string, unknown>; body: string }[]; close: () => void }> {
      const { createServer } = await import("node:http")
      const requests: { url: string; headers: Record<string, unknown>; body: string }[] = []
      const server = createServer((req, res) => {
        let body = ""
        req.on("data", (c) => (body += c))
        req.on("end", () => {
          requests.push({ url: req.url ?? "", headers: { ...req.headers }, body })
          res.setHeader("content-type", "application/json")
          res.setHeader("x-echo-token", SECRET)
          res.end(JSON.stringify({ path: req.url, headers: req.headers, body, issued: SECRET }))
        })
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      return { port: (server.address() as { port: number }).port, requests, close: () => server.close() }
    }

    function expectNoSecret(value: unknown): void {
      const text = JSON.stringify(value)
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain(encodeURIComponent(SECRET))
      expect(text).not.toContain(Buffer.from(`admin:${SECRET}`).toString("base64"))
    }

    it("masks resolved secret values in persisted results, node snapshots and events, while the request carries the real value", async () => {
      const ws = seedWorkspace()
      const echo = await startEchoServer()
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "masking-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "issue",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: {
              method: "POST",
              url: `http://127.0.0.1:${echo.port}/issue`,
              headers: [{ key: "X-Api-Token", value: "{{secrets.api_token}}" }],
              auth: { type: "basic", basic: { username: "admin", password: "{{secrets.api_token}}" } },
              body: JSON.stringify({ token: "{{secrets.api_token}}" }),
              extractors: { ref: "body.issued" },
            } as never,
          },
          {
            // The secret reaches the URL path through an extracted variable.
            nodeId: "lookup",
            type: "http-request",
            position: { x: 2, y: 0 },
            config: { method: "GET", url: `http://127.0.0.1:${echo.port}/users/{{variables.ref}}` },
          },
          {
            // ...and an error: an unreachable host named after the secret.
            nodeId: "broken",
            type: "http-request",
            position: { x: 3, y: 0 },
            config: { method: "GET", url: "http://{{variables.ref}}.invalid/" },
          },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "issue" },
          { edgeId: "e2", source: "issue", target: "lookup" },
          { edgeId: "e3", source: "lookup", target: "broken" },
        ],
      }).workflowId

      const events: RunEvent[] = []
      const scheduler = makeScheduler({
        emitProgress: (_runId, event) => events.push(event),
        resolveSecret: async (name) =>
          name === "api_token" ? { plaintext: SECRET, scopeType: "workspace" } : { plaintext: null, scopeType: null },
      })
      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      await new Promise((resolve) => setTimeout(resolve, 500))
      echo.close()

      // The wire carries the real value: header, Basic credential, body, and path.
      expect(echo.requests[0]?.headers["x-api-token"]).toBe(SECRET)
      expect(echo.requests[0]?.headers["authorization"]).toBe(`Basic ${Buffer.from(`admin:${SECRET}`).toString("base64")}`)
      expect(echo.requests[0]?.body).toBe(JSON.stringify({ token: SECRET }))
      expect(echo.requests[1]?.url).toBe(`/users/${encodeURIComponent(SECRET)}`)

      const run = runs.getById(runId)
      expect(run?.results.map((r) => r.nodeId)).toEqual(["issue", "lookup", "broken"])
      expectNoSecret(run)
      expectNoSecret(events)

      const issue = run?.results.find((r) => r.nodeId === "issue")
      expect(issue?.response).toMatchObject({
        headers: { "x-echo-token": "<SECRET>" },
        body: { issued: "<SECRET>", body: JSON.stringify({ token: "<SECRET>" }), headers: { authorization: "Basic <SECRET>", "x-api-token": "<SECRET>" } },
      })
      expect(run?.results.find((r) => r.nodeId === "lookup")?.request).toMatchObject({
        url: `http://127.0.0.1:${echo.port}/users/<SECRET>`,
      })
      expect(run?.variables).toMatchObject({ ref: "<SECRET>" })

      // Reports are built from this stored run, so they carry no secret either.
      const workflow = workflows.getById(workflowId) ?? null
      expectNoSecret(buildJUnitReport({ kind: "run", run: run!, workflow }))
      expectNoSecret(buildHtmlReport({ kind: "run", run: run!, workflow }))
    })

    it("resolves a secret a script reads by name, and masks it in the script's console output and errors", async () => {
      const ws = seedWorkspace()
      const echo = await startEchoServer()
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "script-secret-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "signed",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: {
              method: "GET",
              url: `http://127.0.0.1:${echo.port}/signed`,
              scripts: {
                preRequest: 'aw.request.headers["X-Key"] = aw.secrets.get("script_key")\nconsole.log("key is", aw.secrets.get("script_key"))',
                postResponse: 'aw.test("leaks", () => aw.expect(aw.secrets.get("script_key")).toBe("other"))\nthrow new Error("bad " + aw.secrets.get("script_key"))',
              },
            } as never,
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "signed" }],
      }).workflowId

      const events: RunEvent[] = []
      const scheduler = makeScheduler({
        emitProgress: (_runId, event) => events.push(event),
        resolveSecret: async (name) =>
          name === "script_key" ? { plaintext: SECRET, scopeType: "workspace" } : { plaintext: null, scopeType: null },
      })
      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      await scheduler.whenFinished(runId)
      echo.close()

      expect(echo.requests[0]?.headers["x-key"]).toBe(SECRET)
      const run = runs.getById(runId)
      expectNoSecret(run)
      expectNoSecret(events)
      const result = run?.results.find((r) => r.nodeId === "signed")
      expect(result?.secretRefs).toEqual(["script_key"])
      expect(result?.error).toBe("Post-response script failed: Error: bad <SECRET> (line 2, column 16)")
      expect(result?.scripts?.map((script) => [script.logs, script.tests])).toEqual([
        [["key is <SECRET>"], []],
        [[], [{ name: "leaks", passed: false, error: 'AssertionError: expected "<SECRET>" to be "other"' }]],
      ])
      expect(run?.resolvedSecrets).toEqual([{ name: "script_key", scopeType: "workspace", resolved: true }])
    })

    it("resolves and masks a secret used only inside a Call Workflow callee", async () => {
      const ws = seedWorkspace()
      const echo = await startEchoServer()
      const target = workflows.create({
        workspaceId: ws,
        name: "target-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "sub_http",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: {
              method: "POST",
              url: `http://127.0.0.1:${echo.port}/issue`,
              body: JSON.stringify({ token: "{{secrets.api_token}}" }),
            },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "sub_http" }],
      })
      const callerId = workflows.create({
        workspaceId: ws,
        name: "caller-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "call1",
            type: "workflow",
            position: { x: 1, y: 0 },
            // The secret appears only inside the callee: the caller's graph never names it.
            config: { targetWorkflowId: target.workflowId },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "call1" }],
      }).workflowId

      const events: RunEvent[] = []
      const scheduler = makeScheduler({
        emitProgress: (_runId, event) => events.push(event),
        resolveSecret: async (name) =>
          name === "api_token" ? { plaintext: SECRET, scopeType: "workspace" } : { plaintext: null, scopeType: null },
      })
      scheduler.enqueue({ workspaceId: ws, workflowId: callerId })
      await new Promise((resolve) => setTimeout(resolve, 500))
      echo.close()

      expect(echo.requests[0]?.body).toBe(JSON.stringify({ token: SECRET }))
      const childRun = runs.listByWorkflow(target.workflowId, ws).items[0]
      expect(childRun?.results.find((r) => r.nodeId === "sub_http")?.response).toMatchObject({
        body: { issued: "<SECRET>" },
      })
      expectNoSecret(childRun)
      expectNoSecret(events)
    })
  })

  describe("http-request timeout", () => {
    it("persists how long a timed-out request waited", async () => {
      const ws = seedWorkspace()
      const { createServer } = await import("node:http")
      const server = createServer((_req, res) => {
        setTimeout(() => res.end("{}"), 1000)
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const port = (server.address() as { port: number }).port
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "timeout-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "http_1",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: { method: "GET", url: `http://127.0.0.1:${port}/slow`, timeout: 0.05 },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
      }).workflowId

      const runId = makeScheduler().enqueue({ workspaceId: ws, workflowId })
      await new Promise((resolve) => setTimeout(resolve, 400))
      server.closeAllConnections()
      server.close()

      const run = runs.getById(runId)
      expect(run?.status).toBe("failed")
      expect(run?.results.find((r) => r.nodeId === "http_1")?.error).toBe("Request timed out after 0.05s")
    })
  })

  describe("http-request network errors", () => {
    it("persists the real cause of a refused connection, not a generic failure", async () => {
      const ws = seedWorkspace()
      const { createServer } = await import("node:http")
      const server = createServer()
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const port = (server.address() as { port: number }).port
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "refused-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "http_1",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: { method: "GET", url: `http://127.0.0.1:${port}/x` },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
      }).workflowId

      const runId = makeScheduler().enqueue({ workspaceId: ws, workflowId })
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(runs.getById(runId)?.results.find((r) => r.nodeId === "http_1")?.error).toBe(
        `Network error: connection refused by 127.0.0.1:${port} (ECONNREFUSED)`,
      )
    })
  })

  describe("http-request retry", () => {
    it("persists the retry verdict, its cause and every attempt", async () => {
      const ws = seedWorkspace()
      const { createServer } = await import("node:http")
      const server = createServer()
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const port = (server.address() as { port: number }).port
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const request = (nodeId: string, retry: Record<string, unknown>) => ({
        nodeId,
        type: "http-request" as const,
        position: { x: 1, y: 0 },
        config: { method: "GET" as const, url: `http://127.0.0.1:${port}/job`, retry: { maxAttempts: 2, intervalMs: 0, ...retry } },
      })
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "retry-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          request("flaky", {}),
          request("poll", { until: [{ source: "status", path: "", operator: "equals", expectedValue: 200 }] }),
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "flaky" },
          { edgeId: "e2", source: "start", target: "poll" },
        ],
      }).workflowId

      const scheduler = makeScheduler()
      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      await scheduler.whenFinished(runId)

      const refused = `Network error: connection refused by 127.0.0.1:${port} (ECONNREFUSED)`
      const result = (nodeId: string) => runs.getById(runId)?.results.find((r) => r.nodeId === nodeId)
      expect(result("flaky")?.error).toBe(`Failed after 2 attempts: ${refused}`)
      expect(result("poll")?.error).toBe(`Condition not met after 2 attempts: ${refused}`)
      expect(result("poll")?.attempts?.map((attempt) => attempt.error)).toEqual([refused, refused])
    })
  })

  describe("Call Workflow errors", () => {
    it("names a missing or unset target instead of a generic failure", async () => {
      const ws = seedWorkspace()
      const call = (nodeId: string, targetWorkflowId: string | null) =>
        ({ nodeId, type: "workflow" as const, position: { x: 1, y: 0 }, config: { targetWorkflowId } })
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "caller-wf",
        nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }, call("missing", "wf_gone"), call("unset", null)],
        edges: [
          { edgeId: "e1", source: "start", target: "missing" },
          { edgeId: "e2", source: "start", target: "unset" },
        ],
      }).workflowId

      const scheduler = makeScheduler()
      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      await scheduler.whenFinished(runId)

      const error = (nodeId: string) => runs.getById(runId)?.results.find((r) => r.nodeId === nodeId)?.error
      expect(error("missing")).toBe("Called workflow wf_gone not found")
      expect(error("unset")).toBe("Call Workflow node has no target workflow configured")
    })
  })

  describe("workspace ownership", () => {
    it("rejects enqueue of a workflow from another workspace and creates no run", async () => {
      const wsA = seedWorkspace()
      const wsB = seedWorkspace()
      const wfB = seedWorkflow(wsB)
      const scheduler = makeScheduler()

      expect(() => scheduler.enqueue({ workspaceId: wsA, workflowId: wfB })).toThrow(/not found/)

      // No cross-tenant run record leaked into workspace A.
      expect(runs.listByWorkspace(wsA).total).toBe(0)
    })
  })

  describe("concurrency cap", () => {
    it("holds the cap+1th run in pending", async () => {
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws, 500)
      const scheduler = makeScheduler({ concurrencyCap: 2 })

      const r1 = scheduler.enqueue({ workspaceId: ws, workflowId: wf })
      const r2 = scheduler.enqueue({ workspaceId: ws, workflowId: wf })
      const r3 = scheduler.enqueue({ workspaceId: ws, workflowId: wf })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(scheduler.getActiveCount()).toBe(2)
      expect(scheduler.getQueueLength()).toBe(1)
      expect(runs.getById(r3)?.status).toBe("pending")

      const r1Status = runs.getById(r1)?.status
      const r2Status = runs.getById(r2)?.status
      expect(["running"].includes(r1Status ?? "")).toBe(true)
      expect(["running"].includes(r2Status ?? "")).toBe(true)

      await new Promise((resolve) => setTimeout(resolve, 2000))

      expect(runs.getById(r1)?.status).toBe("completed")
      expect(runs.getById(r2)?.status).toBe("completed")
      expect(runs.getById(r3)?.status).toBe("completed")
      expect(scheduler.getActiveCount()).toBe(0)
    })
  })

  describe("interrupted reconciliation", () => {
    it("marks non-terminal runs as interrupted on startup", () => {
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws)
      const running = runs.create({ workspaceId: ws, workflowId: wf, status: "running" })
      const pending = runs.create({ workspaceId: ws, workflowId: wf, status: "pending" })
      const completed = runs.create({ workspaceId: ws, workflowId: wf, status: "completed" })

      const scheduler = makeScheduler()
      const count = scheduler.reconcileOnStartup()

      expect(count).toBe(2)
      expect(runs.getById(running.runId)?.status).toBe("interrupted")
      expect(runs.getById(pending.runId)?.status).toBe("interrupted")
      expect(runs.getById(completed.runId)?.status).toBe("completed")
    })
  })

  describe("cancel", () => {
    it("cancels a queued run before it starts", () => {
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws, 500)
      const scheduler = makeScheduler({ concurrencyCap: 1 })

      scheduler.enqueue({ workspaceId: ws, workflowId: wf })
      const r2 = scheduler.enqueue({ workspaceId: ws, workflowId: wf })

      expect(scheduler.getQueueLength()).toBeGreaterThanOrEqual(0)
      const cancelled = scheduler.cancel(r2)
      expect(cancelled).toBe(true)
      expect(runs.getById(r2)?.status).toBe("cancelled")
    })

    it("records a run cancelled during a delay as cancelled, not completed", async () => {
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws, 2000)
      const events: RunEvent[] = []
      const scheduler = makeScheduler({ emitProgress: (_runId, event) => events.push(event) })

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf })

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(runs.getById(runId)?.status).toBe("running")

      scheduler.cancel(runId)

      await new Promise((resolve) => setTimeout(resolve, 500))
      const run = runs.getById(runId)
      expect(run?.status).toBe("cancelled")
      expect(run?.error ?? null).toBeNull()
      expect(run?.results.find((r) => r.nodeId === "delay1")?.status).toBe("skipped")
      expect(Object.keys(run?.nodeStatuses ?? {})).not.toContain("end")
      expect(events.filter((e) => e.kind === "run.finished")).toEqual([{ kind: "run.finished", runId, status: "cancelled" }])
    })

    it("records a cancelled Call Workflow sub-run as cancelled too", async () => {
      const ws = seedWorkspace()
      const target = seedWorkflow(ws, 2000)
      const callerId = workflows.create({
        workspaceId: ws,
        name: "caller-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          { nodeId: "call1", type: "workflow", position: { x: 1, y: 0 }, config: { targetWorkflowId: target } },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "call1" }],
      }).workflowId
      const scheduler = makeScheduler()

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: callerId })
      await new Promise((resolve) => setTimeout(resolve, 100))
      scheduler.cancel(runId)
      await new Promise((resolve) => setTimeout(resolve, 500))

      expect(runs.getById(runId)?.status).toBe("cancelled")
      expect(runs.listByWorkflow(target, ws).items.map((r) => r.status)).toEqual(["cancelled"])
    })
  })

  describe("event emission", () => {
    it("emits node.status events plus a terminal run.finished, all with the real runId", async () => {
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws)
      const events: RunEvent[] = []
      const scheduler = makeScheduler({
        emitProgress: (_runId, event) => events.push(event),
      })

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf })

      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(events.length).toBeGreaterThan(0)
      expect(events.every((e) => e.runId === runId)).toBe(true)

      const nodeEvents = events.filter((e) => e.kind === "node.status")
      expect(nodeEvents.some((e) => e.nodeId === "start")).toBe(true)
      expect(nodeEvents.some((e) => e.nodeId === "end")).toBe(true)

      // Terminal event fires exactly once, last, carrying the run's final status.
      const finished = events.filter((e) => e.kind === "run.finished")
      expect(finished).toHaveLength(1)
      expect(finished[0]?.status).toBe("completed")
      expect(events[events.length - 1]?.kind).toBe("run.finished")

      const run = runs.getById(runId)
      expect(run?.nodeStatuses).toBeDefined()
      expect(Object.keys(run?.nodeStatuses ?? {}).length).toBeGreaterThan(0)
    })

    it("emits a terminal run.finished whose status matches the persisted run status", async () => {
      // Cancellation is racy (the executor may finish before the abort lands, as
      // the mid-execution cancel test above documents). The robust invariant is
      // that the terminal event's status is exactly the run's final DB status.
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws, 2000)
      const events: RunEvent[] = []
      const scheduler = makeScheduler({
        emitProgress: (_runId, event) => events.push(event),
      })

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf })
      await new Promise((resolve) => setTimeout(resolve, 100))
      scheduler.cancel(runId)
      await new Promise((resolve) => setTimeout(resolve, 300))

      const finished = events.filter((e) => e.kind === "run.finished")
      expect(finished).toHaveLength(1)
      expect(finished[0]?.status).toBe(runs.getById(runId)?.status)
    })

    it("redacts secret-looking extracted variables from node.status events and persisted nodeStatuses", async () => {
      const ws = seedWorkspace()
      const { createServer } = await import("node:http")
      const server = createServer((_req, res) => {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify({ token: "super-secret-value-xyz", session: "x7Q9aB3c" }))
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const port = (server.address() as { port: number }).port

      const workflowId = workflows.create({
        workspaceId: ws,
        name: "extractor-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "http_1",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: {
              method: "GET",
              url: `http://127.0.0.1:${port}/login`,
              extractors: { api_key: "body.token", sessionId: "body.session" },
            } as never,
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
      }).workflowId

      const events: RunEvent[] = []
      const scheduler = makeScheduler({
        emitProgress: (_runId, event) => events.push(event),
      })

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      await new Promise((resolve) => setTimeout(resolve, 300))
      server.close()

      // "running" fires before extraction; the terminal "passed"/"failed" event carries the extracted variable.
      const httpEvents = events.filter((e) => e.kind === "node.status" && e.nodeId === "http_1")
      const httpEvent = httpEvents[httpEvents.length - 1]
      expect(httpEvent && "variables" in httpEvent ? httpEvent.variables : undefined).toMatchObject({ api_key: "<SECRET>" })
      expect(JSON.stringify(httpEvents)).not.toContain("super-secret-value-xyz")

      // The raw HTTP response body legitimately stays in `results[].response` (that's
      // the point of an API tester); only the *extracted variable* snapshot is redacted.
      const persisted = runs.getById(runId)?.nodeStatuses?.["http_1"] as Record<string, unknown> | undefined
      expect(persisted?.["variables"]).toMatchObject({ api_key: "<SECRET>" })
      expect(JSON.stringify(persisted)).not.toContain("super-secret-value-xyz")

      const completedRun = runs.getById(runId)
      // Secret-looking extracted values are redacted; ordinary extracted values are
      // kept for the trusted local run history (MCP never exposes variables).
      expect(completedRun?.variables).toMatchObject({ api_key: "<SECRET>", sessionId: "x7Q9aB3c" })
      expect(JSON.stringify(completedRun?.variables)).not.toContain("super-secret-value-xyz")
      expect(completedRun?.results.find((result) => result.nodeId === "http_1")?.extractorOutcomes).toEqual([
        {
          producerNodeId: "http_1",
          variableName: "api_key",
          path: "body.token",
          matched: true,
          observedType: "string",
          failureReason: null,
        },
        {
          producerNodeId: "http_1",
          variableName: "sessionId",
          path: "body.session",
          matched: true,
          observedType: "string",
          failureReason: null,
        },
      ])
    })

    // Regression: a run with no (or an incomplete) environment sends `{{env.*}}`
    // placeholders as literal text — a 401 from the target that reads as bad
    // credentials. The per-node `unresolvedPlaceholders` list is what collapses
    // that detour: the run result names the references that never resolved.
    it("reports {{env.*}} placeholders left literal on the run result", async () => {
      const ws = seedWorkspace()
      const { createServer } = await import("node:http")
      const server = createServer((_req, res) => {
        res.statusCode = 401
        res.end("{}")
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const port = (server.address() as { port: number }).port

      const workflowId = workflows.create({
        workspaceId: ws,
        name: "unresolved-env-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "http_1",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: {
              method: "POST",
              url: `http://127.0.0.1:${port}/auth`,
              body: '{"email":"{{env.EMAIL}}","password":"{{env.PASSWORD}}"}',
              bodyType: "json",
            } as never,
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
      }).workflowId

      const scheduler = makeScheduler()
      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      await new Promise((resolve) => setTimeout(resolve, 300))
      server.close()

      const persisted = runs.getById(runId)
      expect(persisted?.status).toBe("failed")
      const result = persisted?.results.find((r) => r.nodeId === "http_1")
      expect((result?.response as { statusCode?: number } | undefined)?.statusCode).toBe(401)
      expect(result?.unresolvedPlaceholders).toEqual(["env.EMAIL", "env.PASSWORD"])
    })

    it("persists structured assertion evaluations and final failure evidence", async () => {
      const ws = seedWorkspace()
      const { createServer } = await import("node:http")
      const server = createServer((_req, res) => {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify({ value: 42 }))
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const port = (server.address() as { port: number }).port
      const workflowId = workflows.create({
        workspaceId: ws,
        name: "assertion-evidence-wf",
        nodes: [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          {
            nodeId: "http_1",
            type: "http-request",
            position: { x: 1, y: 0 },
            config: { method: "GET", url: `http://127.0.0.1:${port}/value` },
          },
          {
            nodeId: "assert_1",
            type: "assertion",
            position: { x: 2, y: 0 },
            config: {
              assertions: [
                { source: "prev", path: "response.body.value", operator: "equals", expectedValue: 99 },
              ],
            },
          },
          { nodeId: "end", type: "end", position: { x: 3, y: 0 } },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "http_1" },
          { edgeId: "e2", source: "http_1", target: "assert_1" },
          { edgeId: "e3", source: "assert_1", target: "end" },
        ],
      }).workflowId
      const scheduler = makeScheduler()

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
      await new Promise((resolve) => setTimeout(resolve, 300))
      server.close()

      const run = runs.getById(runId)
      expect(run?.status).toBe("failed")
      expect(run?.failedNodes).toContain("assert_1")
      expect(run?.failureMessage).toBe("Workflow execution failed in 1 node")
      expect(run?.nodeStatuses["end"]).toBeUndefined()
      expect(run?.results.find((result) => result.nodeId === "assert_1")?.assertions).toEqual([
        expect.objectContaining({
          ruleIndex: 0,
          sourceNodeId: "http_1",
          outcome: "fail",
          reasonCode: "comparison-failed",
          actualType: "number",
        }),
      ])
    })
  })

  describe("whenFinished", () => {
    it("resolves with the terminal status, at once for a finished run, and rejects for an unknown one", async () => {
      const ws = seedWorkspace()
      const scheduler = makeScheduler()
      const queued = scheduler.enqueue({ workspaceId: ws, workflowId: seedWorkflow(ws) })
      expect(await scheduler.whenFinished(queued)).toBe("completed")
      expect(await scheduler.whenFinished(queued)).toBe("completed")

      const slow = scheduler.enqueue({ workspaceId: ws, workflowId: seedWorkflow(ws, 5000) })
      const finished = scheduler.whenFinished(slow)
      scheduler.cancel(slow)
      expect(await finished).toBe("cancelled")

      await expect(scheduler.whenFinished("nope")).rejects.toThrow("not found")
    })
  })

  describe("shutdown", () => {
    it("force-reconciles active runs to a terminal state", async () => {
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws, 5000)
      const scheduler = makeScheduler()

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf })
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(scheduler.getActiveCount()).toBe(1)

      await scheduler.shutdown(200)

      const status = runs.getById(runId)?.status
      expect(["interrupted", "cancelled", "completed"].includes(status ?? "")).toBe(true)
      expect(scheduler.getActiveCount()).toBe(0)
    })
  })
})

/**
 * H10: a local agent can write a workflow that sends any stored secret to a
 * host it controls, then run it. A run an agent started may resolve secrets
 * only after the user has been shown which ones and where they go.
 */
describe("agent-started runs that use secrets", () => {
  async function startServer(): Promise<{ port: number; bodies: string[]; close: () => void }> {
    const { createServer } = await import("node:http")
    const bodies: string[] = []
    const server = createServer((req, res) => {
      let body = ""
      req.on("data", (c) => (body += c))
      req.on("end", () => {
        bodies.push(body)
        res.end("{}")
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    return { port: (server.address() as { port: number }).port, bodies, close: () => server.close() }
  }

  function seedSecretWorkflow(ws: string, url: string, name = "exfil"): string {
    return workflows.create({
      workspaceId: ws,
      name,
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        {
          nodeId: "http_1",
          type: "http-request",
          position: { x: 1, y: 0 },
          config: { method: "POST", url, body: "{{secrets.API_KEY}}" },
        },
      ] as WorkflowNode[],
      edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
    }).workflowId
  }

  const resolveSecret: SchedulerDeps["resolveSecret"] = async (name) =>
    name === "API_KEY" ? { plaintext: "s3cr3t", scopeType: "workspace" } : { plaintext: null, scopeType: null }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400))

  it("asks the user, and a denial fails the run before any request carries the secret", async () => {
    const server = await startServer()
    const ws = seedWorkspace()
    const wf = seedSecretWorkflow(ws, `http://127.0.0.1:${server.port}/collect`)
    const asked: AgentRunApprovalRequest[] = []
    const scheduler = makeScheduler({
      resolveSecret,
      approveAgentRun: async (request) => {
        asked.push(request)
        return false
      },
    })

    const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf, agent: "evil-agent" })
    await settle()
    server.close()

    expect(asked).toEqual([
      {
        runId,
        agent: "evil-agent",
        workflowName: "exfil",
        secretNames: ["API_KEY"],
        destinations: [`127.0.0.1:${server.port}`],
        runsScripts: false,
      },
    ])
    expect(server.bodies).toEqual([])
    expect(runs.getById(runId)).toMatchObject({ status: "failed", error: AGENT_RUN_DENIED_ERROR })
  })

  it("asks before a script reads a secret, and says the workflow runs scripts", async () => {
    const server = await startServer()
    const ws = seedWorkspace()
    const wf = workflows.create({
      workspaceId: ws,
      name: "scripted",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        {
          nodeId: "http_1",
          type: "http-request",
          position: { x: 1, y: 0 },
          config: { method: "POST", url: `http://127.0.0.1:${server.port}/collect`, scripts: { preRequest: 'aw.request.body = aw.secrets.get("API_KEY")' } },
        },
      ] as WorkflowNode[],
      edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
    }).workflowId
    const asked: AgentRunApprovalRequest[] = []
    const scheduler = makeScheduler({
      resolveSecret,
      approveAgentRun: async (request) => {
        asked.push(request)
        return false
      },
    })

    const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf, agent: "evil-agent" })
    await scheduler.whenFinished(runId)
    server.close()

    expect(asked).toMatchObject([{ secretNames: ["API_KEY"], runsScripts: true }])
    expect(server.bodies).toEqual([])
    expect(runs.getById(runId)).toMatchObject({ status: "failed", error: AGENT_RUN_DENIED_ERROR })
  })

  it("asks before a signed auth scheme uses its secrets, naming every one", async () => {
    const ws = seedWorkspace()
    const auths = [
      { type: "awsSigV4", awsSigV4: { accessKeyId: "AKID", secretAccessKey: "{{secrets.AWS_SECRET}}", sessionToken: "{{secrets.AWS_TOKEN}}", region: "us-east-1", service: "s3" } },
    ]
    const wf = workflows.create({
      workspaceId: ws,
      name: "signed",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        ...auths.map((auth, index) => ({
          nodeId: `http_${index}`,
          type: "http-request",
          position: { x: index + 1, y: 0 },
          config: { url: "https://api.example.com/x", auth },
        })),
      ] as WorkflowNode[],
      edges: auths.map((_auth, index) => ({ edgeId: `e${index}`, source: index === 0 ? "start" : `http_${index - 1}`, target: `http_${index}` })),
    }).workflowId
    const asked: AgentRunApprovalRequest[] = []
    const scheduler = makeScheduler({
      resolveSecret: async () => ({ plaintext: "value", scopeType: "workspace" }),
      approveAgentRun: async (request) => {
        asked.push(request)
        return false
      },
    })

    const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf, agent: "evil-agent" })
    await scheduler.whenFinished(runId)

    expect([...asked[0]!.secretNames].sort()).toEqual(["AWS_SECRET", "AWS_TOKEN"])
    expect(runs.getById(runId)).toMatchObject({ status: "failed", error: AGENT_RUN_DENIED_ERROR })
  })

  it("runs normally once the user allows it", async () => {
    const server = await startServer()
    const ws = seedWorkspace()
    const wf = seedSecretWorkflow(ws, `http://127.0.0.1:${server.port}/collect`)
    const scheduler = makeScheduler({ resolveSecret, approveAgentRun: async () => true })

    const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf, agent: "claude-code" })
    await settle()
    server.close()

    expect(server.bodies).toEqual(["s3cr3t"])
    expect(runs.getById(runId)?.status).toBe("completed")
  })

  it("refuses when no one can be asked", async () => {
    const server = await startServer()
    const ws = seedWorkspace()
    const wf = seedSecretWorkflow(ws, `http://127.0.0.1:${server.port}/collect`)
    const scheduler = makeScheduler({ resolveSecret })

    const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf, agent: "claude-code" })
    await settle()
    server.close()

    expect(server.bodies).toEqual([])
    expect(runs.getById(runId)?.error).toBe(AGENT_RUN_DENIED_ERROR)
  })

  it("does not ask for the user's own runs, or for agent runs that use no secret", async () => {
    const server = await startServer()
    const ws = seedWorkspace()
    const withSecret = seedSecretWorkflow(ws, `http://127.0.0.1:${server.port}/collect`)
    const withoutSecret = seedWorkflow(ws)
    let asked = 0
    const scheduler = makeScheduler({
      resolveSecret,
      approveAgentRun: async () => {
        asked += 1
        return false
      },
    })

    const userRun = scheduler.enqueue({ workspaceId: ws, workflowId: withSecret })
    const agentRun = scheduler.enqueue({ workspaceId: ws, workflowId: withoutSecret, agent: "claude-code" })
    await settle()
    server.close()

    expect(asked).toBe(0)
    expect(runs.getById(userRun)?.status).toBe("completed")
    expect(runs.getById(agentRun)?.status).toBe("completed")
  })

  it("runs the graphs the user approved, even if the workflow is edited while the prompt is open", async () => {
    const approved = await startServer()
    const attacker = await startServer()
    const ws = seedWorkspace()
    const target = seedSecretWorkflow(ws, `http://127.0.0.1:${approved.port}/collect`, "target")
    const caller = workflows.create({
      workspaceId: ws,
      name: "caller",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "call", type: "workflow", position: { x: 1, y: 0 }, config: { targetWorkflowId: target } },
      ] as WorkflowNode[],
      edges: [{ edgeId: "e1", source: "start", target: "call" }],
    }).workflowId
    const scheduler = makeScheduler({
      resolveSecret,
      approveAgentRun: async (request) => {
        expect(request.destinations).toEqual([`127.0.0.1:${approved.port}`])
        // The agent redirects the sub-workflow while the user is reading the prompt.
        const current = workflows.getById(target)!
        workflows.update(target, {
          nodes: current.nodes.map((node) =>
            node.nodeId === "http_1"
              ? ({ ...node, config: { ...node.config, url: `http://127.0.0.1:${attacker.port}/x` } } as WorkflowNode)
              : node,
          ),
        })
        return true
      },
    })

    scheduler.enqueue({ workspaceId: ws, workflowId: caller, agent: "claude-code" })
    await settle()
    approved.close()
    attacker.close()

    expect(attacker.bodies).toEqual([])
    expect(approved.bodies).toEqual(["s3cr3t"])
  })
})

describe("requestDestinations", () => {
  it("includes an OAuth 2.0 node's token endpoint, which receives its credentials", () => {
    const nodes = [
      { nodeId: "a", type: "http-request", config: { url: "https://api.example.com/v1", auth: { type: "oauth2", oauth2: { tokenUrl: "https://idp.example.com/token" } } } },
    ] as unknown as Parameters<typeof requestDestinations>[0]
    expect(requestDestinations(nodes, {}, {})).toEqual(["api.example.com", "idp.example.com"])
  })

  it("reduces a URL to its host where it resolves before the run, and keeps it as written where it does not", () => {
    const nodes = [
      { nodeId: "a", type: "http-request", config: { url: "https://api.example.com/v1/login" } },
      { nodeId: "b", type: "http-request", config: { url: "{{env.BASE}}/users" } },
      { nodeId: "c", type: "http-request", config: { url: "{{variables.host}}/x" } },
      { nodeId: "d", type: "http-request", config: { url: "{{login.response.body.next}}" } },
      { nodeId: "e", type: "http-request", config: { url: "https://api.example.com/v1/other" } },
      { nodeId: "f", type: "delay", config: { duration: 1 } },
    ] as unknown as Parameters<typeof requestDestinations>[0]

    expect(requestDestinations(nodes, { BASE: "https://env.example.org:8443" }, { host: "http://vars.example.net" })).toEqual([
      "api.example.com",
      "env.example.org:8443",
      "vars.example.net",
      "{{login.response.body.next}}",
    ])
  })
})

describe("OAuth 2.0 runs", () => {
  it("never stores a fetched token, even when the API echoes it back", async () => {
    const server = await startFakeOAuthServer()
    const ws = seedWorkspace()
    const workflowId = workflows.create({
      workspaceId: ws,
      name: "oauth-wf",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        {
          nodeId: "call",
          type: "http-request",
          position: { x: 1, y: 0 },
          config: {
            url: `${server.url}/api`,
            auth: { type: "oauth2", oauth2: { grantType: "client_credentials", tokenUrl: `${server.url}/token`, clientId: "c", clientSecret: "{{secrets.CLIENT_SECRET}}" } },
            extractors: { echoed: "response.body.youSent" },
          },
        },
        { nodeId: "end", type: "end", position: { x: 2, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "call" },
        { edgeId: "e2", source: "call", target: "end" },
      ],
    }).workflowId
    const events: RunEvent[] = []
    const scheduler = makeScheduler({
      emitProgress: (_runId, event) => events.push(event),
      resolveSecret: async () => ({ plaintext: "client-secret-value", scopeType: "workspace" }),
    })
    const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
    expect(await scheduler.whenFinished(runId)).toBe("completed")
    await server.close()

    expect(server.apiCalls).toEqual(["Bearer tok-1-abcdef"])
    const stored = JSON.stringify(runs.getById(runId))
    expect(stored).not.toContain("tok-1-abcdef")
    expect(stored).toContain("Bearer <SECRET>")
    expect(JSON.stringify(events)).not.toContain("tok-1-abcdef")
  })

  it("writes a refreshed token set back to the scope its secret came from", async () => {
    const server = await startFakeOAuthServer()
    const ws = seedWorkspace()
    const workflowId = workflows.create({
      workspaceId: ws,
      name: "oauth-code-wf",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        {
          nodeId: "call",
          type: "http-request",
          position: { x: 1, y: 0 },
          config: {
            url: `${server.url}/api`,
            auth: { type: "oauth2", oauth2: { grantType: "authorization_code", authorizationUrl: `${server.url}/authorize`, tokenUrl: `${server.url}/token`, clientId: "c", tokenSecret: "{{secrets.API_TOKEN}}" } },
          },
        },
      ],
      edges: [{ edgeId: "e1", source: "start", target: "call" }],
    }).workflowId
    const saved: { name: string; value: string; scope: unknown }[] = []
    const scheduler = makeScheduler({
      resolveSecret: async () => ({ plaintext: encodeStoredToken({ accessToken: "old-access", expiresAt: 0, refreshToken: "refresh-1" }), scopeType: "workspace" }),
      saveSecret: async (name, value, scope) => {
        saved.push({ name, value, scope })
      },
    })
    const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
    expect(await scheduler.whenFinished(runId)).toBe("completed")
    await server.close()

    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: "API_TOKEN", scope: { workspaceId: ws, scopeType: "workspace", scopeId: ws } })
    expect(JSON.parse(saved[0]!.value)).toMatchObject({ accessToken: "tok-1-abcdef", refreshToken: "refresh-1" })
    expect(JSON.stringify(runs.getById(runId))).not.toContain("tok-1-abcdef")
  })
})

describe("signed auth runs", () => {
  function seedAuthWorkflow(ws: string, url: string, auth: Record<string, unknown>): string {
    return workflows.create({
      workspaceId: ws,
      name: "signed-wf",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "call", type: "http-request", position: { x: 1, y: 0 }, config: { url, auth, extractors: { echoed: "response.body.youSent" } } },
      ] as WorkflowNode[],
      edges: [{ edgeId: "e1", source: "start", target: "call" }],
    }).workflowId
  }

  it("keeps a signing failure's message in history, since it names the secret and not its value", async () => {
    const ws = seedWorkspace()
    const workflowId = seedAuthWorkflow(ws, "http://127.0.0.1:9/x", {
      type: "awsSigV4",
      awsSigV4: { accessKeyId: "AKID", secretAccessKey: "{{secrets.AWS_SECRET}}", region: "us-east-1", service: "execute-api" },
    })
    const scheduler = makeScheduler({ resolveSecret: async () => ({ plaintext: null, scopeType: null }) })
    const runId = scheduler.enqueue({ workspaceId: ws, workflowId })
    await scheduler.whenFinished(runId)

    const call = runs.getById(runId)!.results.find((result) => result.nodeId === "call")
    expect(call?.error).toBe("AWS Signature V4: secret AWS_SECRET is not set")
  })
})
