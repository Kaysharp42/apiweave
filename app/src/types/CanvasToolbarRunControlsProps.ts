import type { RunIteration } from "@shared/types/RunIteration";

/** The run split button, its options menu, and the data-file iteration beside them. */
export interface CanvasToolbarRunControlsProps {
  readonly onRun: () => void;
  readonly onRunWithData?: ((file: File) => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly onRerunFailed?: (() => void) | undefined;
  readonly onRunFromFailedNode?: ((nodeId: string) => void) | undefined;
  readonly isRunning: boolean;
  /** The data-driven run iteration on screen, shown beside Run while it runs. */
  readonly iteration: RunIteration | null;
  readonly resumeOptions: Array<{ nodeId: string; label: string }>;
  readonly isResumeLoading: boolean;
}
