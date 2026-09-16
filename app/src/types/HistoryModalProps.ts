import type { RunRecord } from "./RunRecord";

export type { RunRecord } from "./RunRecord";

export interface HistoryModalProps {
  workflowId: string;
  workspaceId: string;
  /** Run to scroll to and mark on open — the one a Call Workflow node jumped here for. */
  highlightRunId?: string;
  onClose: () => void;
  onSelectRun: (run: RunRecord) => void;
  onShowTimeline?: (runId: string) => void;
}
