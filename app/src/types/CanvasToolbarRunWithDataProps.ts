/** The data-file picker beside Run: one workflow run per row of the file. */
export interface CanvasToolbarRunWithDataProps {
  readonly onRunWithData: (file: File) => void;
  readonly isRunning: boolean;
}
