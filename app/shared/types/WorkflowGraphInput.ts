import type { JsonValue } from "./JsonValue"
import type { WorkflowEdge } from "./WorkflowEdge"
import type { WorkflowNode } from "./WorkflowNode"

/**
 * The structural subset of a workflow that the graph analyzer reads. The canvas
 * run gate builds this from ReactFlow nodes/edges so it can run the *same*
 * diagnosis used by `workflow_diagnose`, `assertion_validate` and `assertion_apply`
 * — keeping one validator rather than two that disagree (a real run was blocked
 * for `expectedValue: false` while `assertion_validate` accepted it).
 *
 * `variables` is optional because the static gate does not have the persisted
 * variables map; the analyzer treats a missing map as empty.
 */
export interface WorkflowGraphInput {
  readonly workflowId?: string | undefined
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
  readonly variables?: Readonly<Record<string, JsonValue>> | undefined
}