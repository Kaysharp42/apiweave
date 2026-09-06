import type { Workflow } from "@shared/types/Workflow"
import type { AssertionItem } from "@shared/types/AssertionItem"
import type { JsonValue } from "@shared/types/JsonValue"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowCreate,
  WorkflowRepository,
  WorkflowUpdate,
} from "../repositories"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { recordWorkflowTombstone, recordWorkflowUpsert } from "../sync/cloud-mutations"
import { ConflictError, NotFoundError, ValidationError } from "../ipc/errors"
import { AssertionItemSchema } from "@shared/zod-schemas/AssertionItemSchema"
import { WorkflowNodeSchema } from "@shared/zod-schemas/WorkflowNodeSchema"
import { canonicalizeNodeConfig } from "../repositories/helpers"
import { RESOURCE_WORKFLOWS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import { clearDepartingCallTargets } from "./workspace_move"
import type { ScopeResolver } from "./scope_resolver"

/** A subset change to a stored graph — see {@link WorkflowService.patch}. */
export interface WorkflowGraphPatch {
  readonly expectedRevision?: number
  readonly name?: string
  readonly description?: string | null
  readonly upsertNodes?: readonly WorkflowNodePatch[]
  readonly removeNodeIds?: readonly string[]
  readonly upsertEdges?: readonly Workflow["edges"][number][]
  readonly removeEdgeIds?: readonly string[]
  readonly setVariables?: Readonly<Record<string, JsonValue>>
  readonly unsetVariables?: readonly string[]
  /**
   * Move existing nodes without resending them: applied after upserts/removals,
   * to whichever named ids still exist. Position-only — unlike `upsertNodes`,
   * this does not make a node count as "touched" (see `mcp/bridge.ts`
   * `applyAutoLayout`, the one caller that needs to move a whole graph without
   * that showing up as every node being a content change).
   */
  readonly repositionNodes?: Readonly<Record<string, { readonly x: number; readonly y: number }>>
}

/** A partial update for a stored node, or the complete definition for a new one. */
export interface WorkflowNodePatch {
  readonly nodeId: string
  readonly type?: Workflow["nodes"][number]["type"] | undefined
  readonly label?: string | null | undefined
  readonly position?: Readonly<{ x?: number | undefined; y?: number | undefined }> | undefined
  readonly config?: Readonly<Record<string, unknown>> | undefined
}

/**
 * Fold a {@link WorkflowGraphPatch} into the stored graph, producing the full
 * update to persist. Exported so the MCP bridge can compute the same merged
 * graph a `workflows_patch` call is about to write — needed to lay out the
 * *whole* graph in the same write, not just the touched nodes.
 */
export function mergeGraphPatch(existing: Workflow, patch: WorkflowGraphPatch): WorkflowUpdate & { nodes: Workflow["nodes"] } {
  const upserted = mergeWorkflowNodePatches(existing.nodes, patch.upsertNodes, patch.removeNodeIds)
  const nodes = patch.repositionNodes === undefined
    ? upserted
    : upserted.map((node) => {
        const position = patch.repositionNodes![node.nodeId]
        return position === undefined ? node : { ...node, position }
      })
  const edges = mergeById(existing.edges, patch.upsertEdges, patch.removeEdgeIds, (edge) => edge.edgeId)
  const variables = { ...existing.variables, ...patch.setVariables }
  for (const name of patch.unsetVariables ?? []) delete variables[name]

  // A removed node leaves its edges pointing at nothing, which the analyzer
  // reports as `dangling_edge`. Dropping them here keeps a node removal from
  // needing a second call to stay consistent.
  const nodeIds = new Set(nodes.map((node) => node.nodeId))
  return {
    nodes,
    edges: edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    variables,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
  }
}

/**
 * Merge node updates field-by-field. Existing nodes retain every omitted field,
 * including nested request configuration and canvas position; adding a node still
 * requires a complete schema-valid definition.
 */
export function mergeWorkflowNodePatches(
  existing: readonly Workflow["nodes"][number][],
  upserts: readonly WorkflowNodePatch[] | undefined,
  removeIds: readonly string[] | undefined,
): Workflow["nodes"] {
  const nodes = existing.filter((node) => !(removeIds ?? []).includes(node.nodeId))
  const indexById = new Map(nodes.map((node, index) => [node.nodeId, index]))

  for (const patch of upserts ?? []) {
    const index = indexById.get(patch.nodeId)
    if (index === undefined) {
      const node = WorkflowNodeSchema.parse(canonicalizeNodeConfig(patch))
      indexById.set(node.nodeId, nodes.length)
      nodes.push(node)
      continue
    }

    const current = nodes[index]!
    if (patch.type !== undefined && patch.type !== current.type) {
      throw new ValidationError(`node ${patch.nodeId} cannot change type through a partial patch`)
    }
    const merged = {
      ...current,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.position !== undefined ? { position: { ...current.position, ...patch.position } } : {}),
      ...(patch.config !== undefined ? { config: mergeRecord(current.config, patch.config) } : {}),
    }
    nodes[index] = WorkflowNodeSchema.parse(canonicalizeNodeConfig(merged))
  }
  return nodes
}

/** Recursively merge plain-object config values; arrays and scalar values replace. */
function mergeRecord(
  current: Readonly<Record<string, unknown>> | undefined,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    const oldValue = merged[key]
    merged[key] = isPlainRecord(oldValue) && isPlainRecord(value)
      ? mergeRecord(oldValue, value)
      : value
  }
  return merged
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Replace-by-id then append, after dropping `removeIds`. Order of surviving entries is preserved. */
function mergeById<T>(
  existing: readonly T[],
  upserts: readonly T[] | undefined,
  removeIds: readonly string[] | undefined,
  idOf: (item: T) => string,
): T[] {
  const removed = new Set(removeIds ?? [])
  const byId = new Map((upserts ?? []).map((item) => [idOf(item), item]))
  const merged: T[] = []
  for (const item of existing) {
    const id = idOf(item)
    if (removed.has(id)) continue
    merged.push(byId.get(id) ?? item)
    byId.delete(id)
  }
  return [...merged, ...byId.values()]
}

/** Workspace-scoped workflow CRUD. Collapses Python `workflow_service` + `scoped_workflow_service`. */
export class WorkflowService {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
    private readonly collections?: CollectionRepository,
    private readonly environments?: EnvironmentRepository,
  ) {}

  async create(workspaceId: string, input: Omit<WorkflowCreate, "workspaceId">): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "create", RESOURCE_WORKFLOWS)
    this.assertCollectionInWorkspace(input.collectionId, workspaceId)
    this.assertEnvironmentInWorkspace(input.selectedEnvironmentId, workspaceId)
    this.assertCallWorkflowTargetsInWorkspace(input.nodes, workspaceId, undefined)
    const created = this.workflows.create({ ...input, workspaceId })
    recordWorkflowUpsert(this.syncProvider, created)
    await this.syncProvider.push()
    return created
  }

  async get(workspaceId: string, workflowId: string): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_WORKFLOWS)
    return this.mustGet(workspaceId, workflowId)
  }

  async list(
    workspaceId: string,
    includeAttached = false,
  ): Promise<{ items: readonly Workflow[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_WORKFLOWS)
    return this.workflows.listByWorkspace(workspaceId, includeAttached)
  }

  async update(workspaceId: string, workflowId: string, patch: WorkflowUpdate): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    this.mustGet(workspaceId, workflowId)
    if ("collectionId" in patch) this.assertCollectionInWorkspace(patch.collectionId ?? null, workspaceId)
    if ("selectedEnvironmentId" in patch) {
      this.assertEnvironmentInWorkspace(patch.selectedEnvironmentId ?? null, workspaceId)
    }
    if ("nodes" in patch) {
      this.assertCallWorkflowTargetsInWorkspace(patch.nodes, workspaceId, workflowId)
    }
    const updated = this.workflows.update(workflowId, patch)
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  /**
   * Change part of a graph without resending it. `update` replaces the whole
   * `nodes`/`edges`/`variables` arrays, which makes a two-field fix a full
   * re-transmission of the graph — and every re-transmission is a chance to
   * drop a node by accident. Here the caller names only what changes:
   * `upsertNodes`/`upsertEdges` replace matching entries by id and append the
   * rest, the `remove*` lists delete by id, and the variable maps merge.
   *
   * Removals apply before upserts, so removing and re-adding the same id in one
   * call ends with the upserted version. `expectedRevision` makes the write a
   * compare-and-swap against the revision the caller last read.
   */
  async patch(workspaceId: string, workflowId: string, patch: WorkflowGraphPatch): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    const existing = this.mustGet(workspaceId, workflowId)
    if (patch.expectedRevision !== undefined && existing.rev !== patch.expectedRevision) {
      throw new ConflictError("workflow revision is stale", {
        expectedRevision: patch.expectedRevision,
        currentRevision: existing.rev,
      })
    }

    const next = mergeGraphPatch(existing, patch)
    this.assertCallWorkflowTargetsInWorkspace(next.nodes, workspaceId, workflowId)

    const updated = patch.expectedRevision === undefined
      ? this.workflows.update(workflowId, next)
      : this.workflows.updateAtRevision(workflowId, patch.expectedRevision, next)
    if (updated === undefined) {
      const current = this.workflows.getByIdInWorkspace(workflowId, workspaceId)
      if (current === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
      throw new ConflictError("workflow revision changed before the patch could be applied", {
        expectedRevision: patch.expectedRevision,
        currentRevision: current.rev,
      })
    }
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  async applyAssertions(
    workspaceId: string,
    workflowId: string,
    expectedRevision: number,
    assertionNodeId: string,
    mode: "append" | "replace",
    rules: readonly AssertionItem[],
  ): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    const existing = this.mustGet(workspaceId, workflowId)
    if (existing.rev !== expectedRevision) {
      throw new ConflictError("workflow revision is stale", {
        expectedRevision,
        currentRevision: existing.rev,
      })
    }
    if (!existing.nodes.some((node) => node.nodeId === assertionNodeId && node.type === "assertion")) {
      throw new ValidationError(`node ${assertionNodeId} is not an assertion node`)
    }

    const canonicalRules = AssertionItemSchema.array().parse(rules)
    const updated = this.workflows.updateAssertionRules(
      workflowId,
      expectedRevision,
      assertionNodeId,
      mode,
      canonicalRules,
    )
    if (updated === undefined) {
      const current = this.workflows.getByIdInWorkspace(workflowId, workspaceId)
      throw new ConflictError("workflow revision changed before assertions could be applied", {
        expectedRevision,
        currentRevision: current?.rev,
      })
    }
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  async delete(workspaceId: string, workflowId: string): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "delete", RESOURCE_WORKFLOWS)
    const existing = this.mustGet(workspaceId, workflowId)
    recordWorkflowTombstone(this.syncProvider, existing)
    this.workflows.delete(workflowId)
    await this.syncProvider.push()
  }

  /** Attach/detach a workflow to a collection (project). `collectionId=null` detaches. */
  async attachToCollection(
    workspaceId: string,
    workflowId: string,
    collectionId: string | null,
  ): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    this.mustGet(workspaceId, workflowId)
    this.assertCollectionInWorkspace(collectionId, workspaceId)
    const updated = this.workflows.update(workflowId, { collectionId })
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  /**
   * Move a workflow into another workspace, optionally attaching it to a project
   * there.
   *
   * A workspace is the scope every other reference resolves in, so the move
   * cannot carry those references across: the selected environment and the old
   * project both belong to the source workspace, and `assertEnvironmentInWorkspace`
   * / `assertCollectionInWorkspace` reject them at the destination. Both are
   * cleared here rather than left for the next save to trip over — same reason
   * `clearDepartingCallTargets` nulls the Call Workflow targets that stay behind.
   * Telling the user which of those they are about to lose is the caller's job
   * (the sidebar's move dialog does it); this method does not refuse the move
   * over them.
   */
  async moveToWorkspace(
    workspaceId: string,
    workflowId: string,
    targetWorkspaceId: string,
    targetCollectionId: string | null,
  ): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    await authorizeWorkspace(this.scopeResolver, this.permissions, targetWorkspaceId, "create", RESOURCE_WORKFLOWS)
    const existing = this.mustGet(workspaceId, workflowId)
    if (targetWorkspaceId === workspaceId) {
      throw new ValidationError("workflow is already in this workspace")
    }
    this.assertCollectionInWorkspace(targetCollectionId, targetWorkspaceId)

    // The outbox is keyed by workspace (`core/sync/cloud-mutations`), so a lone
    // upsert under the destination would leave the source workspace still
    // claiming the row. Leaving is a deletion from where it left.
    recordWorkflowTombstone(this.syncProvider, existing)

    const moved = this.workflows.transaction(() => {
      this.workflows.setWorkspace(workflowId, targetWorkspaceId)
      return this.workflows.update(workflowId, {
        collectionId: targetCollectionId,
        selectedEnvironmentId: null,
        nodes: clearDepartingCallTargets(existing.nodes, new Set()),
      })
    })
    if (moved === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)

    recordWorkflowUpsert(this.syncProvider, moved)
    await this.syncProvider.push()
    return moved
  }

  /** Set/clear the workflow's selected environment. `environmentId=null` clears it. */
  async setEnvironment(
    workspaceId: string,
    workflowId: string,
    environmentId: string | null,
  ): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    this.mustGet(workspaceId, workflowId)
    this.assertEnvironmentInWorkspace(environmentId, workspaceId)
    const updated = this.workflows.update(workflowId, { selectedEnvironmentId: environmentId })
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }

  /** Existence-hiding read: a workflow outside `workspaceId` is reported as absent. */
  private mustGet(workspaceId: string, workflowId: string): Workflow {
    const workflow = this.workflows.getByIdInWorkspace(workflowId, workspaceId)
    if (workflow === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    return workflow
  }

  /** Reject a collectionId that doesn't belong to `workspaceId` — blocks cross-workspace project membership. */
  private assertCollectionInWorkspace(collectionId: string | null | undefined, workspaceId: string): void {
    if (collectionId == null) return
    const collection = this.collections?.getById(collectionId)
    if (!collection || collection.workspaceId !== workspaceId) {
      throw new NotFoundError(`collection ${collectionId} not found`)
    }
  }

  /** Reject an environmentId that doesn't belong to `workspaceId`. */
  private assertEnvironmentInWorkspace(environmentId: string | null | undefined, workspaceId: string): void {
    if (environmentId == null) return
    const env = this.environments?.getById(environmentId)
    if (!env || env.workspaceId !== workspaceId) {
      throw new NotFoundError(`environment ${environmentId} not found`)
    }
  }

  /**
   * Reject a Call Workflow node whose target doesn't exist in `workspaceId`,
   * or that targets the workflow currently being saved (direct self-call).
   * This does NOT walk the transitive call graph across other workflows —
   * indirect cycles (A calls B calls A) are caught instead by the runner's
   * depth-bounded recursion guard (`executor.ts`, `MAX_CALL_DEPTH`), which
   * also covers a cycle introduced later by editing a target workflow that
   * already passed this check.
   */
  private assertCallWorkflowTargetsInWorkspace(
    nodes: Workflow["nodes"] | undefined,
    workspaceId: string,
    selfWorkflowId: string | undefined,
  ): void {
    if (nodes === undefined) return
    for (const node of nodes) {
      if (node.type !== "workflow") continue
      const targetWorkflowId = node.config?.targetWorkflowId
      if (!targetWorkflowId) continue
      if (selfWorkflowId !== undefined && targetWorkflowId === selfWorkflowId) {
        throw new ValidationError(`node ${node.nodeId} cannot call its own workflow`)
      }
      if (!this.workflows.getByIdInWorkspace(targetWorkflowId, workspaceId)) {
        throw new NotFoundError(`target workflow ${targetWorkflowId} not found`)
      }
    }
  }
}
