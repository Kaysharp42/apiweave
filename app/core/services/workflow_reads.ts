import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { NodeSearchPage } from "@shared/types/NodeSearchPage"
import type { WorkflowNodesView } from "@shared/types/WorkflowNodesView"
import type { WorkflowOutlineView } from "@shared/types/WorkflowOutlineView"
import type { WorkflowSummaryFilters, WorkflowSummaryCursor } from "../repositories/WorkflowRepository"
import {
  NODE_SEARCH_DEFAULT_LIMIT,
  WORKFLOW_OUTLINE_DEFAULT_LIMIT,
} from "./read_budgets"
import { ConflictError, ValidationError } from "../ipc/errors"
import { openCursor, sealCursor } from "../ipc/opaque_cursor"

/* ------------------------------------------------------------------------- *
 * Workflow-search cursors: opaque, filter-bound, revision-safe.
 * ------------------------------------------------------------------------- */

export interface SealedSearchCursor {
  readonly after: WorkflowSummaryCursor
}

export function sealSearchCursor(args: {
  readonly workspaceId: string
  readonly filters: WorkflowSummaryFilters
  readonly limit: number
  readonly after: WorkflowSummaryCursor
  readonly snapshot: string
}): string {
  return sealCursor({
    v: 1,
    kind: "workflow-search",
    workspaceId: args.workspaceId,
    ...(args.filters.query !== undefined ? { query: args.filters.query } : {}),
    ...(args.filters.collectionId !== undefined ? { collectionId: args.filters.collectionId } : {}),
    ...(args.filters.tags !== undefined ? { tags: [...args.filters.tags].sort() } : {}),
    limit: args.limit,
    after: { updatedAt: args.after.updatedAt, workflowId: args.after.workflowId },
    snapshot: args.snapshot,
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
  const payload = openCursor(cursor)
  if (payload === undefined || payload["v"] !== 1 || payload["kind"] !== "workflow-search") {
    throw new ValidationError("This cursor is not valid; call again without a cursor to start from the first page.")
  }
  if (payload["workspaceId"] !== request.workspaceId) {
    throw new ValidationError("This cursor belongs to another workspace; call again without a cursor.")
  }
  const tags = Array.isArray(payload["tags"])
    ? payload["tags"].filter((tag): tag is string => typeof tag === "string")
    : undefined
  const sealed: WorkflowSummaryFilters = {
    ...(typeof payload["query"] === "string" ? { query: payload["query"] } : {}),
    ...(typeof payload["collectionId"] === "string" ? { collectionId: payload["collectionId"] } : {}),
    ...(tags !== undefined ? { tags } : {}),
  }
  if (filterFingerprint(sealed) !== filterFingerprint(request.filters)) {
    throw new ValidationError("This cursor was issued for different filters; call again without a cursor.")
  }
  if (payload["snapshot"] !== snapshot) {
    throw new ConflictError("The workflow list changed since this cursor was issued; call again without a cursor.")
  }
  const after = payload["after"]
  if (!isCursorPosition(after)) {
    throw new ValidationError("This cursor is not valid; call again without a cursor to start from the first page.")
  }
  return { after }
}

function filterFingerprint(filters: WorkflowSummaryFilters): string {
  return JSON.stringify({
    query: filters.query ?? null,
    collectionId: filters.collectionId ?? null,
    tags: filters.tags === undefined ? null : [...filters.tags].sort(),
  })
}

function isCursorPosition(value: unknown): value is WorkflowSummaryCursor {
  return typeof value === "object"
    && value !== null
    && typeof (value as { updatedAt?: unknown }).updatedAt === "string"
    && typeof (value as { workflowId?: unknown }).workflowId === "string"
}

/* ------------------------------------------------------------------------- *
 * Outline cursors: bound to one workflow revision.
 * ------------------------------------------------------------------------- */

export function sealOutlineCursor(args: { readonly workflowId: string; readonly rev: number; readonly afterNodeId: string }): string {
  return sealCursor({ v: 1, kind: "workflow-outline", workflowId: args.workflowId, rev: args.rev, afterNodeId: args.afterNodeId })
}

export function openOutlineCursor(cursor: string, workflow: Workflow): string {
  const payload = openCursor(cursor)
  if (payload === undefined || payload["v"] !== 1 || payload["kind"] !== "workflow-outline") {
    throw new ValidationError("This cursor is not valid; read the outline again without a cursor.")
  }
  if (payload["workflowId"] !== workflow.workflowId) {
    throw new ValidationError("This cursor belongs to another workflow; read the outline again without a cursor.")
  }
  if (payload["rev"] !== workflow.rev) {
    throw new ConflictError("The workflow changed since this cursor was issued; read the outline again without a cursor.")
  }
  if (typeof payload["afterNodeId"] !== "string") {
    throw new ValidationError("This cursor is not valid; read the outline again without a cursor.")
  }
  return payload["afterNodeId"]
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
  readonly query: string
  readonly nodeTypes?: readonly string[]
  readonly limit?: number
}

/**
 * Locate nodes by safe fields only: nodeId, label, type, request method, the
 * URL path (query string and fragment stripped), extractor variable names and
 * call-workflow targets. Bodies, headers, cookies, auth blocks, query values
 * and variables are never inspected, so the search cannot match a withheld
 * secret value. The query is a literal substring — never a regex.
 */
export function searchWorkflowNodes(workflow: Workflow, request: NodeSearchRequest): NodeSearchPage {
  const query = request.query.toLowerCase()
  const typeFilter = request.nodeTypes === undefined ? undefined : new Set(request.nodeTypes)
  const limit = request.limit ?? NODE_SEARCH_DEFAULT_LIMIT
  const matched = workflow.nodes.flatMap((node) => {
    if (typeFilter !== undefined && !typeFilter.has(node.type)) return []
    const matchedOn = matchNodeFields(node, query)
    if (matchedOn.length === 0) return []
    const neighborNodeIds = new Set<string>()
    const incidentEdgeIds = new Set<string>()
    for (const edge of workflow.edges) {
      if (edge.source === node.nodeId) {
        incidentEdgeIds.add(edge.edgeId)
        neighborNodeIds.add(edge.target)
      } else if (edge.target === node.nodeId) {
        incidentEdgeIds.add(edge.edgeId)
        neighborNodeIds.add(edge.source)
      }
    }
    return [{
      nodeId: node.nodeId,
      type: node.type,
      label: node.label ?? null,
      matchedOn,
      neighborNodeIds: [...neighborNodeIds].sort(),
      incidentEdgeIds: [...incidentEdgeIds].sort(),
    }]
  })
  return {
    workflowId: workflow.workflowId,
    workspaceId: workflow.workspaceId,
    rev: workflow.rev,
    query: request.query,
    items: matched.slice(0, limit),
    totalMatched: matched.length,
    omittedMatchCount: Math.max(0, matched.length - limit),
  }
}

function matchNodeFields(node: WorkflowNode, query: string): string[] {
  const matchedOn: string[] = []
  if (node.nodeId.toLowerCase().includes(query)) matchedOn.push("nodeId")
  if ((node.label ?? "").toLowerCase().includes(query)) matchedOn.push("label")
  if (node.type.toLowerCase().includes(query)) matchedOn.push("type")
  if (node.type === "http-request") {
    const config = node.config
    if (typeof config?.method === "string" && config.method.toLowerCase() === query) matchedOn.push("method")
    if (typeof config?.url === "string" && urlPathTemplate(config.url).toLowerCase().includes(query)) {
      matchedOn.push("urlPath")
    }
    if (config?.extractors !== undefined) {
      const names = Object.keys(config.extractors)
      if (names.some((name) => name.toLowerCase().includes(query))) matchedOn.push("extractor")
    }
  } else if (node.type === "sse") {
    const config = node.config
    if (typeof config?.url === "string" && urlPathTemplate(config.url).toLowerCase().includes(query)) {
      matchedOn.push("urlPath")
    }
    if (config?.extractors !== undefined) {
      const names = Object.keys(config.extractors)
      if (names.some((name) => name.toLowerCase().includes(query))) matchedOn.push("extractor")
    }
  }
  if (node.type === "workflow" && typeof node.config?.targetWorkflowId === "string") {
    if (node.config.targetWorkflowId.toLowerCase().includes(query)) matchedOn.push("target")
  }
  return matchedOn
}

/**
 * The matchable URL surface: placeholders kept (they are references, not
 * values), query string and fragment dropped (they carry literal values the
 * transport would withhold). Never throws on template URLs the URL parser
 * cannot parse.
 */
function urlPathTemplate(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? ""
  try {
    return new URL(withoutQuery, "http://placeholder.invalid").pathname
  } catch {
    return withoutQuery
  }
}
