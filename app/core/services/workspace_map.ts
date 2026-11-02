import type { Workflow } from "@shared/types/Workflow"
import type { WorkspaceMapEntry } from "@shared/types/WorkspaceMapEntry"
import type { WorkspaceMapPage } from "@shared/types/WorkspaceMapPage"
import type { WorkflowSummaryCursor, WorkflowSummaryFilters } from "../repositories/WorkflowRepository"
import { assertCursorSnapshot, cursorScope, openKeysetCursor, sealCursor } from "../ipc/opaque_cursor"
import { type NodeReference, nodeEndpoint, nodeReferences } from "./node_facts"
import type { RunService } from "./run_service"
import type { WorkflowService } from "./workflow_service"

const MAP_LISTS = ["endpoints", "produces", "consumes", "env", "secrets", "calls"] as const
type MapList = (typeof MAP_LISTS)[number]
/** The most names any one list of an entry carries; the rest are counted in `omitted`. */
const WORKSPACE_MAP_LIST_CAP = 20
const PLACEHOLDER_SPAN_RE = /\{\{[^{}]*\}\}/g

/**
 * One bounded read that orients an agent in a workspace: per workflow, what it
 * calls, which variables it produces and consumes, which env and secret
 * references it uses, which workflows it runs, and how its last run went.
 *
 * Built from `node_facts` — the same safe facts node search matches on — so it
 * carries names and URL path templates only, never a config value. The latest
 * runs of a whole page come from one query, not one per workflow.
 */
export class WorkspaceMapService {
  constructor(
    private readonly workflows: WorkflowService,
    private readonly runs: RunService,
  ) {}

  async map(
    workspaceId: string,
    request: { readonly collectionId?: string; readonly limit: number; readonly cursor?: string },
  ): Promise<WorkspaceMapPage> {
    const filters: WorkflowSummaryFilters = request.collectionId === undefined ? {} : { collectionId: request.collectionId }
    const scope = cursorScope({ workspaceId, collectionId: request.collectionId ?? null })
    const opened = request.cursor === undefined ? undefined : openMapCursor(request.cursor, scope)
    const page = await this.workflows.listGraphPage(workspaceId, filters, opened?.after, request.limit)
    if (opened !== undefined) {
      assertCursorSnapshot(opened.snapshot, page.snapshot, "The workflows changed since this cursor was issued; call again without a cursor.")
    }
    const latest = await this.runs.latestByWorkflow(workspaceId, page.items.map((workflow) => workflow.workflowId))
    const last = page.items[page.items.length - 1]
    return {
      items: page.items.map((workflow) => mapEntry(workflow, latest.get(workflow.workflowId))),
      nextCursor: page.hasMore && last !== undefined
        ? sealCursor("m", { scope, snapshot: cursorScope(page.snapshot), position: [last.updatedAt, last.workflowId] })
        : null,
    }
  }
}

function openMapCursor(cursor: string, scope: string): { readonly after: WorkflowSummaryCursor; readonly snapshot: string } {
  const opened = openKeysetCursor(cursor, "m", {
    scope,
    scopeMessage: "This cursor was issued for a different workspace or project; call again without a cursor.",
  })
  const [updatedAt, workflowId] = opened.position
  return { after: { updatedAt, workflowId }, snapshot: opened.snapshot }
}

function mapEntry(workflow: Workflow, lastRun: WorkspaceMapEntry["lastRun"]): WorkspaceMapEntry {
  const lists = collectMapLists(workflow)
  const capped: Partial<Record<MapList, string[]>> = {}
  const omitted: Partial<Record<MapList, number>> = {}
  for (const key of MAP_LISTS) {
    const values = lists[key]
    if (values.size === 0) continue
    capped[key] = [...values].slice(0, WORKSPACE_MAP_LIST_CAP)
    if (values.size > WORKSPACE_MAP_LIST_CAP) omitted[key] = values.size - WORKSPACE_MAP_LIST_CAP
  }
  return {
    workflowId: workflow.workflowId,
    name: workflow.name,
    rev: workflow.rev,
    collectionId: workflow.collectionId ?? null,
    ...capped,
    ...(Object.keys(omitted).length > 0 ? { omitted } : {}),
    ...(lastRun !== undefined ? { lastRun } : {}),
  }
}

function collectMapLists(workflow: Workflow): Record<MapList, Set<string>> {
  const lists: Record<MapList, Set<string>> = {
    endpoints: new Set(),
    produces: new Set(),
    consumes: new Set(),
    env: new Set(),
    secrets: new Set(),
    calls: new Set(),
  }
  for (const node of workflow.nodes) {
    const endpoint = nodeEndpoint(node)
    // Placeholders collapse to {{…}}, so one route called with different
    // variables is one endpoint; the variable names are in `consumes`.
    if (endpoint !== undefined) lists.endpoints.add(`${endpoint.method ?? "GET"} ${endpoint.urlPath.replace(PLACEHOLDER_SPAN_RE, "{{…}}")}`)
    if (node.type === "workflow" && typeof node.config?.targetWorkflowId === "string") {
      lists.calls.add(node.config.targetWorkflowId)
    }
    for (const reference of nodeReferences(node)) referenceList(lists, reference).add(splitReference(reference.ref)[1])
  }
  return lists
}

function referenceList(lists: Record<MapList, Set<string>>, reference: NodeReference): Set<string> {
  const namespace = splitReference(reference.ref)[0]
  if (namespace === "variables") return reference.role === "produces" ? lists.produces : lists.consumes
  return namespace === "env" ? lists.env : lists.secrets
}

function splitReference(ref: string): [string, string] {
  const dot = ref.indexOf(".")
  return [ref.slice(0, dot), ref.slice(dot + 1)]
}
