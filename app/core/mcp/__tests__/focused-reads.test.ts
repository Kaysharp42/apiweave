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
 * Phase 2 (focused reads) exit conditions and security cases:
 * - Large listings never include full graphs.
 * - Targeted edits can identify required boundary edges without a full read.
 * - Continuation is explicit and correct (opaque filter-bound revision-safe
 *   cursors, stated budgets, no silent slicing).
 * - Redaction, strict schemas, revision protection and the explicit whitelist
 *   hold for every new read.
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

type SearchPage = { items: Array<Record<string, unknown>>; nextCursor: string | null }

async function seedWorkspace(name = "Acme"): Promise<string> {
  // isPersonal workspaces are idempotent (second create returns the first),
  // so every test workspace is explicitly non-personal.
  const workspace = await dispatchOk<{ workspaceId: string }>("workspaces", "create", { name, isPersonal: false })
  return workspace.workspaceId
}

function chainNodes(count: number, config?: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({
    nodeId: `n${index}`,
    type: "http-request",
    position: { x: index * 100, y: 0 },
    ...(config !== undefined ? { config } : {}),
  }))
}

describe("Phase 2 — workflow search returns summaries, never graphs", () => {
  it("lists graph-free summaries and includes project-attached workflows by default", async () => {
    const workspaceId = await seedWorkspace()
    const collection = await dispatchOk<{ collectionId: string }>("projects", "create", { workspaceId, name: "Col" })
    const plain = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "plain",
      nodes: chainNodes(3, { method: "GET", url: "https://example.test" }),
      variables: { token: "must-not-travel" },
    })
    const attached = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "attached",
      collectionId: collection.collectionId,
    })

    const page = await dispatchOk<SearchPage>("workflows", "search", { workspaceId })
    expect(page.nextCursor).toBeNull()

    const ids = page.items.map((item) => item["workflowId"])
    expect(ids).toContain(plain.workflowId)
    // Unlike workflows.list, search does not hide project workflows.
    expect(ids).toContain(attached.workflowId)

    for (const item of page.items) {
      expect(item).not.toHaveProperty("nodes")
      expect(item).not.toHaveProperty("edges")
      expect(item).not.toHaveProperty("variables")
      expect(item).not.toHaveProperty("nodeTemplates")
      expect(item).toMatchObject({ nodeCount: expect.any(Number), edgeCount: expect.any(Number) })
    }
    expect(page.items.find((item) => item["workflowId"] === plain.workflowId)).toMatchObject({
      name: "plain",
      nodeCount: 3,
      edgeCount: 0,
    })
  })

  it("filters by name query, project and tags", async () => {
    const workspaceId = await seedWorkspace()
    const first = await dispatchOk<{ collectionId: string }>("projects", "create", { workspaceId, name: "First" })
    const second = await dispatchOk<{ collectionId: string }>("projects", "create", { workspaceId, name: "Second" })
    const orders = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "Orders API",
      collectionId: first.collectionId,
      tags: ["smoke", "orders"],
    })
    await dispatchOk("workflows", "create", {
      workspaceId,
      name: "Orders nightly",
      collectionId: second.collectionId,
      tags: ["nightly"],
    })
    await dispatchOk("workflows", "create", { workspaceId, name: "Users API", tags: ["smoke"] })

    const byName = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, query: "orders" })
    expect(byName.items.map((item) => item["workflowId"]).sort()).toEqual(
      [orders.workflowId, byName.items.find((item) => item["name"] === "Orders nightly")?.workflowId].sort(),
    )

    const byProject = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, collectionId: first.collectionId })
    expect(byProject.items.map((item) => item["workflowId"])).toEqual([orders.workflowId])

    const byTags = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, tags: ["smoke", "orders"] })
    expect(byTags.items.map((item) => item["workflowId"])).toEqual([orders.workflowId])
  })

  it("treats LIKE metacharacters as literal text", async () => {
    const workspaceId = await seedWorkspace()
    await dispatchOk("workflows", "create", { workspaceId, name: "100% coverage_check" })
    await dispatchOk("workflows", "create", { workspaceId, name: "unrelated" })

    const percent = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, query: "100%" })
    expect(percent.items.map((item) => item["name"])).toEqual(["100% coverage_check"])

    const underscore = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, query: "coverage_check" })
    expect(underscore.items.map((item) => item["name"])).toEqual(["100% coverage_check"])
  })

  it("paginates deterministically with an explicit continuation", async () => {
    const workspaceId = await seedWorkspace()
    for (const name of ["alpha", "beta", "gamma"]) {
      await dispatchOk("workflows", "create", { workspaceId, name })
    }

    const first = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, limit: 1 })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).not.toBeNull()

    const second = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, limit: 1, cursor: first.nextCursor })
    const third = await dispatchOk<SearchPage>("workflows", "search", {
      workspaceId,
      limit: 1,
      cursor: second.nextCursor,
    })
    expect(third.items).toHaveLength(1)
    expect(third.nextCursor).toBeNull()

    const seen = [...first.items, ...second.items, ...third.items].map((item) => item["name"])
    expect([...seen].sort()).toEqual(["alpha", "beta", "gamma"])
    // Deterministic: the same read repeats the same order.
    const again = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, limit: 1 })
    expect(again.items).toEqual(first.items)
    const againSecond = await dispatchOk<SearchPage>("workflows", "search", {
      workspaceId,
      limit: 1,
      cursor: first.nextCursor,
    })
    expect(againSecond.items).toEqual(second.items)
  })

  it("rejects a cursor used against different filters", async () => {
    const workspaceId = await seedWorkspace()
    await dispatchOk("workflows", "create", { workspaceId, name: "alpha" })
    await dispatchOk("workflows", "create", { workspaceId, name: "beta" })
    const first = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, limit: 1 })
    expect(first.nextCursor).not.toBeNull()

    const error = await dispatchErr("workflows", "search", { workspaceId, query: "beta", cursor: first.nextCursor })
    expect(error.code).toBe("validation")
    expect(error.message).toContain("different filters")
  })

  it("rejects a cursor issued before the list changed", async () => {
    const workspaceId = await seedWorkspace()
    await dispatchOk("workflows", "create", { workspaceId, name: "alpha" })
    await dispatchOk("workflows", "create", { workspaceId, name: "beta" })
    const first = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, limit: 1 })
    expect(first.nextCursor).not.toBeNull()

    await dispatchOk("workflows", "create", { workspaceId, name: "gamma" })
    const error = await dispatchErr("workflows", "search", { workspaceId, limit: 1, cursor: first.nextCursor })
    expect(error.code).toBe("conflict")
    expect(error.message).toContain("without a cursor")
  })

  it("rejects tampered and foreign cursors", async () => {
    const workspaceId = await seedWorkspace()
    await dispatchOk("workflows", "create", { workspaceId, name: "alpha" })

    const tampered = await dispatchErr("workflows", "search", { workspaceId, cursor: "not-a-cursor" })
    expect(tampered.code).toBe("validation")

    const otherId = await seedWorkspace("Other")
    await dispatchOk("workflows", "create", { workspaceId: otherId, name: "alpha" })
    await dispatchOk("workflows", "create", { workspaceId: otherId, name: "beta" })
    const foreign = await dispatchOk<SearchPage>("workflows", "search", { workspaceId: otherId, limit: 1 })
    const cross = await dispatchErr("workflows", "search", { workspaceId, limit: 1, cursor: foreign.nextCursor })
    expect(cross.code).toBe("validation")
  })

  it("scopes search to one workspace and never matches stored secret values", async () => {
    const workspaceId = await seedWorkspace()
    const otherId = await seedWorkspace("Other")
    await dispatchOk("workflows", "create", {
      workspaceId,
      name: "payments",
      nodes: [{
        nodeId: "pay",
        type: "http-request",
        position: { x: 0, y: 0 },
        config: {
          method: "POST",
          url: "https://example.test/pay?token=opaque-search-secret-1",
          headers: [{ key: "Authorization", value: "Bearer opaque-search-secret-1" }],
          body: "{\"password\":\"opaque-search-secret-1\"}",
        },
      }],
    })
    await dispatchOk("workflows", "create", { workspaceId: otherId, name: "payments" })

    const scoped = await dispatchOk<SearchPage>("workflows", "search", { workspaceId: otherId, query: "payments" })
    expect(scoped.items.map((item) => item["name"])).toEqual(["payments"])

    const secretHit = await dispatchOk<SearchPage>("workflows", "search", { workspaceId, query: "opaque-search-secret-1" })
    expect(secretHit.items).toEqual([])
  })
})

describe("Phase 2 — outline and nodes views bound targeted edits", () => {
  async function seedChain(): Promise<{ workspaceId: string; workflowId: string }> {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "chain",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "a", type: "http-request", position: { x: 100, y: 0 }, config: { method: "GET", url: "https://example.test/a" } },
        { nodeId: "b", type: "http-request", position: { x: 200, y: 0 }, config: { method: "GET", url: "https://example.test/b" } },
        { nodeId: "end", type: "end", position: { x: 300, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "a" },
        { edgeId: "e2", source: "a", target: "b" },
        { edgeId: "e3", source: "b", target: "end" },
      ],
    })
    return { workspaceId, workflowId: workflow.workflowId }
  }

  it("outline carries structure without positions or configs, and pages explicitly", async () => {
    const { workspaceId, workflowId } = await seedChain()
    const first = await dispatchOk<Record<string, unknown>>("workflows", "get", {
      workspaceId,
      workflowId,
      view: "outline",
      nodeLimit: 2,
    })

    expect(first["view"]).toBe("outline")
    expect(first["partial"]).toBe(true)
    expect(first).toMatchObject({ nodeCount: 4, edgeCount: 3, omittedNodeCount: 2, omittedEdgeCount: 1 })
    const nodes = first["nodes"] as Array<Record<string, unknown>>
    expect(nodes.map((node) => node["nodeId"])).toEqual(["start", "a"])
    for (const node of nodes) {
      expect(Object.keys(node).sort()).toEqual(["label", "nodeId", "type"])
    }
    expect(first).not.toHaveProperty("variables")
    expect(typeof first["nextNodeCursor"]).toBe("string")

    const second = await dispatchOk<Record<string, unknown>>("workflows", "get", {
      workspaceId,
      workflowId,
      view: "outline",
      nodeLimit: 2,
      nodeCursor: first["nextNodeCursor"],
    })
    expect((second["nodes"] as Array<Record<string, unknown>>).map((node) => node["nodeId"])).toEqual(["b", "end"])
    expect(second["nextNodeCursor"]).toBeNull()
    expect(second).toMatchObject({ omittedNodeCount: 0 })
  })

  it("outline cursors are revision-bound", async () => {
    const { workspaceId, workflowId } = await seedChain()
    const created = await dispatchOk<{ rev: number }>("workflows", "get", { workspaceId, workflowId })
    const first = await dispatchOk<Record<string, unknown>>("workflows", "get", {
      workspaceId,
      workflowId,
      view: "outline",
      nodeLimit: 1,
    })

    await dispatchOk("workflows", "patch", {
      workspaceId,
      workflowId,
      expectedRevision: created.rev,
      setVariables: { marker: "x" },
    })
    const stale = await dispatchErr("workflows", "get", {
      workspaceId,
      workflowId,
      view: "outline",
      nodeLimit: 1,
      nodeCursor: first["nextNodeCursor"],
    })
    expect(stale.code).toBe("conflict")
  })

  it("nodes view keeps configs, adds boundary edges and names the missing", async () => {
    const { workspaceId, workflowId } = await seedChain()
    const view = await dispatchOk<Record<string, unknown>>("workflows", "get", {
      workspaceId,
      workflowId,
      view: "nodes",
      nodeIds: ["a", "b", "ghost"],
    })

    expect(view["view"]).toBe("nodes")
    expect(view["partial"]).toBe(true)
    const nodes = view["nodes"] as Array<{ nodeId: string; config: Record<string, unknown> }>
    expect(nodes.map((node) => node.nodeId)).toEqual(["a", "b"])
    expect(nodes[0]?.config["url"]).toBe("https://example.test/a")
    expect((view["edges"] as Array<{ edgeId: string }>).map((edge) => edge.edgeId).sort()).toEqual(["e1", "e2", "e3"])
    expect(view["boundaryNodes"]).toEqual([
      { nodeId: "end", type: "end", label: null },
      { nodeId: "start", type: "start", label: null },
    ])
    expect(view["missingNodeIds"]).toEqual(["ghost"])
  })

  it("rejects contradictory and oversized node reads", async () => {
    const { workspaceId, workflowId } = await seedChain()

    const contradictory = await dispatchErr("workflows", "get", {
      workspaceId,
      workflowId,
      view: "full",
      nodeIds: ["a"],
    })
    expect(contradictory.code).toBe("validation")

    const missingIds = await dispatchErr("workflows", "get", { workspaceId, workflowId, view: "nodes" })
    expect(missingIds.code).toBe("validation")

    const tooMany = await dispatchErr("workflows", "get", {
      workspaceId,
      workflowId,
      view: "nodes",
      nodeIds: Array.from({ length: 51 }, (_, index) => `n${index}`),
    })
    expect(tooMany.code).toBe("validation")
  })

  it("full view keeps the complete stored graph for the renderer", async () => {
    const { workspaceId, workflowId } = await seedChain()
    const full = await dispatchOk<{ nodes: Array<{ position: { x: number; y: number } }>; variables: unknown }>(
      "workflows",
      "get",
      { workspaceId, workflowId },
    )
    expect(full.nodes).toHaveLength(4)
    expect(full.nodes[1]?.position).toEqual({ x: 100, y: 0 })
  })

  it("hides workflows outside the workspace", async () => {
    const { workflowId } = await seedChain()
    const error = await dispatchErr("workflows", "get", {
      workspaceId: "ws-not-mine",
      workflowId,
      view: "outline",
    })
    expect(error.code).toBe("not_found")
  })
})

describe("Phase 2 — node search over safe fields only", () => {
  async function seedOrders(): Promise<{ workspaceId: string; workflowId: string }> {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "orders",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        {
          nodeId: "get-order",
          type: "http-request",
          label: "Fetch order",
          position: { x: 100, y: 0 },
          config: {
            method: "GET",
            url: "{{env.BASE_URL}}/orders/{{variables.orderId}}",
            extractors: { orderId: "response.body.id" },
          },
        },
        { nodeId: "check", type: "assertion", position: { x: 200, y: 0 }, config: { assertions: [] } },
        { nodeId: "end", type: "end", position: { x: 300, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "get-order" },
        { edgeId: "e2", source: "get-order", target: "check", sourceHandle: "pass" },
        { edgeId: "e3", source: "check", target: "end", sourceHandle: "pass" },
      ],
    })
    return { workspaceId, workflowId: workflow.workflowId }
  }

  type MatchPage = {
    items: Array<{ nodeId: string; matchedOn: string[]; neighborNodeIds: string[]; incidentEdgeIds: string[] }>
    totalMatched: number
    omittedMatchCount: number
  }

  it("matches label, method, url path, extractor names and type", async () => {
    const { workspaceId, workflowId } = await seedOrders()

    const byLabel = await dispatchOk<MatchPage>("workflows", "searchNodes", { workspaceId, workflowId, query: "fetch order" })
    expect(byLabel.items.map((item) => item.nodeId)).toEqual(["get-order"])
    expect(byLabel.items[0]?.matchedOn).toContain("label")
    expect(byLabel.items[0]?.neighborNodeIds.sort()).toEqual(["check", "start"])
    expect(byLabel.items[0]?.incidentEdgeIds.sort()).toEqual(["e1", "e2"])

    const byMethod = await dispatchOk<MatchPage>("workflows", "searchNodes", { workspaceId, workflowId, query: "GET" })
    expect(byMethod.items.map((item) => item.nodeId)).toEqual(["get-order"])
    expect(byMethod.items[0]?.matchedOn).toContain("method")

    const byPath = await dispatchOk<MatchPage>("workflows", "searchNodes", { workspaceId, workflowId, query: "/orders/" })
    expect(byPath.items.map((item) => item.nodeId)).toEqual(["get-order"])
    expect(byPath.items[0]?.matchedOn).toContain("urlPath")

    const byExtractor = await dispatchOk<MatchPage>("workflows", "searchNodes", { workspaceId, workflowId, query: "orderid" })
    expect(byExtractor.items.map((item) => item.nodeId)).toContain("get-order")
    expect(byExtractor.items.find((item) => item.nodeId === "get-order")?.matchedOn).toContain("extractor")

    const byType = await dispatchOk<MatchPage>("workflows", "searchNodes", {
      workspaceId,
      workflowId,
      query: "no-such-label",
      nodeTypes: ["assertion"],
    })
    expect(byType.items).toEqual([])
  })

  it("never matches bodies, headers, auth or query values", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "guarded",
      nodes: [{
        nodeId: "pay",
        type: "http-request",
        position: { x: 0, y: 0 },
        config: {
          method: "POST",
          url: "https://example.test/pay?token=node-search-guard-9",
          headers: [{ key: "Authorization", value: "Bearer node-search-guard-9" }],
          body: "{\"password\":\"node-search-guard-9\"}",
        },
      }],
    })

    for (const query of ["node-search-guard-9", "Bearer", "password"]) {
      const page = await dispatchOk<MatchPage>("workflows", "searchNodes", {
        workspaceId,
        workflowId: workflow.workflowId,
        query,
      })
      expect(page.totalMatched).toBe(0)
    }
  })

  it("treats the query as a literal substring and states omission", async () => {
    const { workspaceId, workflowId } = await seedOrders()

    const regex = await dispatchOk<MatchPage>("workflows", "searchNodes", { workspaceId, workflowId, query: "get-.*" })
    expect(regex.totalMatched).toBe(0)

    const page = await dispatchOk<MatchPage>("workflows", "searchNodes", { workspaceId, workflowId, query: "e", limit: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.totalMatched).toBeGreaterThan(1)
    expect(page.omittedMatchCount).toBe(page.totalMatched - 1)
  })

  it("requires a query or a type filter", async () => {
    const { workspaceId, workflowId } = await seedOrders()
    const error = await dispatchErr("workflows", "searchNodes", { workspaceId, workflowId })
    expect(error.code).toBe("validation")
  })
})

describe("Phase 2 — compact run history with continuations", () => {
  async function seedRuns(count: number): Promise<{ workspaceId: string; workflowId: string; runIds: string[] }> {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "history" })
    const runIds: string[] = []
    for (let index = 0; index < count; index += 1) {
      const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
      runRepository.update(run.runId, {
        status: index % 2 === 0 ? "failed" : "completed",
        results: [{ nodeId: "n0", status: index % 2 === 0 ? "failed" : "passed", duration: index }],
        failedNodes: index % 2 === 0 ? ["n0"] : [],
      })
      runIds.push(run.runId)
    }
    return { workspaceId, workflowId: workflow.workflowId, runIds }
  }

  type HistoryPage = { items: Array<Record<string, unknown>>; nextCursor: string | null }

  it("returns constant-size rows without per-node results, newest first", async () => {
    const { workspaceId, workflowId } = await seedRuns(3)
    const page = await dispatchOk<HistoryPage>("runs", "history", { workspaceId, workflowId })

    expect(page.nextCursor).toBeNull()
    expect(page.items).toHaveLength(3)
    for (const item of page.items) {
      expect(item).not.toHaveProperty("results")
      expect(item).not.toHaveProperty("nodeStatuses")
      expect(item).not.toHaveProperty("variables")
      expect(item).toMatchObject({ workspaceId, workflowId, failedNodeCount: expect.any(Number), nodeCount: 1 })
      expect(typeof item["runRev"]).toBe("number")
    }
    const failed = page.items.filter((item) => item["status"] === "failed")
    expect(failed).toHaveLength(2)
    expect(failed[0]).toMatchObject({ failedNodes: ["n0"], failedNodeCount: 1 })
  })

  it("paginates, filters by status and rejects stale cursors", async () => {
    const { workspaceId, workflowId } = await seedRuns(4)

    const first = await dispatchOk<HistoryPage>("runs", "history", { workspaceId, workflowId, limit: 3 })
    expect(first.items).toHaveLength(3)
    expect(first.nextCursor).not.toBeNull()

    const second = await dispatchOk<HistoryPage>("runs", "history", {
      workspaceId,
      workflowId,
      limit: 3,
      cursor: first.nextCursor,
    })
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    const seen = new Set([...first.items, ...second.items].map((item) => item["runId"] as string))
    expect(seen.size).toBe(4)

    const failed = await dispatchOk<HistoryPage>("runs", "history", { workspaceId, workflowId, status: "failed" })
    expect(failed.items).toHaveLength(2)

    const moved = await dispatchErr("runs", "history", {
      workspaceId,
      workflowId,
      status: "failed",
      cursor: first.nextCursor,
    })
    expect(moved.code).toBe("validation")

    const extra = runRepository.create({ workspaceId, workflowId })
    void extra
    const stale = await dispatchErr("runs", "history", {
      workspaceId,
      workflowId,
      limit: 3,
      cursor: first.nextCursor,
    })
    expect(stale.code).toBe("conflict")
  })

  it("scopes history to one workspace", async () => {
    const { workflowId } = await seedRuns(2)
    const otherId = await seedWorkspace("Other")
    const empty = await dispatchOk<HistoryPage>("runs", "history", { workspaceId: otherId, workflowId })
    expect(empty).toEqual({ items: [], nextCursor: null })

    const unknown = await dispatchErr("runs", "history", { workspaceId: "ws-not-mine", workflowId })
    expect(unknown.code).toBe("not_found")
  })

  it("projects run history to slim rows without failed-node detail", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "slim" })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      results: [{ nodeId: "n0", status: "failed", duration: 3 }],
      failedNodes: ["n0"],
    })

    const client = await connectClient()
    const result = await client.callTool({
      name: "runs_history",
      arguments: { workspaceId, workflowId: workflow.workflowId },
    })
    const parsed = JSON.parse(textOf(result as { content: Array<{ type: string; text?: string }> })) as {
      items: Array<Record<string, unknown>>
    }
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]).not.toHaveProperty("results")
    expect(parsed.items[0]).not.toHaveProperty("nodeStatuses")
    expect(parsed.items[0]).not.toHaveProperty("failedNodeDetails")
    expect(parsed.items[0]).toMatchObject({ failedNodeCount: 1, nodeCount: 1 })
    await client.close()
  })
})

describe("Phase 2 — targeted node evidence", () => {
  async function seedFailedRun(): Promise<{ workspaceId: string; runId: string }> {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "evidence" })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      results: [
        {
          nodeId: "login",
          status: "failed",
          duration: 12,
          request: { method: "POST", url: "https://example.test/login", body: "{\"user\":\"ann\"}" },
          response: {
            statusCode: 401,
            headers: { "content-type": "application/json" },
            body: { error: { code: "BAD_CREDENTIALS", retryable: false }, trace: [1, 2, 3] },
          },
          error: "Request failed with status 401",
          expectedStatus: 200,
          unresolvedPlaceholders: ["env.PASSWORD"],
          assertions: [{
            ruleIndex: 0,
            source: "status",
            path: "",
            operator: "equals",
            sourceNodeId: null,
            expectedState: "literal",
            expectedType: "number",
            actualState: "present",
            actualType: "number",
            outcome: "fail",
            reasonCode: "comparison-failed",
          }],
          extractorOutcomes: [{
            producerNodeId: "login",
            variableName: "token",
            path: "response.body.token",
            matched: false,
            observedType: null,
            failureReason: "path-missing",
          }],
        },
        {
          nodeId: "ok",
          status: "passed",
          duration: 4,
          response: { statusCode: 200, body: { ok: true } },
        },
      ],
      failedNodes: ["login"],
    })
    return { workspaceId, runId: run.runId }
  }

  type EvidencePage = {
    runId: string
    items: Array<{
      nodeId: string
      status: string
      error?: string
      assertions?: unknown
      extractorOutcomes?: unknown
      request?: Record<string, unknown>
      response?: Record<string, unknown> & { pathStatus?: string }
      omittedSections: string[]
      budgetOmitted: boolean
      expectedStatus?: number
      unresolvedPlaceholders: string[]
    }>
    missingNodeIds: string[]
    omittedBodyCount: number
    budgetBytes: number
    budgetLimitBytes: number
  }

  it("returns selected sections and names the omitted ones", async () => {
    const { workspaceId, runId } = await seedFailedRun()
    const page = await dispatchOk<EvidencePage>("runs", "getNodeResult", {
      workspaceId,
      runId,
      nodeId: "login",
      sections: ["error", "response"],
    })

    const item = page.items[0]!
    expect(item.error).toBe("Request failed with status 401")
    expect(item.response?.statusCode).toBe(401)
    expect(item.assertions).toBeUndefined()
    expect(item.extractorOutcomes).toBeUndefined()
    expect(item.request).toBeUndefined()
    expect(item.omittedSections.sort()).toEqual(["assertions", "extractors", "request"])
    expect(item.expectedStatus).toBe(200)
    expect(item.unresolvedPlaceholders).toEqual(["env.PASSWORD"])
  })

  it("selects within a JSON body by extractor-grammar path and reports misses", async () => {
    const { workspaceId, runId } = await seedFailedRun()

    const hit = await dispatchOk<EvidencePage>("runs", "getNodeResult", {
      workspaceId,
      runId,
      nodeId: "login",
      sections: ["response"],
      path: "response.body.error.code",
    })
    expect(hit.items[0]?.response?.preview).toBe("\"BAD_CREDENTIALS\"")
    expect(hit.items[0]?.response?.pathStatus).toBe("resolved")

    const miss = await dispatchOk<EvidencePage>("runs", "getNodeResult", {
      workspaceId,
      runId,
      nodeId: "login",
      sections: ["response"],
      path: "response.body.token",
    })
    expect(miss.items[0]?.response?.preview).toBeUndefined()
    expect(miss.items[0]?.response?.pathStatus).toBe("path-missing")
  })

  it("caps text previews with explicit ranges and totals", async () => {
    const { workspaceId, runId } = await seedFailedRun()
    const page = await dispatchOk<EvidencePage>("runs", "getNodeResult", {
      workspaceId,
      runId,
      nodeId: "login",
      sections: ["request"],
      maxBytes: 8,
    })
    expect(page.items[0]?.request?.preview).toBe("{\"user\":")
    expect(page.items[0]?.request?.previewTruncated).toBe(true)
    expect(page.items[0]?.request?.totalBytes).toBe("{\"user\":\"ann\"}".length)

    const window = await dispatchOk<EvidencePage>("runs", "getNodeResult", {
      workspaceId,
      runId,
      nodeId: "login",
      sections: ["request"],
      start: 1,
      end: 8,
    })
    expect(window.items[0]?.request?.preview).toBe("\"user\":")
    expect(window.items[0]?.request?.previewTruncated).toBe(true)
  })

  it("flags stored truncation distinctly from output omission", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "truncated" })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      results: [{
        nodeId: "big",
        status: "failed",
        duration: 9,
        response: { statusCode: 200, body: "partial…", truncated: true },
      }],
    })

    const page = await dispatchOk<EvidencePage>("runs", "getNodeResult", { workspaceId, runId: run.runId, nodeId: "big" })
    expect(page.items[0]?.response?.storedTruncated).toBe(true)
    expect(page.items[0]?.budgetOmitted).toBe(false)
  })

  it("holds large evidence to the stated budget without losing metadata", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "budget" })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    const big = "x".repeat(10_000)
    runRepository.update(run.runId, {
      status: "failed",
      results: Array.from({ length: 6 }, (_, index) => ({
        nodeId: `n${index}`,
        status: "failed" as const,
        duration: index,
        request: { method: "POST", url: "https://example.test/submit", body: big },
        response: { statusCode: 500, body: big },
      })),
      failedNodes: ["n0"],
    })

    const page = await dispatchOk<EvidencePage>("runs", "getNodeResult", {
      workspaceId,
      runId: run.runId,
      nodeIds: ["n0", "n1", "n2", "n3", "n4", "n5"],
      maxBytes: 8192,
    })
    expect(page.budgetBytes).toBeLessThanOrEqual(page.budgetLimitBytes)
    expect(page.omittedBodyCount).toBeGreaterThan(0)
    expect(page.items).toHaveLength(6)
    expect(page.items.map((item) => item.nodeId)).toEqual(["n0", "n1", "n2", "n3", "n4", "n5"])
    for (const item of page.items.filter((candidate) => candidate.budgetOmitted)) {
      expect(item.status).toBe("failed")
      expect(item.response?.preview).toBeUndefined()
      expect(item.response?.totalBytes).toBe(10_000)
    }
  })

  it("keeps request order, reports missing ids and validates selection input", async () => {
    const { workspaceId, runId } = await seedFailedRun()
    const page = await dispatchOk<EvidencePage>("runs", "getNodeResult", {
      workspaceId,
      runId,
      nodeIds: ["ok", "ghost", "login", "ok"],
    })
    expect(page.items.map((item) => item.nodeId)).toEqual(["ok", "login"])
    expect(page.missingNodeIds).toEqual(["ghost"])

    const missing = await dispatchErr("runs", "getNodeResult", { workspaceId, runId })
    expect(missing.code).toBe("validation")

    const range = await dispatchErr("runs", "getNodeResult", { workspaceId, runId, nodeId: "ok", start: 5, end: 5 })
    expect(range.code).toBe("validation")
  })

  it("redacts secret leaves in previews while keeping structure", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "leak" })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      results: [{
        nodeId: "login",
        status: "failed",
        duration: 7,
        response: { statusCode: 200, body: { name: "Rex", password: "evidence-guard-secret" } },
      }],
    })

    const client = await connectClient()
    const result = await client.callTool({
      name: "runs_getNodeResult",
      arguments: { workspaceId, runId: run.runId, nodeId: "login", sections: ["response"] },
    })
    const text = textOf(result as { content: Array<{ type: string; text?: string }> })
    expect(text).not.toContain("evidence-guard-secret")
    expect(JSON.parse(text).items[0].response.preview).toContain("Rex")
    await client.close()
  })
})

describe("Phase 2 — whitelist publishes the focused reads and nothing else", () => {
  it("exposes search, views, history and evidence instead of full-graph listings", () => {
    const names = new Set(MCP_TOOLS.map(toolName))
    for (const expected of ["workflows_search", "workflows_searchNodes", "workflows_get", "runs_history", "runs_getNodeResult"]) {
      expect(names.has(expected), expected).toBe(true)
    }
    expect(names.has("workflows_list")).toBe(false)
  })

  it("keeps the secret, agent and artifact exclusions", () => {
    const names = new Set(MCP_TOOLS.map((spec) => `${spec.domain}.${spec.action}`))
    for (const excluded of [
      "secrets.set",
      "secrets.delete",
      "secrets.duplicate",
      "secrets.moveToScope",
      "runs.getArtifacts",
      "runs.openArtifact",
      "runs.saveArtifactAs",
    ]) {
      expect(names.has(excluded), excluded).toBe(false)
    }
    for (const spec of MCP_TOOLS) {
      expect(spec.domain).not.toBe("agents")
    }
  })

  it("states explicit budgets and continuations in focused-read descriptions", () => {
    const byName = new Map(MCP_TOOLS.map((spec) => [toolName(spec), spec.description]))
    expect(byName.get("workflows_search")).toMatch(/20.*100|default 20/i)
    expect(byName.get("workflows_search")).toContain("nextCursor")
    expect(byName.get("workflows_get")).toContain("50")
    expect(byName.get("workflows_searchNodes")).toMatch(/20.*100|default 20/i)
    expect(byName.get("workflows_searchNodes")).toContain("omittedMatchCount")
    expect(byName.get("runs_history")).toMatch(/20.*100|default 20/i)
    expect(byName.get("runs_history")).toContain("nextCursor")
    expect(byName.get("runs_getNodeResult")).toContain("50")
    expect(byName.get("runs_getNodeResult")).toMatch(/32 KiB|budgetOmitted/i)
  })
})

describe("Phase 2 — group/note structure stays representable in focused reads", () => {
  it("carries group frames, parent-relative members and notes through outline, search and nodes views", async () => {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", {
      workspaceId,
      name: "framed",
      nodes: [
        { nodeId: "frame", type: "group", position: { x: 0, y: 0 }, config: { width: 600, height: 200 } },
        {
          nodeId: "inner",
          type: "http-request",
          position: { x: 10, y: 10 },
          parentId: "frame",
          config: { method: "GET", url: "https://example.test/inner" },
        },
        { nodeId: "sticky", type: "note", position: { x: 0, y: 250 }, config: { content: "branch note" } },
      ],
    })

    const outline = await dispatchOk<{
      nodes: Array<{ nodeId: string; type: string }>
      nodeCount: number
      partial: boolean
    }>("workflows", "get", { workspaceId, workflowId: workflow.workflowId, view: "outline" })
    expect(outline.partial).toBe(true)
    expect(outline.nodeCount).toBe(3)
    expect(outline.nodes.map((node) => node.nodeId).sort()).toEqual(["frame", "inner", "sticky"])

    const groups = await dispatchOk<{
      items: Array<{ nodeId: string; type: string }>
      totalMatched: number
    }>("workflows", "searchNodes", { workspaceId, workflowId: workflow.workflowId, nodeTypes: ["group", "note"] })
    expect(groups.totalMatched).toBe(2)
    expect(groups.items.map((item) => item.nodeId).sort()).toEqual(["frame", "sticky"])

    const nodes = await dispatchOk<{
      nodes: Array<{ nodeId: string; parentId?: string }>
      partial: boolean
    }>("workflows", "get", { workspaceId, workflowId: workflow.workflowId, view: "nodes", nodeIds: ["inner"] })
    expect(nodes.partial).toBe(true)
    expect(nodes.nodes[0]).toMatchObject({ nodeId: "inner", parentId: "frame" })
  })
})

describe("Phase 2 — evidence path and empty-read edge cases", () => {
  async function seedScalarBody(): Promise<{ workspaceId: string; runId: string }> {
    const workspaceId = await seedWorkspace()
    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "scalar" })
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      status: "failed",
      results: [{
        nodeId: "n0",
        status: "failed",
        duration: 3,
        response: { statusCode: 200, body: { count: 7 } },
      }],
    })
    return { workspaceId, runId: run.runId }
  }

  it("reports a type-mismatch distinctly from a missing path", async () => {
    const { workspaceId, runId } = await seedScalarBody()
    const page = await dispatchOk<{
      items: Array<{ response?: { pathStatus?: string; preview?: string } }>
    }>("runs", "getNodeResult", {
      workspaceId,
      runId,
      nodeId: "n0",
      sections: ["response"],
      path: "response.body.count.id",
    })
    expect(page.items[0]?.response?.pathStatus).toBe("type-mismatch")
    expect(page.items[0]?.response?.preview).toBeUndefined()
  })

  it("returns explicit empty pages instead of errors or silent slices", async () => {
    const workspaceId = await seedWorkspace()
    const emptySearch = await dispatchOk<{ items: unknown[]; nextCursor: string | null }>(
      "workflows",
      "search",
      { workspaceId, query: "nothing-matches-this" },
    )
    expect(emptySearch).toEqual({ items: [], nextCursor: null })

    const workflow = await dispatchOk<{ workflowId: string }>("workflows", "create", { workspaceId, name: "no-runs" })
    const emptyHistory = await dispatchOk<{ items: unknown[]; nextCursor: string | null }>(
      "runs",
      "history",
      { workspaceId, workflowId: workflow.workflowId },
    )
    expect(emptyHistory).toEqual({ items: [], nextCursor: null })

    const emptyNodes = await dispatchOk<{
      items: unknown[]
      totalMatched: number
      omittedMatchCount: number
    }>("workflows", "searchNodes", { workspaceId, workflowId: workflow.workflowId, query: "zzz-no-match" })
    expect(emptyNodes.totalMatched).toBe(0)
    expect(emptyNodes.omittedMatchCount).toBe(0)
    expect(emptyNodes.items).toEqual([])
  })
})
