import type { Workflow } from "@shared/types/Workflow";

export interface WorkflowCanvasProps {
  workflowId: string | undefined;
  workflow: Workflow | null | undefined;
  isPanelOpen?: boolean;
  showVariablesPanel?: boolean;
  onShowVariablesPanel?: (show: boolean) => void;
}
