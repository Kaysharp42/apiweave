/** The Record control in the canvas toolbar. */
export interface CanvasToolbarRecordProps {
  /** This workflow's view of the recording; `elsewhere` when another workflow is being recorded. */
  readonly state: "idle" | "starting" | "recording" | "stopping" | "elsewhere";
  readonly stepCount: number;
  /** A run is in progress, or the canvas is still loading: nothing to record into yet. */
  readonly disabled: boolean;
  readonly onRecord: () => void;
  readonly onStop: () => void;
  readonly showLabel?: boolean;
}
