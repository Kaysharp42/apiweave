/** The Run button's split menu: rerun what failed, or resume from one failed step. */
export interface CanvasToolbarRunMenuProps {
  readonly isRunning: boolean;
  readonly resumeOptions: Array<{ nodeId: string; label: string }>;
  readonly isResumeLoading: boolean;
  readonly onRerunFailed?: (() => void) | undefined;
  readonly onRunFromFailedNode?: ((nodeId: string) => void) | undefined;
}
