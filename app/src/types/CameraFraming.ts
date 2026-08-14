/**
 * Where the camera is being sent: the flow-coordinate point to put at the
 * centre of the viewport, and the zoom to arrive at. Deliberately the exact
 * argument list of ReactFlow's `setCenter(x, y, { zoom })`.
 *
 * Not to be confused with ReactFlow's own `Viewport`, which is the same three
 * numbers meaning a *transform* (translate + scale) rather than a centre.
 */
export interface CameraFraming {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}
