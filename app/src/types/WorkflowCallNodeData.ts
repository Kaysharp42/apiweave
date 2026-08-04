import type { NodeStatus } from "./NodeStatus";
import type { CallWorkflowResult } from "./CallWorkflowResult";
import type { WorkflowCallNodeConfig } from "./WorkflowCallNodeConfig";

export interface WorkflowCallNodeData {
  label?: string;
  config?: WorkflowCallNodeConfig;
  executionStatus?: NodeStatus;
  executionResult?: CallWorkflowResult;
  status?: NodeStatus;
  result?: CallWorkflowResult;
}
