import type { RunIteration } from "@shared/types/RunIteration";

export interface CanvasToolbarProps {
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  canGroup: boolean;
  canUngroup: boolean;
  onHistory: () => void;
  onJsonEditor: () => void;
  onImport: () => void;
  onCommandPalette: () => void;
  onRun: () => void;
  /** Run once per row of a picked CSV or JSON data file. */
  onRunWithData?: (file: File) => void;
  onCancel?: () => void;
  /** Rerun the latest failed run's failed steps and what follows them. */
  onRerunFailed?: () => void;
  /** Run from one of the latest failed run's failed steps. */
  onRunFromFailedNode?: (nodeId: string) => void;
  isRunning?: boolean;
  /** The data-driven run iteration on screen, shown beside Run while it runs. */
  iteration?: RunIteration | null;
  environments: Array<{ environmentId: string; name: string }>;
  selectedEnvironment?: string;
  onEnvironmentChange: (value: string) => void;
  onRefreshSwagger?: () => void;
  isSwaggerRefreshing?: boolean;
  workflowId?: string;
  resumeOptions?: Array<{ nodeId: string; label: string }>;
  isResumeLoading?: boolean;
}
