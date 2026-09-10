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
import { WorkflowService, graphTopologyChanged } from "../../services/workflow_service"
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
import { MCP_GUIDES } from "../guide"
import { AUTHOR_ASSERTIONS_PROMPT } from "../prompts"
import { createMcpServer } from "../server"
import { buildSessionBriefing } from "../../agents/session_briefing"

/**
 * Phase 5 (edit path and onboarding) exit conditions:
 * - assertion_validate stays for preview/evidence; assertion_apply accepts
 *   direct rules plus optional run evidence without claiming syntax-only
 *   validation covers evidence.
 * - Shared evidence-path semantics: [0] arrays resolve, missing and truncated
 *   are covered distinctly.
 * - Topology-aware auto-layout in the service write path: config-only edits
 *   preserve positions, topology edits lay out once on the saved revision,
 *   explicit layout:false always preserves.
 * - Concise task-specific onboarding: bounded initialize instructions,
 *   session-specific briefing, edit-debug quickstart, registry-backed guides.
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

async function dispatchErr(domain: string, action: string, payload?: unknown): Promise<{ code: string; message: string }> {
  const res = await router.dispatch({ domain, action, payload })
  if (res.ok) throw new Error(`expected error, got ${JSON.stringify(res.data)}`)
  return { code: res.error.code, message: res.error.message }
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

async function seedAssertionGraph(): Promise<{ workspaceId: string; workflowId: string; rev: number; runId: string }> {
  const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
  const workflow = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
    workspaceId: workspace.workspaceId,
    name: "assertions",
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      { nodeId: "request", type: "http-request", position: { x: 100, y: 0 }, config: {} },
      { nodeId: "assert", type: "assertion", position: { x: 200, y: 0 }, config: { assertions: [] } },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "request" },
      { edgeId: "e2", source: "request", target: "assert" },
    ],
  })
  const run = runRepository.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })
  runRepository.update(run.runId, {
    results: [{
      nodeId: "request",
      status: "passed",
      duration: 11,
      response: {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: { items: [{ id: "a1" }, { id: "a2" }], ready: true },
      },
    }],
  })
  return { workspaceId: workspace.workspaceId, workflowId: workflow.workflowId, rev: workflow.rev, runId: run.runId }
}

describe("Phase 5 — shared evidence-path semantics", () => {
  it("resolves [0] array paths against stored evidence", async () => {
    const ids = await seedAssertionGraph()
    const validated = await dispatchOk<{
      valid: boolean
      compatible: boolean
      issues: Array<{ code: string }>
    }>("assertions", "validate", {
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
      sourceNodeId: "request",
      runId: ids.runId,
      rules: [{ source: "prev", path: "response.body.items[0].id", operator: "exists" }],
    })
    expect(validated.valid).toBe(true)
    expect(validated.compatible).toBe(true)
    expect(validated.issues).toEqual([])
  })

  it("reports a missing path and a type mismatch distinctly", async () => {
    const ids = await seedAssertionGraph()
    const missing = await dispatchOk<{ valid: boolean; issues: Array<{ code: string }> }>("assertions", "validate", {
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
      sourceNodeId: "request",
      runId: ids.runId,
      rules: [{ source: "prev", path: "response.body.nope", operator: "exists" }],
    })
    expect(missing.valid).toBe(false)
    expect(missing.issues.map((issue) => issue.code)).toContain("path_missing")

    const mismatch = await dispatchOk<{ valid: boolean; issues: Array<{ code: string }> }>("assertions", "validate", {
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
      sourceNodeId: "request",
      runId: ids.runId,
      rules: [{ source: "prev", path: "response.body.ready.id", operator: "exists" }],
    })
    expect(mismatch.valid).toBe(false)
    expect(mismatch.issues.map((issue) => issue.code)).toContain("path_type_mismatch")
  })

  it("marks truncated bodies as unavailable rather than clean or missing", async () => {
    const ids = await seedAssertionGraph()
    const run = runRepository.create({ workspaceId: ids.workspaceId, workflowId: ids.workflowId })
    runRepository.update(run.runId, {
      results: [{
        nodeId: "request",
        status: "passed",
        duration: 5,
        response: { statusCode: 200, body: { items: [] }, truncated: true },
      }],
    })
    const validated = await dispatchOk<{ valid: boolean; issues: Array<{ code: string; severity: string }> }>(
      "assertions",
      "validate",
      {
        workspaceId: ids.workspaceId,
        workflowId: ids.workflowId,
        sourceNodeId: "request",
        runId: run.runId,
        rules: [{ source: "prev", path: "response.body.items[0].id", operator: "exists" }],
      },
    )
    expect(validated.valid).toBe(true)
    expect(validated.issues.map((issue) => issue.code)).toContain("response_truncated")
  })
})

describe("Phase 5 — validate vs apply without redundant round trips", () => {
  it("applies user-specified rules directly, and checks evidence in one call when runId is given", async () => {
    const ids = await seedAssertionGraph()
    const applied = await dispatchOk<{ workflow: { rev: number; nodes: Array<{ nodeId: string; config?: { assertions?: unknown[] } }> }; revision: number }>(
      "assertions",
      "apply",
      {
        workspaceId: ids.workspaceId,
        workflowId: ids.workflowId,
        expectedRevision: ids.rev,
        assertionNodeId: "assert",
        mode: "append",
        rules: [{ source: "prev", path: "response.body.items[0].id", operator: "exists" }],
        runId: ids.runId,
      },
    )
    expect(applied.revision).toBe(ids.rev + 1)
    expect(applied.workflow.nodes.find((node) => node.nodeId === "assert")?.config?.assertions).toEqual([
      { source: "prev", path: "response.body.items[0].id", operator: "exists" },
    ])
  })

  it("rejects evidence-mismatched rules on apply without a separate validate call", async () => {
    const ids = await seedAssertionGraph()
    const error = await dispatchErr("assertions", "apply", {
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
      expectedRevision: ids.rev,
      assertionNodeId: "assert",
      mode: "append",
      rules: [{ source: "prev", path: "response.body.absent", operator: "exists" }],
      runId: ids.runId,
    })
    expect(error.code).toBe("validation")
  })

  it("suggests concise stable candidates and never modifies the workflow", async () => {
    const ids = await seedAssertionGraph()
    const before = await dispatchOk<{ rev: number }>("workflows", "get", {
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
    })
    const suggested = await dispatchOk<{
      suggestions: Array<{ id: string; title: string; rules: unknown[]; overfitRisk: string; rationale: string }>
    }>("assertions", "suggest", {
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
      runId: ids.runId,
      sourceNodeId: "request",
    })
    const idsSeen = suggested.suggestions.map((suggestion) => suggestion.id)
    expect(new Set(idsSeen).size).toBe(idsSeen.length)
    for (const suggestion of suggested.suggestions) {
      expect(suggestion.rules.length).toBeGreaterThan(0)
      expect(["low", "medium", "high"]).toContain(suggestion.overfitRisk)
      expect(suggestion.rationale.length).toBeGreaterThan(0)
    }
    const after = await dispatchOk<{ rev: number }>("workflows", "get", {
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
    })
    expect(after.rev).toBe(before.rev)
  })

  it("keeps the approval prompt honest about direct apply", () => {
    expect(AUTHOR_ASSERTIONS_PROMPT.description).not.toMatch(/must not skip/i)
    const built = AUTHOR_ASSERTIONS_PROMPT.build({})
    const text = built.messages.map((message) => JSON.stringify(message.content)).join(" ")
    expect(text).toContain("assertion_apply")
    expect(text).toMatch(/Skip this call when the user already specified/i)
  })
})

describe("Phase 5 — topology-aware auto-layout in the service write path", () => {
  it("detects topology vs config-only changes", () => {
    const nodes = [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      { nodeId: "a", type: "http-request", position: { x: 1, y: 1 }, config: {} },
    ] as never
    const edges = [{ edgeId: "e1", source: "start", target: "a" }] as never
    const relabelled = [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      { nodeId: "a", type: "http-request", position: { x: 1, y: 1 }, label: "renamed", config: { method: "GET" } },
    ] as never
    expect(graphTopologyChanged(nodes, edges, relabelled, edges)).toBe(false)
    expect(graphTopologyChanged(nodes, edges, [...nodes, { nodeId: "b", type: "end", position: { x: 2, y: 2 } } as never], edges)).toBe(true)
    expect(graphTopologyChanged(nodes, edges, nodes, [...edges, { edgeId: "e2", source: "a", target: "a" } as never])).toBe(true)
    const regrouped = [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      { nodeId: "a", type: "http-request", position: { x: 1, y: 1 }, parentId: "frame", config: {} },
    ] as never
    expect(graphTopologyChanged(nodes, edges, regrouped, edges)).toBe(true)
    // Leaving a frame is as much a topology change as joining one.
    expect(graphTopologyChanged(regrouped, edges, nodes, edges)).toBe(true)
    // An absent handle and an explicitly undefined/null one are the same edge.
    const spelledOut = [{ edgeId: "e1", source: "start", target: "a", sourceHandle: undefined, targetHandle: null }] as never
    expect(graphTopologyChanged(nodes, edges, nodes, spelledOut)).toBe(false)
  })

  it("treats a re-pointed merge input handle as a topology change", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const created = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "merge-handles",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "a", type: "http-request", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://example.test/a" } },
        { nodeId: "b", type: "http-request", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://example.test/b" } },
        { nodeId: "m", type: "merge", position: { x: 0, y: 0 }, config: { mergeStrategy: "all" } },
        { nodeId: "end", type: "end", position: { x: 0, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "a" },
        { edgeId: "e2", source: "start", target: "b" },
        { edgeId: "e3", source: "a", target: "m", targetHandle: "branch-0" },
        { edgeId: "e4", source: "b", target: "m", targetHandle: "branch-1" },
        { edgeId: "e5", source: "m", target: "end" },
      ],
      layout: false,
    })
    const client = await connectClient()
    // Swap which merge input each branch arrives at — nothing else changes.
    const patched = await client.callTool({
      name: "workflows_patch",
      arguments: {
        workspaceId: workspace.workspaceId,
        workflowId: created.workflowId,
        expectedRevision: created.rev,
        upsertEdges: [
          { edgeId: "e3", source: "a", target: "m", targetHandle: "branch-1" },
          { edgeId: "e4", source: "b", target: "m", targetHandle: "branch-0" },
        ],
      },
    })
    expect((patched as { isError?: boolean }).isError).toBeFalsy()
    const persisted = await dispatchOk<{ nodes: Array<{ nodeId: string; position: { x: number; y: number } }> }>(
      "workflows",
      "get",
      { workspaceId: workspace.workspaceId, workflowId: created.workflowId },
    )
    expect(persisted.nodes.every((node) => node.position.x === 0 && node.position.y === 0)).toBe(false)
    await client.close()
  })

  it("takes a node out of its group frame when a patch sends parentId null", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const created = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "grouping",
      nodes: [
        { nodeId: "frame", type: "group", position: { x: 0, y: 0 }, config: { width: 400, height: 200 } },
        { nodeId: "start", type: "start", position: { x: 10, y: 10 } },
        { nodeId: "a", type: "http-request", position: { x: 20, y: 20 }, parentId: "frame", config: { method: "GET", url: "https://example.test/a" } },
        { nodeId: "end", type: "end", position: { x: 30, y: 30 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "a" },
        { edgeId: "e2", source: "a", target: "end" },
      ],
      layout: false,
    })
    const client = await connectClient()
    const patched = await client.callTool({
      name: "workflows_patch",
      arguments: {
        workspaceId: workspace.workspaceId,
        workflowId: created.workflowId,
        expectedRevision: created.rev,
        upsertNodes: [{ nodeId: "a", parentId: null }],
      },
    })
    expect((patched as { isError?: boolean }).isError).toBeFalsy()
    const persisted = await dispatchOk<{
      nodes: Array<{ nodeId: string; parentId?: string | null; position: { x: number; y: number } }>
    }>("workflows", "get", { workspaceId: workspace.workspaceId, workflowId: created.workflowId })
    const freed = persisted.nodes.find((node) => node.nodeId === "a")!
    // WorkflowNodeSchema spells "no parent" as an absent key, never a null.
    expect(freed).not.toHaveProperty("parentId")
    // Leaving the frame is a topology change, so the freed node is laid out
    // rather than left at the coordinates it held relative to the old frame.
    expect(freed.position).not.toEqual({ x: 20, y: 20 })
    await client.close()
  })

  it("preserves positions for config/label-only patches, including via MCP", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const created = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "positions",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 5, y: 6 } },
        { nodeId: "a", type: "http-request", position: { x: 50, y: 60 }, config: { method: "GET" } },
        { nodeId: "end", type: "end", position: { x: 500, y: 600 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "a" },
        { edgeId: "e2", source: "a", target: "end" },
      ],
      layout: false,
    })
    const client = await connectClient()
    const patched = await client.callTool({
      name: "workflows_patch",
      arguments: {
        workspaceId: workspace.workspaceId,
        workflowId: created.workflowId,
        expectedRevision: created.rev,
        upsertNodes: [{ nodeId: "a", label: "renamed", config: { timeout: 9 } }],
      },
    })
    expect((patched as { isError?: boolean }).isError).toBeFalsy()
    const persisted = await dispatchOk<{ nodes: Array<{ nodeId: string; position: { x: number; y: number } }> }>(
      "workflows",
      "get",
      { workspaceId: workspace.workspaceId, workflowId: created.workflowId },
    )
    expect(persisted.nodes.find((node) => node.nodeId === "a")?.position).toEqual({ x: 50, y: 60 })
    expect(persisted.nodes.find((node) => node.nodeId === "end")?.position).toEqual({ x: 500, y: 600 })
    await client.close()
  })

  it("honours explicit layout:false on topology edits and never bakes redacted reads into writes", async () => {
    const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
    const created = await dispatchOk<{ workflowId: string; rev: number }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "secret-layout",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        {
          nodeId: "a",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: { method: "POST", headers: [{ key: "Authorization", value: "Bearer live-credential" }] },
        },
        { nodeId: "end", type: "end", position: { x: 0, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "a" },
        { edgeId: "e2", source: "a", target: "end" },
      ],
      layout: false,
    })
    const client = await connectClient()
    const patched = await client.callTool({
      name: "workflows_patch",
      arguments: {
        workspaceId: workspace.workspaceId,
        workflowId: created.workflowId,
        expectedRevision: created.rev,
        layout: false,
        upsertNodes: [{ nodeId: "b", type: "delay", position: { x: 0, y: 0 }, config: { duration: 5 } }],
        upsertEdges: [{ edgeId: "e3", source: "a", target: "b" }],
      },
    })
    expect((patched as { isError?: boolean }).isError).toBeFalsy()
    const persisted = await dispatchOk<{ nodes: Array<{ nodeId: string; position: { x: number; y: number }; config?: { headers?: Array<{ key: string; value: string }> } }> }>(
      "workflows",
      "get",
      { workspaceId: workspace.workspaceId, workflowId: created.workflowId },
    )
    // Explicit preserve wins over topology auto-layout.
    expect(persisted.nodes.find((node) => node.nodeId === "a")?.position).toEqual({ x: 0, y: 0 })
    // The stored credential survived a write that never named it.
    expect(persisted.nodes.find((node) => node.nodeId === "a")?.config?.headers?.[0]?.value).toBe(
      "Bearer live-credential",
    )
    await client.close()
  })
})

describe("Phase 5 — concise task-specific onboarding", () => {
  it("keeps initialize instructions small and task-specific", async () => {
    const client = await connectClient()
    const instructions = client.getInstructions() ?? ""
    expect(instructions).toContain("APIWEAVE_WORKSPACE_ID")
    expect(instructions).toContain("workflows_patch")
    expect(instructions).toContain("expectedRevision")
    expect(instructions).toContain("diagnosis")
    expect(instructions).toContain("workflows_debugContext")
    expect(instructions).toContain("edit-debug")
    expect(Buffer.byteLength(instructions, "utf8")).toBeLessThan(1600)
    await client.close()
  })

  it("keeps the session briefing session-specific with project-scoped discovery", () => {
    const workflowBriefing = buildSessionBriefing({
      workspaceId: "ws-1",
      scopeKind: "workflow",
      scopeId: "wf-1",
      scopeName: "Checkout",
      cwd: "/repo",
      mcpWired: true,
    })
    expect(workflowBriefing).toContain("wf-1")
    expect(workflowBriefing).toContain("ws-1")
    expect(workflowBriefing).not.toContain("Conventions that are easy to get wrong")

    const projectBriefing = buildSessionBriefing({
      workspaceId: "ws-1",
      scopeKind: "project",
      scopeId: "col-1",
      scopeName: "Shop",
      cwd: "/repo",
      mcpWired: true,
    })
    expect(projectBriefing).toContain("workflows_search")
  })

  it("serves the edit-debug quickstart from the same guide source over resources and the registry", async () => {
    const slugs = MCP_GUIDES.map((guide) => guide.slug)
    expect(slugs).toContain("edit-debug")

    const client = await connectClient()
    const { resources } = await client.listResources()
    expect(resources.map((resource) => resource.uri)).toContain("apiweave://guide/edit-debug")

    const listed = await client.callTool({ name: "guides_list", arguments: {} })
    const listBody = JSON.parse(textOf(listed as { content: Array<{ type: string; text?: string }> })) as {
      guides: Array<{ slug: string; uri: string }>
    }
    expect(listBody.guides.map((guide) => guide.slug)).toEqual(slugs)

    const fetched = await client.callTool({ name: "guides_get", arguments: { slug: "edit-debug" } })
    const body = JSON.parse(textOf(fetched as { content: Array<{ type: string; text?: string }> })) as {
      slug: string
      text: string
    }
    expect(body.slug).toBe("edit-debug")
    expect(body.text).toBe(MCP_GUIDES.find((guide) => guide.slug === "edit-debug")?.text)

    const missing = await client.callTool({ name: "guides_get", arguments: { slug: "nope" } })
    expect((missing as { isError?: boolean }).isError).toBe(true)
    await client.close()
  })

  it("publishes the guide tools and the assertion runId contract without touching exclusions", () => {
    const names = new Set(MCP_TOOLS.map(toolName))
    expect(names.has("guides_list")).toBe(true)
    expect(names.has("guides_get")).toBe(true)
    expect(names.has("assertion_apply")).toBe(true)
    for (const excluded of ["secrets.set", "secrets.delete", "agents.launchExternal", "runs.openArtifact"]) {
      expect(names.has(excluded)).toBe(false)
    }
  })
})
