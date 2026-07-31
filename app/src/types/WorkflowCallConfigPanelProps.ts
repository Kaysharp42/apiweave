import type { NodeModalWorkflowCallConfig } from "./NodeModalWorkflowCallConfig";

export interface WorkflowCallConfigPanelProps {
  initialConfig: Partial<NodeModalWorkflowCallConfig>;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  workspaceId: string;
  currentWorkflowId: string;
}
