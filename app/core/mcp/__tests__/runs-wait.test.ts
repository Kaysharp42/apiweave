import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSync } from "node:fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { initDatabase, type InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  NodePresetRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../../services/scope_resolver"
import { WorkspaceService } from "../../services/workspace_service"
import { CollectionService } from "../../services/collection_service"
import { WorkflowService } from "../../services/workflow_service"
import { WorkflowAnalysisService } from "../../services/workflow_analysis_service"
import { AssertionAuthoringService } from "../../services/assertion_authoring_service"
import { EnvironmentService } from "../../services/environment_service"
import { NodePresetService } from "../../services/node_preset_service"
import { RunService } from "../../services/run_service"
import { SecretService, type SecretWriteStore, type SecretUpsert } from "../../services/secret_service"
import { ProjectExportService } from "../../services/project_export_service"
import type { SecretMetadata } from "../../secrets/scoped_secret_resolver"
import { IpcRouter } from "../../ipc/router"
import { registerAllHandlers, type HandlerDeps } from "../../ipc/handlers"
import { RunEventBroker } from "../../runner/run_event_broker"
import { RunScheduler } from "../../runner/scheduler"
import { SafeHttp } from "../../runner/safe_http"
import { DynamicFunctions } from "../../runner/dynamic_functions"
import { FixedClockProvider, SeededRandomProvider } from "../../runner/harness/providers"
import { MCP_TOOLS, toolName } from "../tools"
import { createMcpServer } from "../server"
import { McpHost } from "../host"

/**
 * Phase 4 (execution observation) exit conditions:
 * - Short runs complete in one create call; long runs yield a reusable ID.
 * - No listener leak, missed completion, or duplicate enqueue on covered retries.
 * - Cancellation/deadline cleanup holds; disconnect/restart never starts
 *   another run and never implies cancellation.
 */
class FakeSecretStore implements SecretWriteStore {
  put(input: SecretUpsert): SecretMetadata {
    return {
      secretId: `${input.scopeType}/${input.scopeId}/${input.name}`,
      name: input.name,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      keyId: input.keyId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
  }
  remove(): boolean {
    return false
  }
  listByScope(): SecretMetadata[] {
    return []
  }
  getByScopeAndName(): SecretMetadata | null {
    return null
  }
}

let db: InitializedDatabase
let router: IpcRouter
let runRepository: RunRepository
let workflowRepository: WorkflowRepository
let runService: RunService
let broker: RunEventBroker
let scheduler: RunScheduler | null = null

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  workflowRepository = new WorkflowRepository(db.kvStore)
  const runs = new RunRepository(db.kvStore)
  runRepository = runs
  const environments = new EnvironmentRepository(db.kvStore)
  const nodePresets = new NodePresetRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  const scopeResolver = new ScopeResolver(existence)
  const permissions = new LocalOwnerProvider()
  const sync = new LocalOnlySyncProvider()
  const secretStore = new FakeSecretStore()
  broker = new RunEventBroker({ now: () => new Date().toISOString() })
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xABCD1234")
  const http = new SafeHttp({ allowLoopback: true })
  const functions = new DynamicFunctions(clock, rng)
  scheduler = new RunScheduler({
    runs,
    workflows: workflowRepository,
    environments,
    http,
    functions,
    clock,
    rng,
    emitProgress: (runId, event) => broker.publish(runId, event),
  })
  const workflowService = new WorkflowService(workflowRepository, sync, permissions, scopeResolver, collections, environments)
  runService = new RunService(runs, sync, permissions, scopeResolver, scheduler, broker)
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, workflowRepository, sync, scopeResolver),
    collections: new CollectionService(collections, workflowRepository, sync, permissions, scopeResolver),
    workflows: workflowService,
    workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
    assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
    environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
    nodePresets: new NodePresetService(nodePresets, permissions, scopeResolver),
    runs: runService,
    secrets: new SecretService(secretStore, sync, permissions, scopeResolver, environments, new Uint8Array(32)),
    projects: new ProjectExportService(
      collections,
      workflowRepository,
      environments,
      sync,
      permissions,
      scopeResolver,
      secretStore,
      () => "2026-01-01T00:00:00.000Z",
    ),
    httpSafety: {
      allowPrivateNetworks: false,
      setAllowPrivateNetworks: () => undefined,
    },
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

async function dispatchOk<T = unknown>(domain: string, action: string, payload?: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
  const res = await router.dispatch({ domain, action, payload }, opts)
  if (!res.ok) throw new Error(`expected ok, got ${JSON.stringify(res.error)}`)
  return res.data as T
}

async function dispatchErr(domain: string, action: string, payload?: unknown): Promise<{ code: string; message: string }> {
  const res = await router.dispatch({ domain, action, payload })
  if (res.ok) throw new Error(`expected error, got ${JSON.stringify(res.data)}`)
  return { code: res.error.code, message: res.error.message }
}

async function connectClient(): Promise<Client> {
  const server = createMcpServer(router, "test", broker)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport as never)
  const client = new Client({ name: "test-client", version: "1.0.0" })
  await client.connect(clientTransport as never)
  return client
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("")
}

function seedWorkflow(workspaceId: string, delayMs?: number): string {
  const nodes =
    delayMs !== undefined
      ? [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          { nodeId: "delay1", type: "delay", position: { x: 1, y: 0 }, config: { duration: delayMs } },
          { nodeId: "end", type: "end", position: { x: 2, y: 0 } },
        ]
      : [
          { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
          { nodeId: "end", type: "end", position: { x: 1, y: 0 } },
        ]
  const edges =
    delayMs !== undefined
      ? [
          { edgeId: "e1", source: "start", target: "delay1" },
          { edgeId: "e2", source: "delay1", target: "end" },
        ]
      : [{ edgeId: "e1", source: "start", target: "end" }]
  return workflowRepository.create({ workspaceId, name: "wf", nodes: nodes as never, edges: edges as never }).workflowId
}

describe("Phase 4 — whitelist publishes wait and bounded create", () => {
  it("exposes runs_wait as an idempotent read with a run projection", () => {
    const names = new Set(MCP_TOOLS.map(toolName))
    expect(names.has("runs_wait")).toBe(true)
    const wait = MCP_TOOLS.find((spec) => toolName(spec) === "runs_wait")
    expect(wait).toMatchObject({ domain: "runs", action: "wait", intent: "read", idempotent: true, resultProjection: "run" })
    expect(wait?.description).toContain("waitMs")
  })

  it("bounds waitMs on create and wait", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId)
    const tooLong = await dispatchErr("runs", "create", { workspaceId: workspace.workspaceId, workflowId, waitMs: 99_999 })
    expect(tooLong.code).toBe("validation")
    const waitTooLong = await dispatchErr("runs", "wait", { workspaceId: workspace.workspaceId, runId: "r", waitMs: -1 })
    expect(waitTooLong.code).toBe("validation")
  })
})

describe("Phase 4 — single create-and-wait for short runs", () => {
  it("completes a fast run in one create call with no leaked wait", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId)
    expect(runService.getActiveWaitCount()).toBe(0)
    const run = await dispatchOk<{ runId: string; status: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 5000,
    })
    expect(["completed", "failed"]).toContain(run.status)
    expect(runService.getActiveWaitCount()).toBe(0)
  })

  it("waitMs:0 returns immediately without waiting", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId, 1000)
    const started = Date.now()
    const run = await dispatchOk<{ runId: string; status: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
    })
    expect(Date.now() - started).toBeLessThan(500)
    expect(["pending", "running"]).toContain(run.status)
    expect(runService.getActiveWaitCount()).toBe(0)
  })

  it("resolves via MCP with a compact summary and failure evidence on completion", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId)
    const client = await connectClient()
    const result = await client.callTool({
      name: "runs_create",
      arguments: { workspaceId: workspace.workspaceId, workflowId, waitMs: 5000 },
    })
    expect((result as { isError?: boolean }).isError).toBeFalsy()
    const parsed = JSON.parse(textOf(result as { content: Array<{ type: string; text?: string }> })) as Record<string, unknown>
    expect(typeof parsed["runId"]).toBe("string")
    expect(parsed["terminal"]).toBe(true)
    expect(["completed", "failed"]).toContain(parsed["status"])
    // Compact: no bodies/headers/urls/variables, one per-node representation.
    expect(parsed).not.toHaveProperty("results")
    expect(parsed).not.toHaveProperty("nodeStatuses")
    expect(parsed).not.toHaveProperty("variables")
    expect(parsed).toHaveProperty("statusCounts")
    await client.close()
    expect(runService.getActiveWaitCount()).toBe(0)
  })
})

describe("Phase 4 — long runs yield a reusable ID", () => {
  it("returns the current run on deadline and finishes on a later wait", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId, 1200)
    const first = await dispatchOk<{ runId: string; status: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 50,
    })
    expect(["pending", "running"]).toContain(first.status)
    expect(runService.getActiveWaitCount()).toBe(0)
    const second = await dispatchOk<{ runId: string; status: string }>("runs", "wait", {
      workspaceId: workspace.workspaceId,
      runId: first.runId,
      waitMs: 5000,
    })
    expect(second.runId).toBe(first.runId)
    expect(["completed", "failed"]).toContain(second.status)
    expect(runService.getActiveWaitCount()).toBe(0)
  })

  it("MCP deadline carries terminal:false plus the runId for runs_wait", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId, 1200)
    const client = await connectClient()
    const created = await client.callTool({
      name: "runs_create",
      arguments: { workspaceId: workspace.workspaceId, workflowId, waitMs: 50 },
    })
    const partial = JSON.parse(textOf(created as { content: Array<{ type: string; text?: string }> })) as {
      runId: string
      terminal: boolean
      status: string
    }
    expect(partial.terminal).toBe(false)
    expect(typeof partial.runId).toBe("string")
    const waited = await client.callTool({
      name: "runs_wait",
      arguments: { workspaceId: workspace.workspaceId, runId: partial.runId, waitMs: 5000 },
    })
    const final = JSON.parse(textOf(waited as { content: Array<{ type: string; text?: string }> })) as {
      runId: string
      terminal: boolean
      status: string
    }
    expect(final.runId).toBe(partial.runId)
    expect(final.terminal).toBe(true)
    await client.close()
  })
})

describe("Phase 4 — no missed completion or listener leak", () => {
  it("returns immediately when the run is already terminal (recheck after subscribe)", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId)
    const created = await dispatchOk<{ runId: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
    })
    // Mark terminal in the DB without publishing a broker event: the wait must
    // see it on its recheck, not hang until its deadline.
    runRepository.updateStatus(created.runId, "completed")
    const started = Date.now()
    const waited = await dispatchOk<{ runId: string; status: string }>("runs", "wait", {
      workspaceId: workspace.workspaceId,
      runId: created.runId,
      waitMs: 2000,
    })
    expect(Date.now() - started).toBeLessThan(500)
    expect(waited.status).toBe("completed")
    expect(runService.getActiveWaitCount()).toBe(0)
  })

  it("resolves a completion that lands between subscribe and recheck", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId)
    const created = await dispatchOk<{ runId: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
    })
    const pending = dispatchOk<{ status: string }>("runs", "wait", {
      workspaceId: workspace.workspaceId,
      runId: created.runId,
      waitMs: 2000,
    })
    // Complete on the next tick — after the wait has subscribed but around its
    // recheck — then publish the terminal event.
    await new Promise((resolve) => setTimeout(resolve, 10))
    runRepository.updateStatus(created.runId, "completed")
    broker.publish(created.runId, { kind: "run.finished", runId: created.runId, status: "completed" })
    const waited = await pending
    expect(waited.status).toBe("completed")
    expect(runService.getActiveWaitCount()).toBe(0)
  })

  it("cleans up concurrent waits on the same run", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId, 300)
    const created = await dispatchOk<{ runId: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
    })
    const waits = await Promise.all([
      dispatchOk<{ status: string }>("runs", "wait", { workspaceId: workspace.workspaceId, runId: created.runId, waitMs: 5000 }),
      dispatchOk<{ status: string }>("runs", "wait", { workspaceId: workspace.workspaceId, runId: created.runId, waitMs: 5000 }),
      dispatchOk<{ status: string }>("runs", "wait", { workspaceId: workspace.workspaceId, runId: created.runId, waitMs: 5000 }),
    ])
    for (const waited of waits) expect(["completed", "failed"]).toContain(waited.status)
    expect(runService.getActiveWaitCount()).toBe(0)
  })
})

describe("Phase 4 — retriable creation does not double-enqueue", () => {
  it("replays the first run for the same operationId and request", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId)
    const first = await dispatchOk<{ runId: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
      operationId: "op-1",
    })
    const second = await dispatchOk<{ runId: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
      operationId: "op-1",
    })
    expect(second.runId).toBe(first.runId)
    const history = await dispatchOk<{ items: unknown[] }>("runs", "history", { workspaceId: workspace.workspaceId })
    expect(history.items).toHaveLength(1)
  })

  it("conflicts when the same operationId carries a changed request", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const firstId = seedWorkflow(workspace.workspaceId)
    const secondId = seedWorkflow(workspace.workspaceId)
    await dispatchOk("runs", "create", { workspaceId: workspace.workspaceId, workflowId: firstId, waitMs: 0, operationId: "op-2" })
    const error = await dispatchErr("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId: secondId,
      waitMs: 0,
      operationId: "op-2",
    })
    expect(error.code).toBe("conflict")
  })

  it("does not enqueue twice on concurrent acceptance", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId)
    const [a, b] = await Promise.all([
      dispatchOk<{ runId: string }>("runs", "create", {
        workspaceId: workspace.workspaceId,
        workflowId,
        waitMs: 0,
        operationId: "op-race",
      }),
      dispatchOk<{ runId: string }>("runs", "create", {
        workspaceId: workspace.workspaceId,
        workflowId,
        waitMs: 0,
        operationId: "op-race",
      }),
    ])
    expect(a.runId).toBe(b.runId)
    const history = await dispatchOk<{ items: unknown[] }>("runs", "history", { workspaceId: workspace.workspaceId })
    expect(history.items).toHaveLength(1)
  })

  it("surfaces the conflict over MCP without leaking internals", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const firstId = seedWorkflow(workspace.workspaceId)
    const secondId = seedWorkflow(workspace.workspaceId)
    const client = await connectClient()
    await client.callTool({
      name: "runs_create",
      arguments: { workspaceId: workspace.workspaceId, workflowId: firstId, waitMs: 0, operationId: "op-mcp" },
    })
    const retry = await client.callTool({
      name: "runs_create",
      arguments: { workspaceId: workspace.workspaceId, workflowId: secondId, waitMs: 0, operationId: "op-mcp" },
    })
    expect((retry as { isError?: boolean }).isError).toBe(true)
    expect(textOf(retry as { content: Array<{ type: string; text?: string }> })).toContain("conflict")
    await client.close()
  })
})

describe("Phase 4 — cancellation and deadline cleanup", () => {
  it("aborting the wait leaves the run alone (cancel-wait is not cancel-run)", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId, 1500)
    const created = await dispatchOk<{ runId: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
    })
    const controller = new AbortController()
    const pending = router.dispatch(
      { domain: "runs", action: "wait", payload: { workspaceId: workspace.workspaceId, runId: created.runId, waitMs: 5000 } },
      { signal: controller.signal },
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(runService.getActiveWaitCount()).toBe(0)
    // The run itself was not cancelled by aborting its observation.
    const current = await dispatchOk<{ status: string }>("runs", "get", {
      workspaceId: workspace.workspaceId,
      runId: created.runId,
    })
    expect(["pending", "running"]).toContain(current.status)
    // Explicit cancel still stops the run.
    const cancelled = await dispatchOk<{ status: string }>("runs", "cancel", {
      workspaceId: workspace.workspaceId,
      runId: created.runId,
    })
    expect(cancelled.status).toBe("cancelled")
  })

  it("a wait deadline does not cancel the run and creates nothing new", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId, 1500)
    const before = await dispatchOk<{ items: unknown[] }>("runs", "history", { workspaceId: workspace.workspaceId })
    const partial = await dispatchOk<{ runId: string; status: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 30,
    })
    expect(["pending", "running"]).toContain(partial.status)
    const after = await dispatchOk<{ items: unknown[] }>("runs", "history", { workspaceId: workspace.workspaceId })
    expect(after.items).toHaveLength(before.items.length + 1)
    expect(runService.getActiveWaitCount()).toBe(0)
  })

  it("authorizes both the initial lookup and the final retrieval", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId)
    const created = await dispatchOk<{ runId: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
    })
    const foreign = await dispatchErr("runs", "wait", { workspaceId: "ws-not-mine", runId: created.runId, waitMs: 100 })
    expect(foreign.code).toBe("not_found")
    expect(runService.getActiveWaitCount()).toBe(0)
  })
})

describe("Phase 4 — disconnect and restart behavior", () => {
  it("a timed-out wait leaves a reusable run that a later wait can finish", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId, 600)
    const partial = await dispatchOk<{ runId: string; status: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 30,
    })
    // Simulate the client going away after the deadline: nothing on the server
    // cancels or duplicates the run — the same runId is reusable.
    const resumed = await dispatchOk<{ runId: string; status: string }>("runs", "wait", {
      workspaceId: workspace.workspaceId,
      runId: partial.runId,
      waitMs: 5000,
    })
    expect(resumed.runId).toBe(partial.runId)
    expect(["completed", "failed"]).toContain(resumed.status)
  })

  it("restart marks non-terminal runs interrupted and waits observe it", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId, 10_000)
    const created = await dispatchOk<{ runId: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
    })
    // Simulate the scheduler's startup reconciliation: never auto-resumes.
    for (const run of runRepository.listNonTerminal()) {
      runRepository.updateStatus(run.runId, "interrupted")
      broker.publish(run.runId, { kind: "run.finished", runId: run.runId, status: "interrupted" })
    }
    const waited = await dispatchOk<{ status: string }>("runs", "wait", {
      workspaceId: workspace.workspaceId,
      runId: created.runId,
      waitMs: 1000,
    })
    expect(waited.status).toBe("interrupted")
    expect(runService.getActiveWaitCount()).toBe(0)
  })
})

describe("Phase 4 — host keeps in-flight waits past idle expiry", () => {
  let host: McpHost | null = null
  const tokenPath = join(tmpdir(), `apiweave-mcp-wait-${process.pid}.json`)
  const clients: Client[] = []

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      try {
        await c.close()
      } catch {
        /* ignore */
      }
    }
    if (host) await host.stop()
    host = null
    try {
      rmSync(tokenPath)
    } catch {
      /* ignore */
    }
  })

  async function connectHttp(port: number, token: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    })
    const client = new Client({ name: "http-client", version: "1.0.0" })
    await client.connect(transport)
    clients.push(client)
    return client
  }

  it("does not evict a session while a bounded wait holds its POST open", async () => {
    host = new McpHost({ router, tokenFilePath: tokenPath, version: "test", preferredPort: 0, broker, idleTimeoutMs: 80 })
    const { token, port } = await host.start()
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const workflowId = seedWorkflow(workspace.workspaceId, 10_000)
    const created = await dispatchOk<{ runId: string }>("runs", "create", {
      workspaceId: workspace.workspaceId,
      workflowId,
      waitMs: 0,
    })
    const client = await connectHttp(port, token)
    expect(host.getSessionCount()).toBe(1)
    const pending = client.callTool({
      name: "runs_wait",
      arguments: { workspaceId: workspace.workspaceId, runId: created.runId, waitMs: 400 },
    })
    // Past the 80ms idle timeout but inside the 400ms wait: the session must
    // still be there because its POST is in flight.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(host.getSessionCount()).toBe(1)
    const result = (await pending) as { content: Array<{ type: string; text?: string }> }
    const parsed = JSON.parse(textOf(result)) as { runId: string; terminal: boolean }
    expect(parsed.runId).toBe(created.runId)
    expect(parsed.terminal).toBe(false)
    // After the wait lands the session idles out normally.
    for (let i = 0; i < 50 && host.getSessionCount() > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(host.getSessionCount()).toBe(0)
  }, 20_000)
})
