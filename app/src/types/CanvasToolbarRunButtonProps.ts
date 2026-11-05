/** The primary half of the run split button. */
export interface CanvasToolbarRunButtonProps {
  readonly onRun: () => void;
  readonly onCancel?: (() => void) | undefined;
  readonly isRunning: boolean;
}
