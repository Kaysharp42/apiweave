import type { ReactFlowState } from "reactflow";
import type { MinimapTransformView } from "../types/MinimapTransformView";

/**
 * Pure pieces of the frozen minimap (`components/RunMiniMap`).
 *
 * The freeze is a property of a selector, and selectors are what this file is
 * for: while the run camera moves it writes a viewport sixty times a second,
 * and each write wakes every subscriber to the ReactFlow store. The stock
 * `MiniMap` answers every one of those writes by recomputing its bounds and
 * repainting its viewport rectangle. `minimapTransformView` instead returns a
 * snapshot taken when the motion began — the same object every frame — so the
 * equality check below swallows the whole burst and the minimap renders none of
 * it. The camera comes to rest, the snapshot is dropped, and the minimap
 * catches up in one repaint.
 */

/** A node as the minimap sees it: a rectangle. */
interface MinimapRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
}

/**
 * The store slice the minimap renders from: the live transform while unfrozen,
 * the frozen snapshot while it is not. Frozen is read through the snapshot
 * itself — when it is set, the camera is mid-motion and no viewport change may
 * touch the minimap.
 */
export function minimapTransformView(
  state: Pick<ReactFlowState, "transform" | "width" | "height">,
  frozen: boolean,
  snapshot: MinimapTransformView | null,
): MinimapTransformView {
  if (frozen && snapshot) return snapshot;
  return {
    transform: state.transform,
    width: state.width,
    height: state.height,
  };
}

/** Equality for `MinimapTransformView`: identical when the transform and the
 * renderer size are. The frozen snapshot is its own stable object, so a camera
 * at full speed compares equal on every frame and costs no render at all. */
export function sameTransformView(
  a: MinimapTransformView,
  b: MinimapTransformView,
): boolean {
  return (
    a.transform[0] === b.transform[0] &&
    a.transform[1] === b.transform[1] &&
    a.transform[2] === b.transform[2] &&
    a.width === b.width &&
    a.height === b.height
  );
}

/** The union of the nodes' bounds and the viewport rectangle: where the minimap
 * window must sit to show both the graph and where the camera is. */
export function minimapBoundingRect(
  rects: readonly MinimapRect[],
  viewBB: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  let minX = viewBB.x;
  let minY = viewBB.y;
  let maxX = viewBB.x + viewBB.width;
  let maxY = viewBB.y + viewBB.height;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
