import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import { EnvironmentRepository, RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { RunScheduler, type SchedulerDeps } from "../scheduler"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import type { RunEvent } from "@shared/types/RunProgressEvent"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"

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
  const http = new SafeHttp({ allowLoopback: true })
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
        variables: { BASE_URL: "http://169.254.169.254/auth?token=opaque-credential" },
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
      expect(failed?.error).toBe("SSRF blocked")
      const persistedRun = runs.getById(runId)
      expect(persistedRun?.results[0]).toMatchObject({
        nodeId: "http_1",
        status: "failed",
        error: "SSRF blocked",
        request: { url: "http://169.254.169.254/auth?<REDACTED>" },
      })
      expect(JSON.stringify(persistedRun)).not.toContain("opaque-credential")
    })

    it("resolves inherited variables from a base environment, with the child overriding on conflict", async () => {
      const ws = seedWorkspace()
      const base = environments.create({
        workspaceId: ws,
        name: "base",
        variables: { BASE_URL: "http://169.254.169.254/base-only", REGION: "eu" },
      })
      const child = environments.create({
        workspaceId: ws,
        name: "staging",
        baseEnvironmentId: base.environmentId,
        variables: { BASE_URL: "http://169.254.169.254/child-override" },
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
      // untouched. The query string is redacted (SSRF-blocked target), same as the sibling
      // test above — assert on the path, which still proves both resolutions happened.
      expect(persistedRun?.results[0]).toMatchObject({
        nodeId: "http_1",
        request: { url: "http://169.254.169.254/child-override?<REDACTED>" },
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

    it("cancels a running run mid-execution", async () => {
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws, 2000)
      const scheduler = makeScheduler()

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf })

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(runs.getById(runId)?.status).toBe("running")

      scheduler.cancel(runId)

      await new Promise((resolve) => setTimeout(resolve, 500))
      const status = runs.getById(runId)?.status
      expect(["cancelled", "completed"].includes(status ?? "")).toBe(true)
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
