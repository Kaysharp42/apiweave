import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
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
import { MCP_TOOLS, toolName } from "../tools"
import { createMcpServer } from "../server"

/**
 * Phase 6 (measured surface cleanup) exit conditions:
 * - Overlapping run listing/latest selectors are one query operation
 *   (`runs.history` covers workspace/workflow/status/latest filtering); the
 *   superseded MCP tools are gone while their IPC handlers stay for the
 *   renderer and the debug-context service.
 * - Project membership/metadata overlap is resolved the same way:
 *   `workflows.search` (collectionId) replaces `projects.listWorkflows`, and
 *   `workflows.attachToCollection` replaces `projects.addWorkflow` /
 *   `projects.removeWorkflow` on the agent surface.
 * - Catalogue ordering stays fixed and deterministic.
 * - Redaction, exclusions, strict schemas, revision safety and continuation
 *   correctness hold for every consolidated path.
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

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
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
  const workflowService = new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments)
  const runService = new RunService(runs, sync, permissions, scopeResolver)
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, workflows, sync, scopeResolver),
    collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
    workflows: workflowService,
    workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
    assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
    environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
    nodePresets: new NodePresetService(nodePresets, permissions, scopeResolver),
    runs: runService,
    secrets: new SecretService(secretStore, sync, permissions, scopeResolver, environments, new Uint8Array(32)),
    projects: new ProjectExportService(
      collections,
      workflows,
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

afterEach(() => db.close())

async function dispatchOk<T = unknown>(domain: string, action: string, payload?: unknown): Promise<T> {
  const res = await router.dispatch({ domain, action, payload })
  if (!res.ok) throw new Error(`expected ok, got ${JSON.stringify(res.error)}`)
  return res.data as T
}

async function connectClient(): Promise<Client> {
  const server = createMcpServer(router, "test")
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport as never)
  const client = new Client({ name: "test-client", version: "1.0.0" })
  await client.connect(clientTransport as never)
  return client
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("")
}

async function seedWorkspace(name = "Acme"): Promise<string> {
  const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name, isPersonal: false })
  return workspace.workspaceId
}

type HistoryPage = { items: Array<Record<string, unknown>>; nextCursor: string | null }

describe("Phase 6 — superseded selectors are off the agent surface, on the router", () => {
  it("keeps one run query plus single-run reads, and drops the overlapping selectors", () => {
    const names = new Set(MCP_TOOLS.map(toolName))
    for (const kept of ["runs_history", "runs_get", "runs_getNodeResult", "runs_create", "runs_wait", "runs_cancel"]) {
      expect(names.has(kept), kept).toBe(true)
    }
    for (const removed of ["runs_listByWorkflow", "runs_listByWorkspace", "runs_getLatest", "runs_getLatestFailed"]) {
      expect(names.has(removed), removed).toBe(false)
    }
    // The IPC handlers stay: the renderer polls latest/latest-failed and the
    // debug-context service resolves the latest failed run through them.
    for (const [domain, action] of [
      ["runs", "listByWorkflow"],
      ["runs", "listByWorkspace"],
      ["runs", "getLatest"],
      ["runs", "getLatestFailed"],
    ] as const) {
      expect(router.getRegistration(domain, action), `${domain}.${action}`).toBeDefined()
    }
  })

  it("keeps workflow-centric project membership and drops the duplicated surface", () => {
    const names = new Set(MCP_TOOLS.map(toolName))
    for (const kept of ["workflows_search", "workflows_attachToCollection", "projects_list", "projects_get"]) {
      expect(names.has(kept), kept).toBe(true)
    }
    for (const removed of ["projects_listWorkflows", "projects_addWorkflow", "projects_removeWorkflow"]) {
      expect(names.has(removed), removed).toBe(false)
    }
    for (const [domain, action] of [
      ["projects", "listWorkflows"],
      ["projects", "addWorkflow"],
      ["projects", "removeWorkflow"],
    ] as const) {
      expect(router.getRegistration(domain, action), `${domain}.${action}`).toBeDefined()
    }
  })

  it("lists tools in fixed whitelist order with server_info last", async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    const expected = [...MCP_TOOLS.map(toolName), "server_info"]
    expect(tools.map((tool) => tool.name)).toEqual(expected)
    await client.close()
  })
})

describe("Phase 6 — history covers latest/latest-failed with the same ordering", () => {
  async function seedMixedRuns(): Promise<{ workspaceId: string; workflowId: string }> {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "mixed" })
    const statuses = ["completed", "failed", "completed", "failed"] as const
    for (const status of statuses) {
      const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
      runRepository.update(run.runId, {
        status,
        results: [{ nodeId: "n0", status: status === "failed" ? "failed" : "passed", duration: 1 }],
        failedNodes: status === "failed" ? ["n0"] : [],
      })
      // Newest-first ordering is (createdAt, id); separate the rows in time so
      // the expected latest is unambiguous.
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    return { workspaceId, workflowId: workflow.workflowId }
  }

  it("history with limit 1 returns the latest run, plus status failed the latest failure", async () => {
    const { workspaceId, workflowId } = await seedMixedRuns()
    const latest = await dispatchOk<{ runId: string }>("runs", "getLatest", { workspaceId, workflowId })
    const latestFailed = await dispatchOk<{ runId: string }>("runs", "getLatestFailed", { workspaceId, workflowId })

    const newest = await dispatchOk<HistoryPage>("runs", "history", { workspaceId, workflowId, limit: 1 })
    expect(newest.items).toHaveLength(1)
    expect(newest.items[0]?.["runId"]).toBe(latest.runId)

    const failed = await dispatchOk<HistoryPage>("runs", "history", {
      workspaceId,
      workflowId,
      status: "failed",
      limit: 1,
    })
    expect(failed.items).toHaveLength(1)
    expect(failed.items[0]?.["runId"]).toBe(latestFailed.runId)
    expect(failed.items[0]?.["status"]).toBe("failed")
  })

  it("history rows stay slim and the latest pattern works over the MCP bridge", async () => {
    const { workspaceId, workflowId } = await seedMixedRuns()
    const client = await connectClient()
    const result = await client.callTool({
      name: "runs_history",
      arguments: { workspaceId, workflowId, status: "failed", limit: 1 },
    })
    const parsed = JSON.parse(textOf(result as { content: Array<{ type: string; text?: string }> })) as HistoryPage
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]?.["status"]).toBe("failed")
    expect(parsed.items[0]).not.toHaveProperty("results")
    expect(parsed.items[0]).not.toHaveProperty("nodeStatuses")
    expect(parsed.items[0]).not.toHaveProperty("variables")
    await client.close()
  })
})

describe("Phase 6 — project membership through the workflow tools", () => {
  it("search with collectionId lists members as summaries matching listWorkflows membership", async () => {
    const workspaceId = await seedWorkspace()
    const project = await dispatchOk<{ collectionId: string }>("projects", "create", { workspaceId, name: "Shop" })
    const member = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "member",
      collectionId: project.collectionId,
      nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }],
      variables: { token: "must-not-travel" },
    })
    await dispatchOk("workflows", "create", { workspaceId, name: "outsider" })

    const members = await dispatchOk<{ workflowId: string }[]>("projects", "listWorkflows", {
      workspaceId,
      collectionId: project.collectionId,
    })
    const page = await dispatchOk<{ items: Array<Record<string, unknown>>; nextCursor: string | null }>(
      "workflows",
      "search",
      { workspaceId, collectionId: project.collectionId },
    )
    expect(members.map((workflow) => workflow.workflowId)).toEqual([member.workflowId])
    expect(page.items.map((item) => item["workflowId"])).toEqual([member.workflowId])
    expect(page.nextCursor).toBeNull()
    // Summaries carry counts, never graphs or variables.
    expect(page.items[0]).not.toHaveProperty("nodes")
    expect(page.items[0]).not.toHaveProperty("edges")
    expect(page.items[0]).not.toHaveProperty("variables")
    expect(page.items[0]).toMatchObject({ name: "member", nodeCount: 1 })
  })

  it("attachToCollection attaches and detaches like add/removeWorkflow", async () => {
    const workspaceId = await seedWorkspace()
    const project = await dispatchOk<{ collectionId: string }>("projects", "create", { workspaceId, name: "Shop" })
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "loose" })

    const client = await connectClient()
    const attached = JSON.parse(
      textOf(
        (await client.callTool({
          name: "workflows_attachToCollection",
          arguments: { workspaceId, workflowId: workflow.workflowId, collectionId: project.collectionId },
        })) as { content: Array<{ type: string; text?: string }> },
      ),
    ) as { result: { workflowId: string; rev: number }; diagnosis: { status: string } }
    expect(attached.result.workflowId).toBe(workflow.workflowId)
    expect(attached.diagnosis.status).toBe("complete")
    // Compact write DTO: revision and diagnosis, never the graph.
    expect(attached.result).not.toHaveProperty("nodes")

    const members = await dispatchOk<{ workflowId: string }[]>("projects", "listWorkflows", {
      workspaceId,
      collectionId: project.collectionId,
    })
    expect(members.map((item) => item.workflowId)).toContain(workflow.workflowId)

    await client.callTool({
      name: "workflows_attachToCollection",
      arguments: { workspaceId, workflowId: workflow.workflowId, collectionId: null },
    })
    const after = await dispatchOk<{ workflowId: string }[]>("projects", "listWorkflows", {
      workspaceId,
      collectionId: project.collectionId,
    })
    expect(after.map((item) => item.workflowId)).not.toContain(workflow.workflowId)
    await client.close()
  })
})
