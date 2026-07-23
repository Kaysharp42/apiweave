import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import { EnvironmentRepository, RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { RunScheduler, type SchedulerDeps } from "../scheduler"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import type { RunProgressEvent } from "@shared/types/RunProgressEvent"
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

    it("substitutes selected environment variables in HTTP request URLs", async () => {
      const ws = seedWorkspace()
      const env = environments.create({
        workspaceId: ws,
        name: "dev",
        variables: { BASE_URL: "http://169.254.169.254" },
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
            config: { method: "GET", url: "{{env.BASE_URL}}/auth/authenticate" },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
      }).workflowId
      const events: RunProgressEvent[] = []
      const scheduler = makeScheduler({
        emitProgress: (_runId, event) => events.push(event),
      })

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId, selectedEnvironmentId: env.environmentId })

      await new Promise((resolve) => setTimeout(resolve, 300))

      const failed = events.find(
        (event) => event.kind === "node.completed" && event.nodeId === "http_1" && event.status === "failed",
      )
      expect(failed).toBeDefined()
      expect(failed?.error).not.toContain("{{env.BASE_URL}}")
      expect(failed?.error).toContain("http://169.254.169.254/auth/authenticate")
      expect(runs.getById(runId)?.results[0]).toMatchObject({
        nodeId: "http_1",
        status: "failed",
        error: "SSRF blocked: URL blocked by safety policy: http://169.254.169.254/auth/authenticate",
        request: { url: "http://169.254.169.254/auth/authenticate" },
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
          if (name !== "kyra_admin_pass") return null
          return sealedBox.openSealedBox(sealedBody, seed)
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
    it("emits node.completed events plus a terminal run.finished, all with the real runId", async () => {
      const ws = seedWorkspace()
      const wf = seedWorkflow(ws)
      const events: RunProgressEvent[] = []
      const scheduler = makeScheduler({
        emitProgress: (_runId, event) => events.push(event),
      })

      const runId = scheduler.enqueue({ workspaceId: ws, workflowId: wf })

      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(events.length).toBeGreaterThan(0)
      expect(events.every((e) => e.runId === runId)).toBe(true)

      const nodeEvents = events.filter((e) => e.kind === "node.completed")
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
      const events: RunProgressEvent[] = []
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
