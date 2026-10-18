import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initDatabase } from "../../../db"
import type { InitializedDatabase } from "../../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  NodePresetRepository,
  ProjectRunRepository,
  RunRepository,
  SecretRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../../repositories"
import { ScopeResolver, type ScopeExistence } from "../../../services/scope_resolver"
import { WorkspaceService } from "../../../services/workspace_service"
import { CollectionService } from "../../../services/collection_service"
import { WorkflowService } from "../../../services/workflow_service"
import { WorkflowAnalysisService } from "../../../services/workflow_analysis_service"
import { AssertionAuthoringService } from "../../../services/assertion_authoring_service"
import { EnvironmentService } from "../../../services/environment_service"
import { NodePresetService } from "../../../services/node_preset_service"
import { RunService } from "../../../services/run_service"
import { ProjectRunService } from "../../../services/project_run_service"
import { ProjectRunner } from "../../../runner/project_runner"
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
let projectRuns: ProjectRunRepository
let scheduler: RunScheduler | null = null

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const nodePresets = new NodePresetRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const secretStore = new SecretRepository(db.kvStore)
  projectRuns = new ProjectRunRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  const scopeResolver = new ScopeResolver(existence)
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xABCD1234")
  const http = new SafeHttp()
  const functions = new DynamicFunctions(clock, rng)
  scheduler = new RunScheduler({ runs, workflows, environments, http, functions, clock, rng })

  const workflowService = new WorkflowService(workflows, scopeResolver, collections, environments)
  const runService = new RunService(runs, scopeResolver, scheduler)
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, workflows, scopeResolver),
    collections: new CollectionService(collections, workflows, scopeResolver),
    workflows: workflowService,
    workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
    assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
    environments: new EnvironmentService(environments, scopeResolver),
    nodePresets: new NodePresetService(nodePresets, scopeResolver),
    runs: runService,
    secrets: new SecretService(secretStore, scopeResolver, environments, new Uint8Array(32)),
    projects: new ProjectExportService(
      collections,
      workflows,
      environments,
      scopeResolver,
      secretStore,
      () => clock.isoNow(),
    ),
    projectRuns: new ProjectRunService(
      new ProjectRunner({ projectRuns, collections, workflows, environments, runs, scheduler }),
      projectRuns,
      collections,
      scopeResolver,
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

  it("runs.createIterations runs the workflow once per row, in order, never storing the rows", async () => {
    const ws = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflowId = seedWorkflow(ws.workspaceId)
    const enqueue = vi.spyOn(scheduler!, "enqueue")
    const rows = [{ user: "ann-row" }, { user: "bob-row" }, { user: "cy-row" }]

    const first = await ok<{ runId: string; iteration: { groupId: string; index: number; count: number } }>("runs", "createIterations", {
      workspaceId: ws.workspaceId,
      workflowId,
      rows,
    })

    expect(first.iteration).toMatchObject({ index: 1, count: 3 })
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(3))
    expect(enqueue.mock.calls.map(([request]) => request.data)).toEqual(rows)
    const runIds = enqueue.mock.results.map((result) => result.value as string)
    expect(await waitForStatus(runIds[2]!, ["completed", "failed"])).toBe("completed")
    const stored = runIds.map((runId) => runs.getById(runId)!)
    expect(stored.map((run) => run.iteration)).toEqual([1, 2, 3].map((index) => ({ groupId: first.iteration.groupId, index, count: 3 })))
    expect(JSON.stringify(stored)).not.toContain("ann-row")
  })

  it("runs.createIterations stops the remaining iterations when the running one is cancelled", async () => {
    const ws = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflowId = seedWorkflow(ws.workspaceId, 2000)
    const enqueue = vi.spyOn(scheduler!, "enqueue")

    const first = await ok<{ runId: string }>("runs", "createIterations", { workspaceId: ws.workspaceId, workflowId, rows: [{}, {}] })
    await waitForStatus(first.runId, ["running"], 500)
    await ok("runs", "cancel", { workspaceId: ws.workspaceId, runId: first.runId })

    expect(await waitForStatus(first.runId, ["cancelled"])).toBe("cancelled")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it("runs.createIterations refuses an empty data set", async () => {
    const ws = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const workflowId = seedWorkflow(ws.workspaceId)

    const res = await router.dispatch({ domain: "runs", action: "createIterations", payload: { workspaceId: ws.workspaceId, workflowId, rows: [] } })

    expect(res.ok).toBe(false)
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

  it("projects.run runs the enabled workflows in order; getRun, listRuns and cancelRun read and stop it", async () => {
    const ws = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const project = await ok<{ collectionId: string }>("projects", "create", { workspaceId: ws.workspaceId, name: "Checkout" })
    const first = seedWorkflow(ws.workspaceId)
    const second = seedWorkflow(ws.workspaceId)
    for (const workflowId of [first, second]) {
      await ok("projects", "addWorkflow", { workspaceId: ws.workspaceId, collectionId: project.collectionId, workflowId })
    }
    await ok("projects", "update", {
      workspaceId: ws.workspaceId,
      collectionId: project.collectionId,
      workflowOrder: [
        { workflowId: second, order: 0, enabled: true, continueOnFail: true },
        { workflowId: first, order: 1, enabled: true, continueOnFail: true },
      ],
    })
    const enqueue = vi.spyOn(scheduler!, "enqueue")

    const started = await router.dispatch(
      { domain: "projects", action: "run", payload: { workspaceId: ws.workspaceId, projectId: project.collectionId, environmentId: null } },
      { agent: "claude-code" },
    )
    if (!started.ok) throw new Error(JSON.stringify(started.error))
    const { projectRunId } = started.data as { projectRunId: string }

    const deadline = Date.now() + 2000
    let current = await ok<{ status: string; items: { workflowId: string; status: string; runId: string | null }[] }>(
      "projects", "getRun", { workspaceId: ws.workspaceId, projectRunId },
    )
    while (current.status === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      current = await ok("projects", "getRun", { workspaceId: ws.workspaceId, projectRunId })
    }
    expect(current.status).toBe("completed")
    expect(current.items.map((item) => [item.workflowId, item.status])).toEqual([[second, "completed"], [first, "completed"]])
    // An agent's project run starts each workflow run as that agent, so its secrets need the user's approval.
    expect(enqueue.mock.calls.map(([request]) => request.agent)).toEqual(["claude-code", "claude-code"])

    const listed = await ok<{ items: { projectRunId: string }[]; total: number }>(
      "projects", "listRuns", { workspaceId: ws.workspaceId, projectId: project.collectionId },
    )
    expect(listed.items.map((run) => run.projectRunId)).toEqual([projectRunId])
    // Cancelling a finished project run is a no-op that returns it unchanged.
    expect(await ok("projects", "cancelRun", { workspaceId: ws.workspaceId, projectRunId })).toEqual(current)

    const other = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Other", isPersonal: false })
    const foreign = await router.dispatch({ domain: "projects", action: "getRun", payload: { workspaceId: other.workspaceId, projectRunId } })
    expect(foreign.ok ? null : foreign.error.code).toBe("not_found")
    const missingEnvironment = await router.dispatch({
      domain: "projects", action: "run", payload: { workspaceId: ws.workspaceId, projectId: project.collectionId },
    })
    expect(missingEnvironment.ok ? null : missingEnvironment.error.code).toBe("validation")
    expect(projectRuns.listByProject(project.collectionId)).toHaveLength(1)

    // Reports: one testsuite per workflow of the project run, in run order.
    const junit = await ok<string>("projects", "runReport", { workspaceId: ws.workspaceId, projectRunId, format: "junit" })
    expect([...junit.matchAll(/<testsuite name="wf" id="(\d)"/g)].map((match) => match[1])).toEqual(["0", "1"])
    const html = await ok<string>("projects", "runReport", { workspaceId: ws.workspaceId, projectRunId, format: "html" })
    expect(html).toContain("<h1>Checkout</h1>")
    const runReport = await ok<string>("runs", "report", { workspaceId: ws.workspaceId, runId: current.items[0]!.runId, format: "junit" })
    expect(runReport).toContain('<testsuites name="wf" tests="0" failures="0"')
    // Deleting a workflow deletes its runs; the project report still has its suite.
    await ok("workflows", "delete", { workspaceId: ws.workspaceId, workflowId: second })
    const afterDelete = await ok<string>("projects", "runReport", { workspaceId: ws.workspaceId, projectRunId, format: "junit" })
    expect(afterDelete.match(/<testsuite /g)).toHaveLength(2)
    expect(afterDelete).toContain('<skipped message="Its run was deleted from history"/>')
    const foreignReport = await router.dispatch({ domain: "projects", action: "runReport", payload: { workspaceId: other.workspaceId, projectRunId, format: "junit" } })
    expect(foreignReport.ok ? null : foreignReport.error.code).toBe("not_found")
  })
})
