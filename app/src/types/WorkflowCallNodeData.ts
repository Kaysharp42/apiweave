import type { NodeStatus } from "./NodeStatus";
import type { CallWorkflowResult } from "./CallWorkflowResult";

export interface WorkflowCallNodeConfig {
  targetWorkflowId?: string | null;
  /** Denormalized display name, refreshed whenever the picker sets a new target. Read-only on the canvas. */
  targetWorkflowName?: string | null;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
}

export interface WorkflowCallNodeData {
  label?: string;
  config?: WorkflowCallNodeConfig;
  executionStatus?: NodeStatus;
  executionResult?: CallWorkflowResult;
  status?: NodeStatus;
  result?: CallWorkflowResult;
}
