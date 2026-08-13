/**
 * The three moments a run camera needs to be told about, handed to
 * `useWorkflowPolling` so the camera can ride the *playback's* clock rather than
 * the runner's — the canvas paces node repaints, and a camera that moved on the
 * raw IPC stream would arrive at nodes before they lit up.
 *
 * Every method is a no-op when following is not engaged, so callers never have
 * to ask whether the camera is interested.
 */
export interface RunCameraHandle {
  /**
   * A run has begun. `entryNodeIds` are the start nodes, which the canvas
   * releases itself because their real events predate the IPC subscription —
   * they are also the only sensible target for the opening move.
   */
  onRunStart: (entryNodeIds: readonly string[]) => void;

  /**
   * One node just changed on screen, in the canvas's status vocabulary
   * (`running` / `success` / `error` / `warning` / `skipped`).
   */
  onNodeShown: (nodeId: string, status: string) => void;

  /** The playback has caught up with a finished run; there is nothing left to
   * follow. */
  onRunSettled: () => void;
}
