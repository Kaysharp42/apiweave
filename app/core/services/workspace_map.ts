import type { Workflow } from "@shared/types/Workflow"
import type { WorkspaceMapEntry } from "@shared/types/WorkspaceMapEntry"
import type { WorkspaceMapPage } from "@shared/types/WorkspaceMapPage"
import type { WorkflowSummaryCursor, WorkflowSummaryFilters } from "../repositories/WorkflowRepository"
import { ConflictError, ValidationError } from "../ipc/errors"
import { cursorScope, openCursor, sealCursor } from "../ipc/opaque_cursor"
import { nodeEndpoint, nodeReferences } from "./node_facts"
import { WORKSPACE_MAP_LIST_CAP } from "./read_budgets"
import type { RunService } from "./run_service"
import type { WorkflowService } from "./workflow_service"

const MAP_LISTS = ["endpoints", "produces", "consumes", "env", "secrets", "calls"] as const
type MapList = (typeof MAP_LISTS)[number]
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
    if (opened !== undefined && opened.snapshot !== cursorScope(page.snapshot)) {
      throw new ConflictError("The workflows changed since this cursor was issued; call again without a cursor.")
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
  const opened = openCursor(cursor, "m")
  const [updatedAt, workflowId] = opened?.position ?? []
  if (opened === undefined || updatedAt === undefined || workflowId === undefined) {
    throw new ValidationError("This cursor is not valid; call again without a cursor to start from the first page.")
  }
  if (opened.scope !== scope) {
    throw new ValidationError("This cursor was issued for a different workspace or project; call again without a cursor.")
  }
  return { after: { updatedAt, workflowId }, snapshot: opened.snapshot }
}

function mapEntry(workflow: Workflow, lastRun: WorkspaceMapEntry["lastRun"]): WorkspaceMapEntry {
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
    for (const reference of nodeReferences(node)) {
      const [namespace, name] = splitReference(reference.ref)
      if (namespace === "variables") lists[reference.role === "produces" ? "produces" : "consumes"].add(name)
      else if (namespace === "env") lists.env.add(name)
      else lists.secrets.add(name)
    }
  }
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

function splitReference(ref: string): [string, string] {
  const dot = ref.indexOf(".")
  return [ref.slice(0, dot), ref.slice(dot + 1)]
}
