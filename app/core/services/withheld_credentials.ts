import type { JsonValue } from "@shared/types/JsonValue"
import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import { exportNode, exportWorkflow, stableJson } from "./workspace_repo_format"
import { findRedactedPlaceholders, SECRET_PLACEHOLDER, sanitizeVariablesForExport } from "./secret_utils"

/** A withheld variable keeps its local literal only while the incoming value still matches its export. */
export function keepWithheldVariables(stored: Record<string, JsonValue>, incoming: Record<string, JsonValue>): Record<string, JsonValue> {
  const exported = sanitizeVariablesForExport(asRecord(toPlain(stored)))
  return Object.fromEntries(Object.entries(incoming).map(([key, value]) => [
    key,
    key in exported && stableJson(exported[key]) === stableJson(value) ? stored[key]! : value,
  ]))
}

/** A node whose incoming config matches its export keeps the stored, unredacted config. */
export function keepWithheldConfig(node: WorkflowNode, stored: Workflow | undefined): WorkflowNode {
  const previous = stored?.nodes.find((candidate) => candidate.nodeId === node.nodeId)
  if (previous === undefined || previous.type !== node.type) return node
  const exportedConfig = asRecord(exportNode(previous))["config"] ?? null
  return stableJson(exportedConfig) === stableJson(toPlain(node.config ?? null))
    ? { ...node, config: previous.config } as WorkflowNode
    : node
}

/** A node-template array that still matches the export keeps its stored literals too. */
export function keepWithheldNodeTemplates(stored: Workflow | undefined, incoming: readonly JsonValue[]): JsonValue[] {
  return stored !== undefined && stableJson(exportWorkflow(stored).nodeTemplates ?? []) === stableJson(incoming)
    ? [...stored.nodeTemplates]
    : [...incoming]
}

/** The folder and workspace-repository imports report withheld placeholders identically. */
export function withheldPlaceholderWarning(
  workflowName: string,
  stored: Workflow | undefined,
  fields: Pick<Workflow, "nodes" | "variables" | "nodeTemplates">,
): string | undefined {
  const placeholders = findRedactedPlaceholders(toPlain({ nodes: fields.nodes, variables: fields.variables, nodeTemplates: fields.nodeTemplates }))
  if (placeholders.length === 0) return undefined
  return `Workflow '${workflowName}' has the placeholder "${SECRET_PLACEHOLDER}" at ${placeholders.join(", ")}: `
    + "the export withheld a credential there. Use a {{secrets.NAME}} reference instead"
    + (stored === undefined ? "" : "; the version before this import is in the workflow's history")
}

export function toPlain(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue
}

export function asRecord(value: JsonValue): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, JsonValue> : {}
}
