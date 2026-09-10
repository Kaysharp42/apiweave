import type { z } from "zod"
import {
  McpWorkflowDiagnosisSchema,
  McpWorkflowWriteResultSchema,
} from "@shared/zod-schemas"
import type { WorkflowDiagnosis } from "@shared/types/WorkflowDiagnosis"
import type { Workflow } from "@shared/types/Workflow"
import type { McpToolSpec } from "../tools"

const MAX_TOUCHED_IDS = 20
const MAX_DIAGNOSIS_ITEMS = 20
const MAX_DIAGNOSIS_DETAIL_BYTES = 10 * 1024

type McpWorkflowDiagnosis = z.infer<typeof McpWorkflowDiagnosisSchema>
type McpWorkflowWriteResult = z.infer<typeof McpWorkflowWriteResultSchema>

export function projectWorkflowWrite(
  spec: McpToolSpec,
  payload: Record<string, unknown>,
  data: unknown,
): McpWorkflowWriteResult | undefined {
  const workflow = workflowFrom(data)
  if (workflow === undefined) return undefined
  const touched = touchedIds(spec, payload)
  return {
    workflowId: workflow.workflowId,
    rev: workflow.rev,
    nodeCount: workflow.nodes.length,
    edgeCount: workflow.edges.length,
    touchedNodeIds: touched.nodeIds.slice(0, MAX_TOUCHED_IDS),
    touchedNodeIdsTotal: touched.nodeIds.length,
    touchedEdgeIds: touched.edgeIds.slice(0, MAX_TOUCHED_IDS),
    touchedEdgeIdsTotal: touched.edgeIds.length,
  }
}

export function compactWorkflowDiagnosis(diagnosis: WorkflowDiagnosis): McpWorkflowDiagnosis {
  const ordered = [...diagnosis.diagnostics].sort((left, right) => severityOrder(left.severity) - severityOrder(right.severity))
  const items = [] as NonNullable<Extract<McpWorkflowDiagnosis, { status: "complete" }> >["items"]
  let detailBytes = 0
  for (const item of ordered) {
    if (items.length >= MAX_DIAGNOSIS_ITEMS) break
    const projected = {
      code: item.code,
      severity: item.severity,
      category: item.category,
      nodeIds: item.nodeIds,
      message: item.message,
      remediation: item.remediation,
    }
    const bytes = Buffer.byteLength(JSON.stringify(projected), "utf8")
    if (items.length > 0 && detailBytes + bytes > MAX_DIAGNOSIS_DETAIL_BYTES) break
    items.push(projected)
    detailBytes += bytes
  }
  return {
    status: "complete",
    summary: diagnosis.summary,
    items,
    omittedItemCount: diagnosis.diagnostics.length - items.length,
  }
}

export function unavailableWorkflowDiagnosis(): McpWorkflowDiagnosis {
  return { status: "unavailable", message: "Static analysis was unavailable after the workflow was saved." }
}

export function workflowIdentity(data: unknown, payload: Record<string, unknown>): { workspaceId: string; workflowId: string } | undefined {
  const workflow = workflowFrom(data)
  if (workflow !== undefined) return { workspaceId: workflow.workspaceId, workflowId: workflow.workflowId }
  if (typeof payload["workspaceId"] !== "string") return undefined
  if (typeof payload["workflowId"] !== "string") return undefined
  return { workspaceId: payload["workspaceId"], workflowId: payload["workflowId"] }
}

function workflowFrom(data: unknown): Workflow | undefined {
  if (isWorkflow(data)) return data
  if (typeof data !== "object" || data === null || !("workflow" in data)) return undefined
  return isWorkflow(data.workflow) ? data.workflow : undefined
}

function isWorkflow(value: unknown): value is Workflow {
  return typeof value === "object"
    && value !== null
    && typeof (value as { workflowId?: unknown }).workflowId === "string"
    && typeof (value as { workspaceId?: unknown }).workspaceId === "string"
    && typeof (value as { rev?: unknown }).rev === "number"
    && Array.isArray((value as { nodes?: unknown }).nodes)
    && Array.isArray((value as { edges?: unknown }).edges)
}

function touchedIds(spec: McpToolSpec, payload: Record<string, unknown>): { nodeIds: string[]; edgeIds: string[] } {
  if (spec.domain === "assertions" && spec.action === "apply") {
    return typeof payload["assertionNodeId"] === "string"
      ? { nodeIds: [payload["assertionNodeId"]], edgeIds: [] }
      : { nodeIds: [], edgeIds: [] }
  }
  if (spec.domain !== "workflows" || spec.action !== "patch") return { nodeIds: [], edgeIds: [] }
  return {
    nodeIds: idsFrom(payload["upsertNodes"], "nodeId").concat(idsFrom(payload["removeNodeIds"])),
    edgeIds: idsFrom(payload["upsertEdges"], "edgeId").concat(idsFrom(payload["removeEdgeIds"])),
  }
}

function idsFrom(value: unknown, key?: "nodeId" | "edgeId"): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "string") return [item]
    if (key !== undefined && typeof item === "object" && item !== null && typeof item[key] === "string") return [item[key]]
    return []
  }).sort()
}

function severityOrder(severity: "error" | "warning" | "notice"): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2
}
