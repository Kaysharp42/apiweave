import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { NodeSearchPage } from "@shared/types/NodeSearchPage"
import type { NodeReferenceUse } from "@shared/types/NodeReferenceUse"
import type { WorkflowNodeMatch } from "@shared/types/WorkflowNodeMatch"
import type { WorkflowNodesView } from "@shared/types/WorkflowNodesView"
import type { WorkflowOutlineView } from "@shared/types/WorkflowOutlineView"
import type { WorkflowSummaryFilters, WorkflowSummaryCursor } from "../repositories/WorkflowRepository"
import { WORKFLOW_OUTLINE_DEFAULT_LIMIT } from "./read_budgets"
import { nodeEndpoint, nodeReferences } from "./node_facts"
import { ConflictError, ValidationError } from "../ipc/errors"
import { assertCursorSnapshot, cursorScope, openCursor, openKeysetCursor, sealCursor } from "../ipc/opaque_cursor"

/* ------------------------------------------------------------------------- *
 * Workflow-search cursors: opaque, filter-bound, revision-safe.
 * ------------------------------------------------------------------------- */

export interface SealedSearchCursor {
  readonly after: WorkflowSummaryCursor
}

export function sealSearchCursor(args: {
  readonly workspaceId: string
  readonly filters: WorkflowSummaryFilters
  readonly after: WorkflowSummaryCursor
  readonly snapshot: string
}): string {
  return sealCursor("s", {
    scope: searchScope(args.workspaceId, args.filters),
    snapshot: cursorScope(args.snapshot),
    position: [args.after.updatedAt, args.after.workflowId],
  })
}

function searchScope(workspaceId: string, filters: WorkflowSummaryFilters): string {
  return cursorScope({
    workspaceId,
    query: filters.query ?? null,
    collectionId: filters.collectionId ?? null,
    tags: filters.tags === undefined ? null : [...filters.tags].sort(),
  })
}

/**
 * Open a search cursor against the request it must accompany. A cursor that
 * was tampered with, decoded against different filters, or issued before the
 * list changed is rejected — the caller re-reads from the start instead of
 * silently skipping or repeating rows.
 */
export function openSearchCursor(
  cursor: string,
  request: { readonly workspaceId: string; readonly filters: WorkflowSummaryFilters },
  snapshot: string,
): SealedSearchCursor {
  const opened = openKeysetCursor(cursor, "s", {
    scope: searchScope(request.workspaceId, request.filters),
    scopeMessage: "This cursor was issued for a different workspace or different filters; call again without a cursor.",
  })
  assertCursorSnapshot(opened.snapshot, snapshot, "The workflow list changed since this cursor was issued; call again without a cursor.")
  const [updatedAt, workflowId] = opened.position
  return { after: { updatedAt, workflowId } }
}

/* ------------------------------------------------------------------------- *
 * Outline cursors: bound to one workflow revision.
 * ------------------------------------------------------------------------- */

export function sealOutlineCursor(args: { readonly workflowId: string; readonly rev: number; readonly afterNodeId: string }): string {
  return sealCursor("o", { scope: cursorScope(args.workflowId), snapshot: String(args.rev), position: [args.afterNodeId] })
}

export function openOutlineCursor(cursor: string, workflow: Workflow): string {
  const opened = openCursor(cursor, "o")
  const afterNodeId = opened?.position[0]
  if (opened === undefined || afterNodeId === undefined) {
    throw new ValidationError("This cursor is not valid; read the outline again without a cursor.")
  }
  if (opened.scope !== cursorScope(workflow.workflowId)) {
    throw new ValidationError("This cursor belongs to another workflow; read the outline again without a cursor.")
  }
  if (opened.snapshot !== String(workflow.rev)) {
    throw new ConflictError("The workflow changed since this cursor was issued; read the outline again without a cursor.")
  }
  return afterNodeId
}

/* ------------------------------------------------------------------------- *
 * Focused graph reads over one authorized workflow snapshot.
 * ------------------------------------------------------------------------- */

/** Structural overview: bounded node id/type/label slices, all incident edges. */
export function buildOutlineView(
  workflow: Workflow,
  nodeLimit: number,
  nodeCursor: string | undefined,
): WorkflowOutlineView {
  const limit = nodeLimit <= 0 ? WORKFLOW_OUTLINE_DEFAULT_LIMIT : nodeLimit
  let startIndex = 0
  if (nodeCursor !== undefined) {
    const afterNodeId = openOutlineCursor(nodeCursor, workflow)
    const found = workflow.nodes.findIndex((node) => node.nodeId === afterNodeId)
    if (found === -1) {
      throw new ConflictError("The workflow changed since this cursor was issued; read the outline again without a cursor.")
    }
    startIndex = found + 1
  }
  const window = workflow.nodes.slice(startIndex, startIndex + limit)
  const windowIds = new Set(window.map((node) => node.nodeId))
  const last = window[window.length - 1]
  const edges = workflow.edges.filter((edge) => windowIds.has(edge.source) || windowIds.has(edge.target))
  return {
    view: "outline",
    partial: true,
    workflowId: workflow.workflowId,
    workspaceId: workflow.workspaceId,
    name: workflow.name,
    description: workflow.description ?? null,
    rev: workflow.rev,
    collectionId: workflow.collectionId ?? null,
    nodeCount: workflow.nodes.length,
    edgeCount: workflow.edges.length,
    nodes: window.map((node) => ({ nodeId: node.nodeId, type: node.type, label: node.label ?? null })),
    edges,
    // Omission is measured against the whole graph, not the tail after this
    // page: `nodes.length + omittedNodeCount === nodeCount` on every page, so a
    // paging caller can always state exactly what this page does not show.
    omittedNodeCount: workflow.nodes.length - window.length,
    omittedEdgeCount: workflow.edges.length - edges.length,
    nextNodeCursor: startIndex + window.length < workflow.nodes.length && last !== undefined
      ? sealOutlineCursor({ workflowId: workflow.workflowId, rev: workflow.rev, afterNodeId: last.nodeId })
      : null,
  }
}

/** Full configs for a small node set, incident edges, minimal boundary identities. */
export function buildNodesView(workflow: Workflow, nodeIds: readonly string[]): WorkflowNodesView {
  const wanted = new Set(nodeIds)
  const byId = new Map(workflow.nodes.map((node) => [node.nodeId, node]))
  const nodes = nodeIds.flatMap((nodeId) => {
    const node = byId.get(nodeId)
    return node === undefined ? [] : [node]
  })
  const inSet = new Set(nodes.map((node) => node.nodeId))
  const edges = workflow.edges.filter((edge) => inSet.has(edge.source) || inSet.has(edge.target))
  const boundaryIds = new Set<string>()
  for (const edge of edges) {
    if (!inSet.has(edge.source)) boundaryIds.add(edge.source)
    if (!inSet.has(edge.target)) boundaryIds.add(edge.target)
  }
  const boundaryNodes = [...boundaryIds]
    .sort()
    .flatMap((nodeId) => {
      const node = byId.get(nodeId)
      return node === undefined ? [] : [{ nodeId: node.nodeId, type: node.type, label: node.label ?? null }]
    })
  return {
    view: "nodes",
    partial: true,
    workflowId: workflow.workflowId,
    workspaceId: workflow.workspaceId,
    name: workflow.name,
    rev: workflow.rev,
    nodeCount: workflow.nodes.length,
    edgeCount: workflow.edges.length,
    nodes,
    edges,
    boundaryNodes,
    missingNodeIds: [...wanted].filter((nodeId) => !byId.has(nodeId)).sort(),
  }
}

export interface NodeSearchRequest {
  /** Literal substring, matched case-insensitively against safe fields only. */
  readonly query?: string
  /** A placeholder reference by name: `variables.NAME`, `env.NAME` or `secrets.NAME`. */
  readonly ref?: string
  readonly nodeTypes?: readonly string[]
  readonly limit: number
  readonly cursor?: string
}

/** The workflows a workspace-wide node search covers, and their revision fingerprint. */
export interface WorkspaceNodeSearchScope {
  readonly workspaceId: string
  readonly collectionId?: string
  /** `WorkflowRepository.summariesSnapshot` for the same filter: a cursor is bound to it. */
  readonly snapshot: string
}

/**
 * Locate nodes in one workflow by safe fields and placeholder references, with
 * the neighbour and edge context a patch needs. See {@link matchNode}.
 */
export function searchWorkflowNodes(workflow: Workflow, request: NodeSearchRequest): NodeSearchPage {
  const matches = workflowMatches(workflow, request, "workflow")
  const scope = { workspaceId: workflow.workspaceId, workflowId: workflow.workflowId, collectionId: null }
  return {
    workspaceId: workflow.workspaceId,
    workflowId: workflow.workflowId,
    rev: workflow.rev,
    ...pageMatches(matches, request, scope, `r${workflow.rev}`),
  }
}

/**
 * The same match across every workflow of a workspace (or of one project),
 * project-attached ones included. Workflows come newest-updated first, so the
 * first page holds the ones being worked on.
 */
// ponytail: parses every graph per query (in memory, no index). Fine to a few
// thousand workflows; past that, prefilter with LIKE on graph_json or an FTS
// table in WorkflowRepository.
export function searchWorkspaceNodes(
  workflows: readonly Workflow[],
  scope: WorkspaceNodeSearchScope,
  request: NodeSearchRequest,
): NodeSearchPage {
  const matches = [...workflows].sort(newestFirst).flatMap((workflow) => workflowMatches(workflow, request, "workspace"))
  const cursorScope = { workspaceId: scope.workspaceId, workflowId: null, collectionId: scope.collectionId ?? null }
  return { workspaceId: scope.workspaceId, ...pageMatches(matches, request, cursorScope, scope.snapshot) }
}

/** Newest-updated first, ties by id — the order workflow search pages in. */
export function newestFirst(a: Workflow, b: Workflow): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.workflowId.localeCompare(a.workflowId)
}

function workflowMatches(workflow: Workflow, request: NodeSearchRequest, mode: "workflow" | "workspace"): WorkflowNodeMatch[] {
  const needle = request.query?.trim().toLowerCase()
  const typeFilter = request.nodeTypes === undefined ? undefined : new Set(request.nodeTypes)
  return workflow.nodes.flatMap((node) => {
    if (typeFilter !== undefined && !typeFilter.has(node.type)) return []
    const matched = matchNode(node, needle === "" ? undefined : needle, request.ref)
    return matched === undefined ? [] : [nodeMatch(workflow, node, matched, mode)]
  })
}

function nodeMatch(
  workflow: Workflow,
  node: WorkflowNode,
  matched: NonNullable<ReturnType<typeof matchNode>>,
  mode: "workflow" | "workspace",
): WorkflowNodeMatch {
  const endpoint = nodeEndpoint(node)
  return {
    // A one-workflow page carries its workflowId once, at the top.
    ...(mode === "workspace" ? { workflowId: workflow.workflowId, workflowName: workflow.name } : {}),
    nodeId: node.nodeId,
    type: node.type,
    label: node.label ?? null,
    ...(endpoint?.method !== undefined ? { method: endpoint.method } : {}),
    ...(endpoint !== undefined ? { urlPath: endpoint.urlPath } : {}),
    matchedOn: matched.matchedOn,
    ...(matched.references !== undefined ? { references: matched.references } : {}),
    ...(mode === "workflow" ? neighborhood(workflow, node.nodeId) : {}),
  }
}

function neighborhood(workflow: Workflow, nodeId: string): { neighborNodeIds: string[]; incidentEdgeIds: string[] } {
  const neighborNodeIds = new Set<string>()
  const incidentEdgeIds = new Set<string>()
  for (const edge of workflow.edges) {
    if (edge.source === nodeId) {
      incidentEdgeIds.add(edge.edgeId)
      neighborNodeIds.add(edge.target)
    } else if (edge.target === nodeId) {
      incidentEdgeIds.add(edge.edgeId)
      neighborNodeIds.add(edge.source)
    }
  }
  return { neighborNodeIds: [...neighborNodeIds].sort(), incidentEdgeIds: [...incidentEdgeIds].sort() }
}

interface MatchCursorScope {
  readonly workspaceId: string
  readonly workflowId: string | null
  readonly collectionId: string | null
}

function pageMatches(
  matches: readonly WorkflowNodeMatch[],
  request: NodeSearchRequest,
  scope: MatchCursorScope,
  snapshot: string,
): Pick<NodeSearchPage, "items" | "totalMatched" | "omittedMatchCount" | "nextCursor"> {
  const boundTo = cursorScope({
    ...scope,
    query: request.query?.trim().toLowerCase() ?? null,
    ref: request.ref ?? null,
    nodeTypes: request.nodeTypes === undefined ? null : [...request.nodeTypes].sort(),
  })
  const offset = request.cursor === undefined ? 0 : openMatchCursor(request.cursor, boundTo, snapshot, matches.length)
  const items = matches.slice(offset, offset + request.limit)
  const end = offset + items.length
  return {
    items,
    totalMatched: matches.length,
    omittedMatchCount: matches.length - items.length,
    nextCursor: end < matches.length
      ? sealCursor("n", { scope: boundTo, snapshot: cursorScope(snapshot), position: [String(end)] })
      : null,
  }
}

function openMatchCursor(cursor: string, boundTo: string, snapshot: string, total: number): number {
  const opened = openCursor(cursor, "n")
  const offset = Number(opened?.position[0])
  if (opened === undefined || !Number.isInteger(offset) || offset < 0) {
    throw new ValidationError("This cursor is not valid; search again without a cursor.")
  }
  if (opened.scope !== boundTo) {
    throw new ValidationError("This cursor was issued for a different search; search again without a cursor.")
  }
  if (opened.snapshot !== cursorScope(snapshot) || offset > total) {
    throw new ConflictError("The searched workflows changed since this cursor was issued; search again without a cursor.")
  }
  return offset
}

/**
 * Whether a node matches, and on what. Every given filter must hold: the query
 * against safe fields ({@link matchNodeFields}), the reference against
 * {@link nodeReferences}. With neither (a type-only search) the type is the
 * match.
 */
function matchNode(
  node: WorkflowNode,
  needle: string | undefined,
  ref: string | undefined,
): { matchedOn: string[]; references?: NodeReferenceUse[] } | undefined {
  const matchedOn = needle === undefined ? [] : matchNodeFields(node, needle)
  if (needle !== undefined && matchedOn.length === 0) return undefined
  if (ref === undefined) return { matchedOn: matchedOn.length === 0 ? ["type"] : matchedOn }
  const references = nodeReferences(node)
    .filter((reference) => reference.ref === ref)
    .map(({ field, role }) => ({ field, role }))
  if (references.length === 0) return undefined
  return { matchedOn: [...matchedOn, "ref"], references }
}

/**
 * The query match over safe fields only: nodeId, label, type, request method,
 * the URL path (query string, userinfo and host stripped), extractor variable
 * names and call-workflow targets. Bodies, headers, cookies, auth blocks,
 * query values and variables are never inspected, so a query cannot match a
 * withheld secret value. The query is a literal substring — never a regex.
 */
// fallow-ignore-next-line complexity
function matchNodeFields(node: WorkflowNode, query: string): string[] {
  const matchedOn: string[] = []
  if (node.nodeId.toLowerCase().includes(query)) matchedOn.push("nodeId")
  if ((node.label ?? "").toLowerCase().includes(query)) matchedOn.push("label")
  if (node.type.toLowerCase().includes(query)) matchedOn.push("type")
  const endpoint = nodeEndpoint(node)
  if (node.type === "http-request" && endpoint?.method?.toLowerCase() === query) matchedOn.push("method")
  if (endpoint?.urlPath.toLowerCase().includes(query) === true) matchedOn.push("urlPath")
  if ((node.type === "http-request" || node.type === "sse" || node.type === "websocket") && node.config?.extractors !== undefined) {
    const names = Object.keys(node.config.extractors)
    if (names.some((name) => name.toLowerCase().includes(query))) matchedOn.push("extractor")
  }
  if (node.type === "workflow" && typeof node.config?.targetWorkflowId === "string") {
    if (node.config.targetWorkflowId.toLowerCase().includes(query)) matchedOn.push("target")
  }
  return matchedOn
}
