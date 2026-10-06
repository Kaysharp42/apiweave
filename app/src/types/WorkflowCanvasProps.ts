import type { Workflow } from "@shared/types/Workflow";

export interface WorkflowCanvasProps {
  workflowId: string | undefined;
  workflow: Workflow | null | undefined;
  /** The tab's unsaved draft, hydrated in place of `workflow` when present. */
  draft?: Workflow | undefined;
  isPanelOpen?: boolean;
  showVariablesPanel?: boolean;
  onShowVariablesPanel?: (show: boolean) => void;
}
