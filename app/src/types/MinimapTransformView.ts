import type { Transform } from "reactflow";

/**
 * What the minimap re-derives on every viewport change: the transform that
 * positions its viewport rectangle, and the renderer's own size.
 *
 * Kept as a tiny value type because the frozen minimap's selector holds one of
 * these as a stable snapshot — while it is set, no viewport write the run
 * camera makes may change the minimap's answer.
 */
export interface MinimapTransformView {
  transform: Transform;
  width: number;
  height: number;
}
