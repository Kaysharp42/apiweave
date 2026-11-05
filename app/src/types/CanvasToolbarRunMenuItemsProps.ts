/** The rows of the Run options menu. */
export interface CanvasToolbarRunMenuItemsProps {
  readonly isRunning: boolean;
  readonly resumeOptions: Array<{ nodeId: string; label: string }>;
  readonly isResumeLoading: boolean;
  readonly onRerunFailed?: (() => void) | undefined;
  readonly onRunFromFailedNode?: ((nodeId: string) => void) | undefined;
}
