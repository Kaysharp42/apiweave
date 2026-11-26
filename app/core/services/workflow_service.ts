import type { Workflow } from "@shared/types/Workflow"
import type { AssertionItem } from "@shared/types/AssertionItem"
import type { JsonValue } from "@shared/types/JsonValue"
import type { NodeSearchPage } from "@shared/types/NodeSearchPage"
import type { WorkflowNodesView } from "@shared/types/WorkflowNodesView"
import type { WorkflowOutlineView } from "@shared/types/WorkflowOutlineView"
import type { WorkflowRevision } from "@shared/types/WorkflowRevision"
import type { WorkflowRevisionSummary } from "@shared/types/WorkflowRevisionSummary"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowCreate,
  WorkflowRepository,
  WorkflowSummaryCursor,
  WorkflowSummaryFilters,
  WorkflowSummaryRow,
  WorkflowUpdate,
  WorkflowWriteSource,
} from "../repositories"
import {
  buildNodesView,
  buildOutlineView,
  openSearchCursor,
  searchWorkflowNodes,
  searchWorkspaceNodes,
  sealSearchCursor,
  type NodeSearchRequest,
} from "./workflow_reads"
import { ZodError } from "zod"
import { ConflictError, NotFoundError, ValidationError } from "../ipc/errors"
import { AssertionItemSchema } from "@shared/zod-schemas/AssertionItemSchema"
import { WorkflowNodeSchema } from "@shared/zod-schemas/WorkflowNodeSchema"
import { browserStepLabel } from "@shared/browser/browser_action_labels"
import { canonicalizeNodeConfig } from "../repositories/helpers"
import { clearDepartingCallTargets } from "./workspace_move"
import type { ScopeResolver } from "./scope_resolver"
import { layoutWorkflowNodes } from "@shared/layout/workflowLayout"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import { edgeConnectionKey } from "@shared/graph/edgeConnection"

/** A subset change to a stored graph — see {@link WorkflowService.patch}. */
export interface WorkflowGraphPatch {
  readonly expectedRevision?: number
  readonly name?: string
  readonly description?: string | null
  /** Replaces the stored tag list. */
  readonly tags?: readonly string[]
  readonly upsertNodes?: readonly WorkflowNodePatch[]
  readonly removeNodeIds?: readonly string[]
  readonly upsertEdges?: readonly Workflow["edges"][number][]
  readonly removeEdgeIds?: readonly string[]
  readonly setVariables?: Readonly<Record<string, JsonValue>>
  readonly unsetVariables?: readonly string[]
  /**
   * Move existing nodes without resending them: applied after upserts/removals,
   * to whichever named ids still exist. Position-only — unlike `upsertNodes`,
   * this does not make a node count as "touched" in the compact write summary.
   */
  readonly repositionNodes?: Readonly<Record<string, { readonly x: number; readonly y: number }>>
  /**
   * Layout control for the shared revision-aware write path. `true` lays out
   * when the write changes topology (new/removed nodes, edges, edge handles,
   * group membership or node type); any other value preserves every position exactly
   * as sent/stored, so config/label-only writes never move the canvas. The MCP
   * bridge sends `true` unless the caller passes `layout: false`; the renderer
   * omits the key and always preserves.
   */
  readonly layout?: boolean
}

/** A partial update for a stored node, or the complete definition for a new one. */
export interface WorkflowNodePatch {
  readonly nodeId: string
  readonly type?: Workflow["nodes"][number]["type"] | undefined
  readonly label?: string | null | undefined
  readonly position?: Readonly<{ x?: number | undefined; y?: number | undefined }> | undefined
  readonly parentId?: string | null | undefined
  readonly config?: Readonly<Record<string, unknown>> | undefined
}

/**
 * True when the write changes graph topology — the only case auto-layout runs.
 * New/removed node ids, added/removed/retargeted edges (including handle
 * changes), node type changes, and group membership (`parentId`) changes all
 * count. Config, label, and position-only edits do not: they preserve every
 * stored position.
 */
// fallow-ignore-next-line complexity
export function graphTopologyChanged(
  existingNodes: readonly WorkflowNode[],
  existingEdges: readonly WorkflowEdge[],
  nextNodes: readonly WorkflowNode[],
  nextEdges: readonly WorkflowEdge[],
): boolean {
  if (existingNodes.length !== nextNodes.length || existingEdges.length !== nextEdges.length) {
    const existingIds = new Set(existingNodes.map((node) => node.nodeId))
    const nextIds = new Set(nextNodes.map((node) => node.nodeId))
    if (existingIds.size !== nextIds.size || [...existingIds].some((id) => !nextIds.has(id))) return true
    const existingEdgeIds = new Set(existingEdges.map((edge) => edge.edgeId))
    const nextEdgeIds = new Set(nextEdges.map((edge) => edge.edgeId))
    if (existingEdgeIds.size !== nextEdgeIds.size || [...existingEdgeIds].some((id) => !nextEdgeIds.has(id))) return true
  }
  const existingByNode = new Map(existingNodes.map((node) => [node.nodeId, node]))
  for (const next of nextNodes) {
    const current = existingByNode.get(next.nodeId)
    if (current === undefined) return true
    if (current.type !== next.type) return true
    if ((current.parentId ?? null) !== (next.parentId ?? null)) return true
  }
  const existingByEdge = new Map(existingEdges.map((edge) => [edge.edgeId, edge]))
  for (const next of nextEdges) {
    const current = existingByEdge.get(next.edgeId)
    if (current === undefined) return true
    if (current.source !== next.source || current.target !== next.target) return true
    if ((current.sourceHandle ?? null) !== (next.sourceHandle ?? null)) return true
    // Re-pointing an edge at another input port (a merge node's `branch-1`)
    // rewires the graph as much as changing its target node does.
    if ((current.targetHandle ?? null) !== (next.targetHandle ?? null)) return true
  }
  // Same cardinalities but different id sets also reach here when lengths
  // match by coincidence (replace one node with another); the loops above
  // already returned true for the missing ids.
  return false
}

/**
 * Fold a {@link WorkflowGraphPatch} into the stored graph, producing the full
 * update to persist. `WorkflowService.patch` lays out this merged result when
 * the write changes topology, so the layout and the write share one revision.
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
    ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
  }
}

/**
 * One edge the caller sent, and where in the request it was sent.
 *
 * `carriedOver` is set only by `update`, which replaces the whole edge list and
 * is how the canvas autosaves: an edge identical to the stored one of the same
 * id was not authored by this write, it was re-transmitted with the graph.
 */
interface SentEdge {
  readonly edge: WorkflowEdge
  readonly field: "edges" | "upsertEdges"
  readonly index: number
  readonly carriedOver: boolean
}

function describeSentEdge(sent: SentEdge): string {
  return `${sent.field}[${sent.index}] ("${sent.edge.edgeId}")`
}

/** An edge as an agent reads it, for a message naming the connection a duplicate reuses. */
function describeConnection(edge: WorkflowEdge): string {
  const sourceHandle = edge.sourceHandle === undefined || edge.sourceHandle === "" ? "" : ` [${edge.sourceHandle}]`
  const targetHandle = edge.targetHandle === undefined || edge.targetHandle === "" ? "" : ` → ${edge.targetHandle}`
  return `${edge.source}${sourceHandle} → ${edge.target}${targetHandle}`
}

/**
 * Whether a whole-graph write re-transmits a stored edge unchanged. Handles and
 * the label compare as null when absent, so the canvas's `null` spelling and a
 * stored omission are the same edge.
 */
function isCarriedOverEdge(stored: WorkflowEdge | undefined, sent: WorkflowEdge): boolean {
  return stored !== undefined
    && edgeConnectionKey(stored) === edgeConnectionKey(sent)
    && (stored.label ?? null) === (sent.label ?? null)
}

/**
 * The one edge check every write path runs over the edges a caller explicitly
 * sends: both endpoints must exist in the graph being written, no two edges may
 * carry the same `edgeId`, and no two may be the same connection.
 *
 * `resultEdges` is the edge list that would be stored, so a duplicate is caught
 * against a stored edge as well as against another sent one.
 *
 * `update` replaces the whole edge list, so the canvas resends every edge on
 * every save. A sent edge identical to the stored one is therefore marked
 * `carriedOver`: it is exempt from the duplicate rule, and from the endpoint
 * rule when that endpoint was already missing before the write (`existingNodeIds`).
 * Without that, a graph already holding a duplicate — written before this check
 * existed, or imported through the repository — could never be saved from the
 * canvas again, and the overlapping edges are invisible there to fix. A
 * carried-over edge whose endpoint this update removes is still the caller's
 * own change, and is rejected; so is any new or changed edge. Everything a
 * write does not carry over must be sound, and `workflow_diagnose` reports the
 * rest.
 *
 * `removedNodeIds` lets the message say a missing endpoint was removed by this
 * very patch. An upserted edge to a node this patch removes used to be dropped
 * silently, so the caller saw the edge as sent and found the branch broken;
 * stored edges incident to a removed node are still dropped without an error
 * when the caller does not send them.
 */
function assertEdgeIntegrity(
  resultEdges: readonly WorkflowEdge[],
  nodes: readonly WorkflowNode[],
  sent: readonly SentEdge[],
  context: { readonly removedNodeIds?: readonly string[]; readonly existingNodeIds?: ReadonlySet<string> } = {},
): void {
  if (sent.length === 0) return
  const nodeIds = new Set(nodes.map((node) => node.nodeId))
  const removed = new Set(context.removedNodeIds ?? [])
  const existingNodeIds = context.existingNodeIds

  for (const item of sent) {
    for (const endpoint of ["source", "target"] as const) {
      const nodeId = item.edge[endpoint]
      if (nodeIds.has(nodeId)) continue
      // A stored dangling edge carried over by a whole-graph save is a
      // diagnosis on the next read, not something this write introduced.
      if (item.carriedOver && existingNodeIds !== undefined && !existingNodeIds.has(nodeId)) continue
      const removedInPatch = removed.has(nodeId)
      throw new ValidationError(
        `${describeSentEdge(item)}: ${endpoint} node "${nodeId}" ${removedInPatch ? "was removed by this patch" : "is not a node in the resulting workflow"}. ${removedInPatch ? "Remove the edge in the same patch, or keep the node." : "Add or upsert that node in the same write, or point the edge at a node that exists."}`,
        { edgeIndex: item.index, edgeId: item.edge.edgeId, endpoint, nodeId, removedInPatch },
      )
    }
  }

  // An edgeId is the stored edge's identity, so a repeat inside one request
  // means one of the two edges would silently replace the other.
  const sentById = new Map<string, SentEdge>()
  for (const item of sent) {
    const previous = sentById.get(item.edge.edgeId)
    if (previous !== undefined) {
      throw new ValidationError(
        `${describeSentEdge(item)}: edgeId "${item.edge.edgeId}" is already used by ${describeSentEdge(previous)}. Give each connection its own edgeId; reusing one replaces that edge.`,
        { edgeIndex: item.index, edgeId: item.edge.edgeId, duplicateOfEdgeIndex: previous.index },
      )
    }
    sentById.set(item.edge.edgeId, item)
  }

  const sentByEdgeId = new Map(sent.map((item) => [item.edge.edgeId, item]))
  const byConnection = new Map<string, WorkflowEdge>()
  for (const edge of resultEdges) {
    const key = edgeConnectionKey(edge)
    const first = byConnection.get(key)
    if (first === undefined) {
      byConnection.set(key, edge)
      continue
    }
    // Blame the edge this write actually authored; when both are carried over,
    // the duplicate predates the write.
    const duplicate = [sentByEdgeId.get(edge.edgeId), sentByEdgeId.get(first.edgeId)]
      .find((item) => item !== undefined && !item.carriedOver)
    if (duplicate === undefined) continue
    const counterpart = duplicate.edge.edgeId === edge.edgeId ? first : edge
    throw new ValidationError(
      `${describeSentEdge(duplicate)}: edge "${duplicate.edge.edgeId}" is the same connection as edge "${counterpart.edgeId}" (${describeConnection(counterpart)}). Two edges joining the same nodes through the same handles run their target once per duplicate; remove one, or use a different handle (an assertion's pass/fail, a merge node's input).`,
      {
        edgeIndex: duplicate.index,
        edgeId: duplicate.edge.edgeId,
        duplicateEdgeId: counterpart.edgeId,
        source: counterpart.source,
        target: counterpart.target,
        sourceHandle: counterpart.sourceHandle ?? null,
        targetHandle: counterpart.targetHandle ?? null,
      },
    )
  }
}

/**
 * A browser node written without a label is named after its action and target
 * — the same name the recorder gives a placed step — so an agent-authored step
 * is never anonymous on the canvas, in a read, or in a run report. Applied to
 * NEW nodes only: an existing node keeps the label its author chose, including
 * a cleared one.
 *
 * `undefined` means "keep the label as sent"; a string replaces it.
 */
function browserStepDefaultLabel(type: unknown, label: unknown, config: unknown): string | undefined {
  if (type !== "browser") return undefined
  if (typeof label === "string" && label !== "") return undefined
  return browserStepLabel(config)
}

/**
 * Merge node updates field-by-field. Existing nodes retain every omitted field,
 * including nested request configuration and canvas position; adding a node still
 * requires a complete schema-valid definition.
 */
// fallow-ignore-next-line complexity
export function mergeWorkflowNodePatches(
  existing: readonly Workflow["nodes"][number][],
  upserts: readonly WorkflowNodePatch[] | undefined,
  removeIds: readonly string[] | undefined,
): Workflow["nodes"] {
  const nodes = existing.filter((node) => !(removeIds ?? []).includes(node.nodeId))
  const indexById = new Map(nodes.map((node, index) => [node.nodeId, index]))

  for (const [upsertIndex, patch] of (upserts ?? []).entries()) {
    const index = indexById.get(patch.nodeId)
    if (index === undefined) {
      const defaulted = browserStepDefaultLabel(patch.type, patch.label, patch.config)
      const authored = defaulted === undefined ? patch : { ...patch, label: defaulted }
      const node = parseUpsertedNode(canonicalizeNodeConfig(authored), upsertIndex, patch.nodeId)
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
      ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
      ...(patch.config !== undefined ? { config: mergeRecord(current.config, patch.config) } : {}),
    }
    // `parentId: null` is the patch spelling of "leave the group". Stored nodes
    // (and the canvas) say "no parent" by omitting the key, so drop it rather
    // than persist a second spelling the node schema would reject anyway.
    if (patch.parentId === null) delete merged.parentId
    nodes[index] = parseUpsertedNode(canonicalizeNodeConfig(merged), upsertIndex, patch.nodeId)
  }
  return nodes
}

/**
 * Parse one upserted node. A failure is the caller's request being wrong, so the
 * issues are re-thrown with the path the caller sent it under (`upsertNodes`,
 * the list index) and a message naming the nodeId — the bare node-relative path
 * (`config.method`) tells an agent patching ten nodes nothing.
 */
function parseUpsertedNode(value: unknown, upsertIndex: number, nodeId: string): Workflow["nodes"][number] {
  const parsed = WorkflowNodeSchema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new ZodError(parsed.error.issues.map((issue) => ({
    ...issue,
    path: ["upsertNodes", upsertIndex, ...issue.path],
    message: `nodeId "${nodeId}": ${issue.message}`,
  })))
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

/** Workspace-scoped workflow CRUD. */
export class WorkflowService {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly scopeResolver: ScopeResolver,
    private readonly collections?: CollectionRepository,
    private readonly environments?: EnvironmentRepository,
  ) {}

  async create(workspaceId: string, input: Omit<WorkflowCreate, "workspaceId" | "workflowId">, options?: { readonly layout?: boolean }): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.assertCollectionInWorkspace(input.collectionId, workspaceId)
    this.assertEnvironmentInWorkspace(input.selectedEnvironmentId, workspaceId)
    this.assertCallWorkflowTargetsInWorkspace(input.nodes, workspaceId, undefined)
    const createdEdges = input.edges ?? []
    assertEdgeIntegrity(
      createdEdges,
      input.nodes ?? [],
      createdEdges.map((edge, index) => ({ edge, field: "edges", index, carriedOver: false })),
    )
    // Every node in a create is new, so an unlabelled browser step is named
    // after its action here too — the same default a patch upsert gets.
    const authored = input.nodes?.map((node) => {
      const defaulted = browserStepDefaultLabel(node.type, node.label, node.config)
      return defaulted === undefined ? node : { ...node, label: defaulted }
    })
    const nodes = options?.layout === true && authored !== undefined
      ? layoutWorkflowNodes(authored, input.edges ?? [])
      : authored
    return this.workflows.create({ ...input, workspaceId, ...(nodes !== undefined ? { nodes } : {}) })
  }

  async get(workspaceId: string, workflowId: string): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    return this.mustGet(workspaceId, workflowId)
  }

  async list(
    workspaceId: string,
    includeAttached = false,
  ): Promise<{ items: readonly Workflow[]; total: number }> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    return this.workflows.listByWorkspace(workspaceId, includeAttached)
  }

  /** The workspace's workflows that call `workflowId` through a Call Workflow node. */
  async listCallers(workspaceId: string, workflowId: string): Promise<readonly Workflow[]> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    return this.workflows.listCallers(workspaceId, workflowId)
  }

  /**
   * Bounded graph-free discovery over a workspace. Unlike `list`, this never
   * returns configs, variables or graph arrays, searches project-attached
   * workflows as well, and pages with an opaque filter-bound revision-safe
   * cursor: a cursor issued against a changed list is rejected so the caller
   * re-reads from the start.
   */
  async search(
    workspaceId: string,
    filters: WorkflowSummaryFilters,
    limit: number,
    cursor: string | undefined,
  ): Promise<{ items: readonly WorkflowSummaryRow[]; nextCursor: string | null }> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    const snapshot = this.workflows.summariesSnapshot(workspaceId, filters)
    const after = cursor === undefined
      ? undefined
      : openSearchCursor(cursor, { workspaceId, filters }, snapshot).after
    const page = this.workflows.listSummaries(workspaceId, filters, after, limit)
    const last = page.items[page.items.length - 1]
    return {
      items: page.items,
      nextCursor: page.hasMore && last !== undefined
        ? sealSearchCursor({
          workspaceId,
          filters,
          after: { updatedAt: last.updatedAt, workflowId: last.workflowId },
          snapshot: page.snapshot,
        })
        : null,
    }
  }

  /** Bounded structural overview of one workflow (no positions, no configs). */
  async getOutline(
    workspaceId: string,
    workflowId: string,
    nodeLimit: number,
    nodeCursor: string | undefined,
  ): Promise<WorkflowOutlineView> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    return buildOutlineView(this.mustGet(workspaceId, workflowId), nodeLimit, nodeCursor)
  }

  /** Full configs for a small node set plus incident edges and boundary identities. */
  async getNodesView(workspaceId: string, workflowId: string, nodeIds: readonly string[]): Promise<WorkflowNodesView> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    return buildNodesView(this.mustGet(workspaceId, workflowId), nodeIds)
  }

  /**
   * Locate nodes by safe fields and placeholder references — never values.
   * With `workflowId`, one workflow (with neighbour context); without it,
   * every workflow of the workspace, or of one project with `collectionId`.
   */
  async searchNodes(
    workspaceId: string,
    target: { readonly workflowId: string } | { readonly collectionId?: string },
    request: NodeSearchRequest,
  ): Promise<NodeSearchPage> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    if ("workflowId" in target) return searchWorkflowNodes(this.mustGet(workspaceId, target.workflowId), request)
    const filters: WorkflowSummaryFilters = target.collectionId === undefined ? {} : { collectionId: target.collectionId }
    const workflows = this.workflows.listByWorkspace(workspaceId, true).items
      .filter((workflow) => target.collectionId === undefined || workflow.collectionId === target.collectionId)
    return searchWorkspaceNodes(workflows, {
      workspaceId,
      ...filters,
      snapshot: this.workflows.summariesSnapshot(workspaceId, filters),
    }, request)
  }

  /**
   * Whole workflows of a workspace (or one project), newest-updated first,
   * keyset-paged — for reads that summarise graphs page by page.
   */
  async listGraphPage(
    workspaceId: string,
    filters: WorkflowSummaryFilters,
    after: WorkflowSummaryCursor | undefined,
    limit: number,
  ): Promise<{ readonly items: readonly Workflow[]; readonly hasMore: boolean; readonly snapshot: string }> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    return this.workflows.listGraphPage(workspaceId, filters, after, limit)
  }

// fallow-ignore-next-line complexity
  /**
   * Replace fields of a workflow. `expectedRevision` makes the write a
   * compare-and-swap: the canvas sends the revision its graph is based on, so
   * a save cannot silently overwrite an agent's or another device's edit that
   * landed after the canvas last loaded.
   */
  async update(
    workspaceId: string,
    workflowId: string,
    patch: WorkflowUpdate,
    options?: { readonly layout?: boolean; readonly expectedRevision?: number; readonly source?: WorkflowWriteSource },
  ): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    const existing = this.mustGet(workspaceId, workflowId)
    assertRevision(existing, options?.expectedRevision)
    if ("collectionId" in patch) this.assertCollectionInWorkspace(patch.collectionId ?? null, workspaceId)
    if ("selectedEnvironmentId" in patch) {
      this.assertEnvironmentInWorkspace(patch.selectedEnvironmentId ?? null, workspaceId)
    }
    if ("nodes" in patch) {
      this.assertCallWorkflowTargetsInWorkspace(patch.nodes, workspaceId, workflowId)
    }
    if (patch.edges !== undefined) {
      // The canvas saves by sending the whole graph, so an edge unchanged from
      // the stored one is not this write's request — see `assertEdgeIntegrity`.
      const storedEdges = new Map(existing.edges.map((edge) => [edge.edgeId, edge]))
      assertEdgeIntegrity(
        patch.edges,
        patch.nodes ?? existing.nodes,
        patch.edges.map((edge, index) => ({
          edge,
          field: "edges",
          index,
          carriedOver: isCarriedOverEdge(storedEdges.get(edge.edgeId), edge),
        })),
        { existingNodeIds: new Set(existing.nodes.map((node) => node.nodeId)) },
      )
    }
    let next: WorkflowUpdate = patch
    if (options?.layout === true && (patch.nodes !== undefined || patch.edges !== undefined)) {
      const nextNodes = patch.nodes ?? existing.nodes
      const nextEdges = patch.edges ?? existing.edges
      if (graphTopologyChanged(existing.nodes, existing.edges, nextNodes, nextEdges)) {
        next = { ...patch, nodes: layoutWorkflowNodes(nextNodes, nextEdges) }
      }
    }
    return this.writeAtRevision(workspaceId, workflowId, options?.expectedRevision, next, options?.source)
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
  async patch(
    workspaceId: string,
    workflowId: string,
    patch: WorkflowGraphPatch,
    source: WorkflowWriteSource = "canvas",
  ): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    const existing = this.mustGet(workspaceId, workflowId)
    assertRevision(existing, patch.expectedRevision)

    const next = mergeGraphPatch(existing, patch)
    this.assertCallWorkflowTargetsInWorkspace(next.nodes, workspaceId, workflowId)
    if (patch.upsertEdges !== undefined) {
      assertEdgeIntegrity(
        next.edges ?? [],
        next.nodes,
        patch.upsertEdges.map((edge, index) => ({ edge, field: "upsertEdges", index, carriedOver: false })),
        { removedNodeIds: patch.removeNodeIds ?? [] },
      )
    }

    // Revision-aware auto-layout on the snapshot being saved — never on a
    // redacted or pre-dispatch copy. The service reads the stored (unredacted)
    // graph, merges this patch, and lays out that merged result when topology
    // changed. Config/label-only patches keep every position untouched.
    let nodes = next.nodes
    const edges = next.edges ?? []
    if (patch.layout === true && graphTopologyChanged(existing.nodes, existing.edges, next.nodes, edges)) {
      const laidOut = layoutWorkflowNodes(next.nodes, edges)
      const positions = new Map(laidOut.map((node) => [node.nodeId, node.position]))
      nodes = next.nodes.map((node) => {
        const position = positions.get(node.nodeId)
        return position === undefined ? node : { ...node, position }
      })
    }
    const persist: WorkflowUpdate & { nodes: Workflow["nodes"] } = { ...next, nodes, edges }

    return this.writeAtRevision(workspaceId, workflowId, patch.expectedRevision, persist, source)
  }

  async applyAssertions(
    workspaceId: string,
    workflowId: string,
    expectedRevision: number,
    assertionNodeId: string,
    mode: "append" | "replace",
    rules: readonly AssertionItem[],
    source: WorkflowWriteSource = "canvas",
  ): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
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
      source,
    )
    if (updated === undefined) {
      const current = this.workflows.getByIdInWorkspace(workflowId, workspaceId)
      throw new ConflictError("workflow revision changed before assertions could be applied", {
        expectedRevision,
        currentRevision: current?.rev,
      })
    }
    return updated
  }

  /** A workflow's earlier versions, newest first, without their content. */
  async listRevisions(workspaceId: string, workflowId: string): Promise<readonly WorkflowRevisionSummary[]> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, workflowId)
    return this.workflows.revisions.list(workflowId)
  }

  /** One earlier version of a workflow, with the content restoring it would write back. */
  async getRevision(workspaceId: string, workflowId: string, revisionId: string): Promise<WorkflowRevision> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, workflowId)
    const revision = this.workflows.revisions.get(workflowId, revisionId)
    if (revision === undefined) throw new NotFoundError(`revision ${revisionId} not found`)
    return revision
  }

  /**
   * Write an earlier version's content back over the workflow — name,
   * description, graph, variables, tags and node templates; its project and
   * selected environment stay as they are. An ordinary write at
   * `expectedRevision`, so a stale canvas conflicts, and like any non-canvas
   * write it keeps the content it replaces as a revision: a restore can be
   * undone by restoring that.
   */
  async restoreRevision(
    workspaceId: string,
    workflowId: string,
    revisionId: string,
    expectedRevision: number,
  ): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    assertRevision(this.mustGet(workspaceId, workflowId), expectedRevision)
    const revision = this.workflows.revisions.get(workflowId, revisionId)
    if (revision === undefined) throw new NotFoundError(`revision ${revisionId} not found`)
    this.assertCallWorkflowTargetsInWorkspace(revision.snapshot.nodes, workspaceId, workflowId)
    return this.writeAtRevision(workspaceId, workflowId, expectedRevision, revision.snapshot, "restore")
  }

  async delete(workspaceId: string, workflowId: string): Promise<void> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, workflowId)
    this.workflows.delete(workflowId)
  }

  /** Attach/detach a workflow to a collection (project). `collectionId=null` detaches. */
  async attachToCollection(
    workspaceId: string,
    workflowId: string,
    collectionId: string | null,
  ): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, workflowId)
    this.assertCollectionInWorkspace(collectionId, workspaceId)
    const updated = this.workflows.update(workflowId, { collectionId })
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
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
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    await this.scopeResolver.assertWorkspaceVisible(targetWorkspaceId)
    const existing = this.mustGet(workspaceId, workflowId)
    if (targetWorkspaceId === workspaceId) {
      throw new ValidationError("workflow is already in this workspace")
    }
    this.assertCollectionInWorkspace(targetCollectionId, targetWorkspaceId)

    const moved = this.workflows.transaction(() => {
      this.workflows.setWorkspace(workflowId, targetWorkspaceId)
      return this.workflows.update(workflowId, {
        collectionId: targetCollectionId,
        selectedEnvironmentId: null,
        nodes: clearDepartingCallTargets(existing.nodes, new Set()),
      })
    })
    if (moved === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    return moved
  }

  /** Set/clear the workflow's selected environment. `environmentId=null` clears it. */
  async setEnvironment(
    workspaceId: string,
    workflowId: string,
    environmentId: string | null,
  ): Promise<Workflow> {
    await this.scopeResolver.assertWorkspaceVisible(workspaceId)
    this.mustGet(workspaceId, workflowId)
    this.assertEnvironmentInWorkspace(environmentId, workspaceId)
    const updated = this.workflows.update(workflowId, { selectedEnvironmentId: environmentId })
    if (updated === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    return updated
  }

  /**
   * Write `persist` — at `expectedRevision` when given. A row that vanished is
   * a 404; one whose revision moved between the caller's check and this write
   * is a conflict.
   */
  private writeAtRevision(
    workspaceId: string,
    workflowId: string,
    expectedRevision: number | undefined,
    persist: WorkflowUpdate,
    source: WorkflowWriteSource = "canvas",
  ): Workflow {
    const updated = expectedRevision === undefined
      ? this.workflows.update(workflowId, persist, source)
      : this.workflows.updateAtRevision(workflowId, expectedRevision, persist, source)
    if (updated !== undefined) return updated
    const current = this.workflows.getByIdInWorkspace(workflowId, workspaceId)
    if (current === undefined) throw new NotFoundError(`workflow ${workflowId} not found`)
    throw new ConflictError("workflow revision changed before the write could be applied", {
      expectedRevision,
      currentRevision: current.rev,
    })
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

/** A compare-and-swap precondition: `expectedRevision`, when given, must be the stored `rev`. */
function assertRevision(existing: Workflow, expectedRevision: number | undefined): void {
  if (expectedRevision !== undefined && existing.rev !== expectedRevision) {
    throw new ConflictError("workflow revision is stale", {
      expectedRevision,
      currentRevision: existing.rev,
    })
  }
}
