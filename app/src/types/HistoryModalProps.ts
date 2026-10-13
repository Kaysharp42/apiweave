import type { RunSummary } from "@shared/types/RunSummary";

export interface HistoryModalProps {
  workflowId: string;
  workspaceId: string;
  /** Run to scroll to and mark on open — the one a Call Workflow node jumped here for. */
  highlightRunId?: string;
  onClose: () => void;
  onSelectRun: (run: RunSummary) => void;
  onShowTimeline?: (runId: string) => void;
}
