/**
 * The camera's own state, integrated frame by frame.
 *
 * The camera keeps its position rather than reading it back from ReactFlow,
 * because velocity is the whole point: a transform tells you where the viewport
 * is, not where it was going, and motion that is smooth across a retarget needs
 * to carry its momentum through it.
 *
 * `x`/`y` are the flow point the camera puts at the *container's* centre, which
 * is what `setViewport` means by a transform; the offset that keeps the action
 * out from under the toolbar is applied when the target is chosen.
 */
export interface CameraMotion {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  /** Pan velocity, flow units per second. */
  readonly vx: number;
  readonly vy: number;
  /** Zoom velocity, octaves per second — the rate the eye actually judges. */
  readonly vZoom: number;
  /**
   * The camera is currently correcting. Latched: it is set when the focus leaves
   * the deadzone and cleared only once the focus is near centre again, so a
   * correction cannot cancel itself the moment it starts working.
   */
  readonly engaged: boolean;
  /**
   * The zoom being approached. Never rises during a run, which is what makes
   * the zoom cycling this replaced impossible rather than merely unlikely.
   */
  readonly zoomTarget: number;
  /** How long the focus has not fitted, so a momentary spread does not commit
   * the whole run to a wider view. */
  readonly crampedMs: number;
  /**
   * Where in the frame, in screen pixels from its centre, the current correction
   * is trying to put the focus. Negative x means left of centre.
   *
   * Chosen when the correction starts and held for its duration: the camera aims
   * *past* the action, against the direction it left the frame in, so the move
   * both shows where the run is heading and buys the longest possible wait before
   * the next one.
   */
  readonly aimBiasX: number;
  readonly aimBiasY: number;
}
