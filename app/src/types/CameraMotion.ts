import type { CameraCrossing } from "./CameraCrossing";

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
   * The camera is correcting, per axis. Latched: set when the action leaves the
   * deadzone and cleared only once it is near the mark again, so a correction
   * cannot cancel itself the moment it starts working.
   *
   * Per axis because a run that walks left to right leaves X engaged more or less
   * permanently, and a single shared latch made that hold Y engaged too — so the
   * vertical deadzone never applied and the picture was shoved up and down at the
   * event rate. An axis that is not engaged holds its position.
   */
  readonly engagedX: boolean;
  readonly engagedY: boolean;
  /**
   * The zoom the run is being watched at. Never rises within a run, which is what
   * makes the zoom cycling this replaced impossible rather than merely unlikely.
   *
   * A crossing overrides the zoom for its duration without touching this, so a
   * handoff cannot ratchet the run's framing either.
   */
  readonly workZoom: number;
  /** A handoff to another branch, while one is in flight. */
  readonly crossing: CameraCrossing | null;
  /** How long the subject has not fitted, so a momentary spread does not commit
   * the whole run to a wider view. */
  readonly crampedMs: number;
  /**
   * Where in the frame, in screen pixels from its centre, the current correction
   * is trying to put the subject. Negative x means left of centre.
   *
   * Chosen when the correction starts and held for its duration: the camera aims
   * *past* the action, against the direction it left the frame in, so the move
   * both shows where the run is heading and buys the longest possible wait before
   * the next one.
   */
  readonly aimBiasX: number;
  readonly aimBiasY: number;
}
