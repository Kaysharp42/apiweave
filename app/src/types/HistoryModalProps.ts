import type { RunRecord } from "./RunRecord";

export type { RunRecord } from "./RunRecord";

export interface HistoryModalProps {
  workflowId: string;
  workspaceId: string;
  onClose: () => void;
  onSelectRun: (run: RunRecord) => void;
}
