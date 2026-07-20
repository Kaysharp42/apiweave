import type { WorkflowCanvasWorkflow } from "./WorkflowCanvasWorkflow";

export interface WorkflowCanvasProps {
  workflowId: string | undefined;
  workflow: WorkflowCanvasWorkflow | null | undefined;
  isPanelOpen?: boolean;
  showVariablesPanel?: boolean;
  onShowVariablesPanel?: (show: boolean) => void;
}
