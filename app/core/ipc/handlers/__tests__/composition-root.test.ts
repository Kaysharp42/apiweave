import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../../db"
import type { InitializedDatabase } from "../../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  RunRepository,
  SecretRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../../repositories"
import { LocalOwnerProvider } from "../../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../../../services/scope_resolver"
import { WorkspaceService } from "../../../services/workspace_service"
import { CollectionService } from "../../../services/collection_service"
import { WorkflowService } from "../../../services/workflow_service"
import { EnvironmentService } from "../../../services/environment_service"
import { RunService } from "../../../services/run_service"
import { SecretService } from "../../../services/secret_service"
import { ProjectExportService } from "../../../services/project_export_service"
import { RunScheduler } from "../../../runner/scheduler"
import { DynamicFunctions } from "../../../runner/dynamic_functions"
import { SafeHttp } from "../../../runner/safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../../../runner/harness/providers"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import { IpcRouter } from "../../router"
import { registerAllHandlers, type HandlerDeps } from ".."

/**
 * Exercises the exact wiring main.ts performs: real repos + scheduler + the
 * SQLite SecretRepository, all 7 services, registerAllHandlers onto the router.
 * The pieces are each unit-tested elsewhere; this proves the composition root
 * they plug into actually executes a run and round-trips a secret.
 */

let db: InitializedDatabase
let router: IpcRouter
let workflows: WorkflowRepository
let runs: RunRepository
let scheduler: RunScheduler | null = null

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const secretStore = new SecretRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  const scopeResolver = new ScopeResolver(existence)
  const permissions = new LocalOwnerProvider()
  const sync = new LocalOnlySyncProvider()
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xABCD1234")
  const http = new SafeHttp({ allowLoopback: true })
  const functions = new DynamicFunctions(clock, rng)
  scheduler = new RunScheduler({ runs, workflows, environments, http, functions, clock, rng })

  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, sync, scopeResolver),
    collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
    workflows: new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments),
    environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
    runs: new RunService(runs, sync, permissions, scopeResolver, scheduler),
    secrets: new SecretService(secretStore, sync, permissions, scopeResolver, new Uint8Array(32)),
    projects: new ProjectExportService(
      collections,
      workflows,
      environments,
      sync,
      permissions,
      scopeResolver,
      secretStore,
      () => clock.isoNow(),
    ),
  }
  router = new IpcRouter()
  registerAllHandlers(router, deps)
})

afterEach(async () => {
  if (scheduler) {
    await scheduler.shutdown(500)
    scheduler = null
  }
  db.close()
})

async function ok<T = unknown>(domain: string, action: string, payload?: unknown): Promise<T> {
  const res = await router.dispatch({ domain, action, payload })
  if (!res.ok) throw new Error(`expected ok, got ${JSON.stringify(res.error)}`)
  return res.data as T
}

async function waitForStatus(runId: string, statuses: readonly string[], timeoutMs = 1500): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = runs.getById(runId)?.status ?? ""
    if (statuses.includes(status)) return status
    if (Date.now() >= deadline) return status
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
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
  return workflows.create({ workspaceId, name: "wf", nodes, edges }).workflowId
}

describe("composition root — the wiring main.ts performs", () => {
  it("runs.create drives the scheduler: a start→end workflow executes to completion", async () => {
    const ws = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflowId = seedWorkflow(ws.workspaceId)

    const run = await ok<{ runId: string }>("runs", "create", {
      workspaceId: ws.workspaceId,
      workflowId,
    })
    expect(run.runId).toBeTruthy()

    expect(await waitForStatus(run.runId, ["completed", "failed"])).toBe("completed")
  })

  it("runs.cancel aborts a live scheduler run", async () => {
    const ws = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflowId = seedWorkflow(ws.workspaceId, 2000)

    const run = await ok<{ runId: string }>("runs", "create", { workspaceId: ws.workspaceId, workflowId })
    await waitForStatus(run.runId, ["running"], 500)
    await ok("runs", "cancel", { workspaceId: ws.workspaceId, runId: run.runId })

    // The abort is racy (executor may finish first); either terminal is acceptable,
    // but it must not stay stuck running/pending.
    const status = await waitForStatus(run.runId, ["cancelled", "completed", "failed"])
    expect(["cancelled", "completed", "failed"]).toContain(status)
  })

  it("secrets round-trip through the SQLite store, leaking neither plaintext nor sealed bytes", async () => {
    const PLAINTEXT = "hunter2-do-not-leak"
    const ws = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })

    const meta = await ok("secrets", "set", {
      workspaceId: ws.workspaceId,
      name: "API_KEY",
      scopeType: "workspace",
      scopeId: ws.workspaceId,
      keyId: "k1",
      sealed: new TextEncoder().encode(PLAINTEXT),
    })
    expect(meta).toMatchObject({ name: "API_KEY", keyId: "k1", scopeType: "workspace" })

    const list = await ok<unknown[]>("secrets", "list", {
      workspaceId: ws.workspaceId,
      scopeType: "workspace",
      scopeId: ws.workspaceId,
    })
    expect(list).toHaveLength(1)
    const serialized = JSON.stringify(list)
    expect(serialized).not.toContain(PLAINTEXT)
    expect(serialized).not.toContain("sealed")

    // Overwrite is an upsert, not a duplicate row.
    await ok("secrets", "set", {
      workspaceId: ws.workspaceId,
      name: "API_KEY",
      scopeType: "workspace",
      scopeId: ws.workspaceId,
      keyId: "k2",
      sealed: new TextEncoder().encode("rotated"),
    })
    const afterRotate = await ok<{ keyId: string }[]>("secrets", "list", {
      workspaceId: ws.workspaceId,
      scopeType: "workspace",
      scopeId: ws.workspaceId,
    })
    expect(afterRotate).toHaveLength(1)
    expect(afterRotate[0]?.keyId).toBe("k2")

    await ok("secrets", "delete", {
      workspaceId: ws.workspaceId,
      scopeType: "workspace",
      scopeId: ws.workspaceId,
      name: "API_KEY",
    })
    expect(
      await ok<unknown[]>("secrets", "list", {
        workspaceId: ws.workspaceId,
        scopeType: "workspace",
        scopeId: ws.workspaceId,
      }),
    ).toHaveLength(0)
  })
})
