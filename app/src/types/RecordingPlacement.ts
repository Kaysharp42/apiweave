/** Where one recording's steps go on the canvas, fixed when it starts. */
export interface RecordingPlacement {
  /** The node the first step is connected after: the selected node, or Start. */
  readonly anchorId: string;
  /** The frame the steps are put in, created with the first step. */
  readonly frameId: string;
  readonly frameLabel: string;
}
