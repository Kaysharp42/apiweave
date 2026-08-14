/**
 * The canvas's on-screen box, in CSS pixels, plus the bands its floating
 * fixtures cover.
 *
 * `insetTop`/`insetBottom` exist because the toolbar and the minimap are drawn
 * over the flow, not beside it: framing centres the action in what is left,
 * so a followed node never lands underneath the Run button.
 */
export interface CameraViewport {
  readonly width: number;
  readonly height: number;
  readonly insetTop: number;
  readonly insetBottom: number;
}
