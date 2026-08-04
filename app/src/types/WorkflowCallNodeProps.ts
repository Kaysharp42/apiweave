import type { WorkflowCallNodeData } from "./WorkflowCallNodeData";

export type { WorkflowCallNodeData } from "./WorkflowCallNodeData";
export type { WorkflowCallNodeConfig } from "./WorkflowCallNodeConfig";
export type { CallWorkflowResult } from "./CallWorkflowResult";

export interface WorkflowCallNodeProps {
  id: string;
  data: WorkflowCallNodeData;
  selected?: boolean;
}
