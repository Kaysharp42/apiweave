import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Workflow } from "@shared/types/Workflow"
import { analyzeWorkflowGraph } from "@shared/analysis/workflow_graph_analyzer"
import { mergeWorkflowNodePatches, WorkflowService } from "../workflow_service"
import { initDatabase, type InitializedDatabase } from "../../db"
import { CollectionRepository, EnvironmentRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { ScopeResolver } from "../scope_resolver"
import { ValidationError } from "../../ipc/errors"

const upserts = [
  { nodeId: "ok", type: "delay", position: { x: 0, y: 0 }, config: { duration: 2 } },
  { nodeId: "other", type: "delay", position: { x: 0, y: 0 }, config: { duration: 3 } },
  { nodeId: "login", type: "http-request", position: { x: 0, y: 0 }, config: { method: "FETCH", url: "/x" } },
]

describe("node validation in a graph patch", () => {
  it("prefixes issue paths with the input list, index and nodeId", () => {
    let thrown: unknown
    try {
      mergeWorkflowNodePatches([] as unknown as Workflow["nodes"], upserts as never, undefined)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ZodError)
    const issues = (thrown as ZodError).issues
    expect(issues.some((issue) => issue.path[0] === "upsertNodes" && issue.path[1] === 2 && issue.path.includes("method"))).toBe(true)
    expect(issues.every((issue) => issue.message.startsWith('nodeId "login": '))).toBe(true)
  })

  /**
   * The replace recipe: a merged patch cannot drop config keys (strict node
   * schemas reject the leftovers), so a locator-kind or action change names the
   * node in `removeNodeIds` and re-upserts its complete definition in the same
   * call. Removals apply before upserts, so the upsert is validated whole
   * against the node schema — never merged with the stored config.
   */
  it("remove+upsert of the same id replaces the node's config outright", () => {
    const nodes = mergeWorkflowNodePatches(
      [
        {
          nodeId: "email",
          type: "browser",
          position: { x: 0, y: 0 },
          config: { action: "fill", locator: { kind: "role", role: "textbox", name: "Email" }, value: "a@example.test" },
        },
      ],
      [
        {
          nodeId: "email",
          type: "browser",
          position: { x: 0, y: 0 },
          config: { action: "fill", locator: { kind: "label", value: "Email address" }, value: "a@example.test" },
        },
      ],
      ["email"],
    )

    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.config).toEqual({
      action: "fill",
      locator: { kind: "label", value: "Email address" },
      value: "a@example.test",
    })
  })
})

/**
 * FB-001…FB-004. The write service, not the transport, owns the rule: `create`,
 * `update` and `patch` all pass through the same check before anything is
 * written, so a rejected request leaves the stored revision untouched.
 */
describe("edge integrity on every write", () => {
  let db: InitializedDatabase
  let workflows: WorkflowRepository
  let service: WorkflowService
  let workspaceId: string
  let workflowId: string

  beforeEach(async () => {
    db = initDatabase({ databasePath: ":memory:" })
    const workspaces = new WorkspaceRepository(db.kvStore)
    workflows = new WorkflowRepository(db.kvStore)
    const collections = new CollectionRepository(db.kvStore)
    const environments = new EnvironmentRepository(db.kvStore)
    const scopeResolver = new ScopeResolver({
      workspaceExists: (id) => workspaces.getById(id) !== undefined,
      environmentExists: (id) => environments.getById(id) !== undefined,
    })
    service = new WorkflowService(workflows, scopeResolver, collections, environments)
    workspaceId = workspaces.create({ name: "Local", slug: "local" }).workspaceId
    const created = await service.create(workspaceId, {
      name: "Orders",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "step", type: "delay", position: { x: 0, y: 0 }, config: { duration: 1 } },
        { nodeId: "check", type: "assertion", position: { x: 0, y: 0 }, config: { assertions: [] } },
        { nodeId: "merge", type: "merge", position: { x: 0, y: 0 }, config: { mergeStrategy: "all" } },
        { nodeId: "end", type: "end", position: { x: 0, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "step" },
        { edgeId: "e2", source: "step", target: "check" },
        { edgeId: "e3", source: "check", target: "merge", sourceHandle: "pass" },
        { edgeId: "e4", source: "merge", target: "end" },
      ],
    })
    workflowId = created.workflowId
  })

  afterEach(() => db.close())

  /** Await a request that must be rejected, and hand back the error to inspect. */
  async function rejected(request: Promise<unknown>): Promise<ValidationError> {
    const outcome = await request.then(() => undefined, (error: unknown) => error)
    expect(outcome).toBeInstanceOf(ValidationError)
    return outcome as ValidationError
  }

  it("rejects a patched edge whose endpoint is not in the resulting graph, and writes nothing", async () => {
    const before = workflows.getById(workflowId)!

    const error = await rejected(service.patch(workspaceId, workflowId, {
      upsertEdges: [{ edgeId: "e9", source: "step", target: "ghost" }],
    }))

    expect(error.message).toContain('upsertEdges[0] ("e9")')
    expect(error.message).toContain('target node "ghost"')
    expect(error.details).toMatchObject({
      edgeIndex: 0,
      edgeId: "e9",
      endpoint: "target",
      nodeId: "ghost",
      removedInPatch: false,
    })
    const after = workflows.getById(workflowId)!
    expect(after.rev).toBe(before.rev)
    expect(after.edges).toEqual(before.edges)
  })

  it("says so when the missing endpoint is a node this same patch removed", async () => {
    const error = await rejected(service.patch(workspaceId, workflowId, {
      removeNodeIds: ["step"],
      upsertEdges: [{ edgeId: "e1", source: "start", target: "step" }],
    }))

    expect(error.message).toContain('target node "step" was removed by this patch')
    expect(error.details).toMatchObject({ nodeId: "step", removedInPatch: true })
  })

  it("still drops the stored edges of a removed node", async () => {
    const removed = await service.patch(workspaceId, workflowId, { removeNodeIds: ["step"] })
    expect(removed.nodes.map((node) => node.nodeId)).not.toContain("step")
    // e1 (start → step) and e2 (step → check) leave with the node; the rest stays.
    expect(removed.edges.map((edge) => edge.edgeId)).toEqual(["e3", "e4"])
  })

  it("keeps a replaced node's edges when removeNodeIds and the upsert name it in one patch", async () => {
    const replaced = await service.patch(workspaceId, workflowId, {
      removeNodeIds: ["step"],
      upsertNodes: [{ nodeId: "step", type: "delay", position: { x: 0, y: 0 }, config: { duration: 5 } }],
    })
    expect(replaced.edges.map((edge) => edge.edgeId)).toEqual(["e1", "e2", "e3", "e4"])
  })

  it("rejects two edges sent with one edgeId, on create and on patch", async () => {
    const patchError = await rejected(service.patch(workspaceId, workflowId, {
      upsertEdges: [
        { edgeId: "e9", source: "step", target: "end" },
        { edgeId: "e9", source: "start", target: "merge" },
      ],
    }))
    expect(patchError.message).toContain('edgeId "e9" is already used by upsertEdges[0]')
    expect(patchError.details).toMatchObject({ edgeIndex: 1, edgeId: "e9", duplicateOfEdgeIndex: 0 })

    const before = workflows.listByWorkspace(workspaceId).items.length
    const createError = await rejected(service.create(workspaceId, {
      name: "Repeated ids",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "end", type: "end", position: { x: 0, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "end" },
        { edgeId: "e1", source: "end", target: "start" },
      ],
    }))
    expect(createError.message).toContain('edges[1] ("e1")')
    expect(workflows.listByWorkspace(workspaceId).items).toHaveLength(before)
  })

  it("rejects a second edge between the same nodes and handles, naming the stored edge", async () => {
    const error = await rejected(service.patch(workspaceId, workflowId, {
      upsertEdges: [{ edgeId: "e9", source: "start", target: "step" }],
    }))

    expect(error.message).toContain('edge "e9" is the same connection as edge "e1"')
    expect(error.details).toMatchObject({ edgeId: "e9", duplicateEdgeId: "e1", source: "start", target: "step" })
  })

  it("does not call a different source or target handle a duplicate", async () => {
    const patched = await service.patch(workspaceId, workflowId, {
      upsertEdges: [
        // The other branch of the same assertion.
        { edgeId: "e5", source: "check", target: "merge", sourceHandle: "fail" },
        // A second input of the same merge node.
        { edgeId: "e6", source: "step", target: "merge", targetHandle: "branch-1" },
      ],
    })

    expect(patched.edges.map((edge) => edge.edgeId)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"])
  })

  it("reuses an edgeId to replace that edge, endpoints included", async () => {
    const patched = await service.patch(workspaceId, workflowId, {
      upsertEdges: [{ edgeId: "e1", source: "step", target: "end" }],
    })

    expect(patched.edges).toHaveLength(4)
    expect(patched.edges.find((edge) => edge.edgeId === "e1")).toMatchObject({ source: "step", target: "end" })
  })

  it("rejects a create or update whose explicit edges point at absent nodes", async () => {
    const createError = await rejected(service.create(workspaceId, {
      name: "Missing target",
      nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }],
      edges: [{ edgeId: "e1", source: "start", target: "ghost" }],
    }))
    expect(createError.message).toContain('edges[0] ("e1")')

    const before = workflows.getById(workflowId)!
    const updateError = await rejected(service.update(workspaceId, workflowId, {
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "end", type: "end", position: { x: 0, y: 0 } },
      ],
      edges: [{ edgeId: "e1", source: "start", target: "step" }],
    }))
    expect(updateError.message).toContain('target node "step" is not a node in the resulting workflow')
    expect(workflows.getById(workflowId)!.rev).toBe(before.rev)
  })

  it("rejects a whole-graph update that holds the same connection twice", async () => {
    const before = workflows.getById(workflowId)!

    const error = await rejected(service.update(workspaceId, workflowId, {
      edges: [
        ...before.edges,
        { edgeId: "e9", source: "start", target: "step" },
      ],
    }))

    expect(error.message).toContain('edges[4] ("e9")')
    expect(workflows.getById(workflowId)!.rev).toBe(before.rev)
  })

  /**
   * The canvas saves through `workflows.update` with the whole edge list
   * (`WorkflowCanvas` → `apiweave.workflows.update`), so an edge identical to
   * the stored one is carried over, not requested. A graph written by the old
   * create path, or imported through the repository, can already hold a
   * duplicate or a dangling edge; refusing every save would lock the canvas on
   * a defect that is invisible there. `workflow_diagnose` reports both.
   */
  it("saves a whole edge list that already holds a duplicate connection", async () => {
    const stored = workflows.create({
      workspaceId,
      name: "Stored duplicate",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "end", type: "end", position: { x: 100, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "end" },
        { edgeId: "e2", source: "start", target: "end" },
      ],
    })

    const saved = await service.update(workspaceId, stored.workflowId, {
      nodes: stored.nodes.map((node) => node.nodeId === "start"
        ? { ...node, position: { x: 10, y: 20 } }
        : node),
      edges: stored.edges,
    })

    expect(saved.rev).toBe(stored.rev + 1)
    expect(saved.edges.map((edge) => edge.edgeId)).toEqual(["e1", "e2"])
    expect(analyzeWorkflowGraph(saved).diagnostics.map((item) => item.code)).toContain("duplicate_edge")
  })

  it("saves a whole edge list whose stored edges share an edgeId, re-sending both unchanged", async () => {
    const stored = workflows.create({
      workspaceId,
      name: "Stored repeated id",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "end", type: "end", position: { x: 100, y: 0 } },
        { nodeId: "other", type: "end", position: { x: 100, y: 100 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "end" },
        { edgeId: "e1", source: "start", target: "other" },
      ],
    })

    const saved = await service.update(workspaceId, stored.workflowId, { edges: stored.edges })

    expect(saved.edges.map((edge) => [edge.edgeId, edge.target])).toEqual([["e1", "end"], ["e1", "other"]])
  })

  it("rejects a whole-graph update that changes one of two stored edges sharing an edgeId", async () => {
    const stored = workflows.create({
      workspaceId,
      name: "Stored repeated id",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "end", type: "end", position: { x: 100, y: 0 } },
        { nodeId: "other", type: "end", position: { x: 100, y: 100 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "end" },
        { edgeId: "e1", source: "start", target: "other" },
      ],
    })

    const error = await rejected(service.update(workspaceId, stored.workflowId, {
      edges: [{ ...stored.edges[0]!, label: "changed" }, stored.edges[1]!],
    }))

    expect(error.message).toContain('edges[0] ("e1")')
    expect(workflows.getById(stored.workflowId)!.rev).toBe(stored.rev)
  })

  it("rejects a whole-graph update that adds a third copy of a stored edgeId", async () => {
    const stored = workflows.create({
      workspaceId,
      name: "Stored repeated id",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "end", type: "end", position: { x: 100, y: 0 } },
        { nodeId: "other", type: "end", position: { x: 100, y: 100 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "end" },
        { edgeId: "e1", source: "start", target: "other" },
      ],
    })

    const error = await rejected(service.update(workspaceId, stored.workflowId, {
      edges: [...stored.edges, { edgeId: "e1", source: "end", target: "other" }],
    }))

    expect(error.message).toContain('edges[2] ("e1")')
    expect(workflows.getById(stored.workflowId)!.rev).toBe(stored.rev)
  })

  it("still rejects a whole-graph update that adds a third copy of a stored connection", async () => {
    const stored = workflows.create({
      workspaceId,
      name: "Stored duplicate",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "end", type: "end", position: { x: 100, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "end" },
        { edgeId: "e2", source: "start", target: "end" },
      ],
    })

    const error = await rejected(service.update(workspaceId, stored.workflowId, {
      edges: [...stored.edges, { edgeId: "e3", source: "start", target: "end" }],
    }))

    expect(error.message).toContain('edges[2] ("e3")')
    expect(error.details).toMatchObject({ edgeId: "e3", duplicateEdgeId: "e1" })
    expect(workflows.getById(stored.workflowId)!.rev).toBe(stored.rev)
  })

  it("saves a whole edge list that already holds a dangling edge", async () => {
    const stored = workflows.create({
      workspaceId,
      name: "Stored dangling",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "end", type: "end", position: { x: 100, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "end" },
        { edgeId: "e9", source: "end", target: "ghost" },
      ],
    })

    const saved = await service.update(workspaceId, stored.workflowId, {
      name: "Stored dangling (renamed)",
      edges: stored.edges,
    })

    expect(saved.rev).toBe(stored.rev + 1)
    expect(saved.edges.map((edge) => edge.edgeId)).toEqual(["e1", "e9"])
  })

  it("rejects a carried-over edge whose node this update removes", async () => {
    const before = workflows.getById(workflowId)!

    const error = await rejected(service.update(workspaceId, workflowId, {
      nodes: before.nodes.filter((node) => node.nodeId !== "step"),
      edges: before.edges,
    }))

    expect(error.message).toContain('edges[0] ("e1")')
    expect(error.message).toContain('target node "step" is not a node in the resulting workflow')
    expect(workflows.getById(workflowId)!.rev).toBe(before.rev)
  })
})
