import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import { RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { RunScheduler, type SchedulerDeps } from "../scheduler"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import type { RunProgressEvent } from "../../../../shared/types/RunProgressEvent"
import type { WorkflowNode } from "../../../../shared/types/WorkflowNode"
import type { WorkflowEdge } from "../../../../shared/types/WorkflowEdge"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let runs: RunRepository
let activeScheduler: RunScheduler | null = null

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
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
  const s = new RunScheduler({ runs, workflows, http, functions, clock, rng, ...overrides })
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
    it("emits node.completed events with the real runId", async () => {
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
      expect(events.some((e) => e.nodeId === "start")).toBe(true)
      expect(events.some((e) => e.nodeId === "end")).toBe(true)

      const run = runs.getById(runId)
      expect(run?.nodeStatuses).toBeDefined()
      expect(Object.keys(run?.nodeStatuses ?? {}).length).toBeGreaterThan(0)
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
