/**
 * Where the run's attention is, and how spread out it is: a centre and a size
 * in flow units, both weighted averages over the nodes the camera is attending
 * to.
 *
 * Not a `Rect` — `x`/`y` are the centre, not a corner — and deliberately not a
 * bounding box. A box's corners are decided by its two most extreme members, so
 * one node arriving or aging out changes it discontinuously; these are means, so
 * they move as smoothly as the weights do.
 */
export interface CameraFocus {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
