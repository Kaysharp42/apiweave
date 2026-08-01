import type { WorkflowCallNodeData } from "./WorkflowCallNodeData";

export type { WorkflowCallNodeData, WorkflowCallNodeConfig } from "./WorkflowCallNodeData";
export type { CallWorkflowResult } from "./CallWorkflowResult";

export interface WorkflowCallNodeProps {
  id: string;
  data: WorkflowCallNodeData;
  selected?: boolean;
}
