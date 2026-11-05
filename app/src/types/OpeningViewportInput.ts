import type { Rect } from "@xyflow/react";

/** Everything the opening view needs: where the graph is, how much room it has,
 * and the clearance to leave around it. */
export interface OpeningViewportInput {
  /** The graph's bounding box in flow coordinates. */
  bounds: Rect;
  /** The visible canvas size in screen pixels. */
  container: { width: number; height: number };
  /**
   * Clearance kept on every side of the graph, in screen pixels. It is applied
   * before the zoom is chosen, so it is real space on screen at any zoom.
   */
  padding: number;
}
