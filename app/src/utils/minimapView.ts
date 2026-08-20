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
 * The smallest a node may be drawn, in the minimap's own pixels.
 *
 * The minimap fits the whole graph at one uniform scale, so a long graph sets
 * that scale by its longest axis and every node shrinks by the same factor —
 * including on the short axis, where there was no crowding to relieve. A
 * 130-node chain spans ~29000 x 400 units into 220 x 150, which is a scale of
 * 134 world units per pixel: a 280x120 node lands at 2.1 x 0.9 px, and
 * `crispEdges` snaps that sub-pixel height away to nothing. The graph is then
 * present, correctly positioned, and completely invisible.
 *
 * Three is the floor at which a mark survives that snapping and still reads as
 * a mark. Nodes that are already larger are untouched, so this only ever
 * applies where the alternative was showing nothing.
 */
export const MIN_NODE_PX = 3;

/**
 * A node's rectangle grown about its own centre to at least `MIN_NODE_PX`
 * minimap pixels on each axis.
 *
 * Grown for drawing only — `minimapBoundingRect` still fits the true rects, so
 * enlarging a mark cannot feed back into the scale that decided it needed
 * enlarging.
 */
export function legibleNodeRect(
  rect: { x: number; y: number; width: number; height: number },
  viewScale: number,
): { x: number; y: number; width: number; height: number } {
  if (!Number.isFinite(viewScale) || viewScale <= 0) return { ...rect };

  const floor = MIN_NODE_PX * viewScale;
  const width = Math.max(rect.width, floor);
  const height = Math.max(rect.height, floor);
  return {
    x: rect.x - (width - rect.width) / 2,
    y: rect.y - (height - rect.height) / 2,
    width,
    height,
  };
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

/**
 * How far the viewport rectangle may pull the fit box past the nodes' own
 * bounds, as a multiple of the nodes' span on that axis.
 *
 * `viewBB` is world units (screen size ÷ zoom), so zooming the main canvas out
 * grows it without limit — left uncapped, one union with the nodes' bounds
 * balloons the SVG `viewBox` until every node renders under a pixel wide,
 * which reads as "the minimap has no nodes at all" (the bug this guards
 * against). Capped per side rather than by centering, so the viewport
 * rectangle still extends the frame in whichever direction it actually lies —
 * it just cannot stretch it past a size where the graph itself disappears.
 */
const MAX_VIEWPORT_STRETCH = 1;

/** The union of the nodes' bounds and the viewport rectangle, the latter
 * capped by `MAX_VIEWPORT_STRETCH`: where the minimap window must sit to show
 * the graph, and as much of where the camera is as that allows. */
export function minimapBoundingRect(
  rects: readonly MinimapRect[],
  viewBB: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  let nodesMinX = Infinity;
  let nodesMinY = Infinity;
  let nodesMaxX = -Infinity;
  let nodesMaxY = -Infinity;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    nodesMinX = Math.min(nodesMinX, rect.x);
    nodesMinY = Math.min(nodesMinY, rect.y);
    nodesMaxX = Math.max(nodesMaxX, rect.x + rect.width);
    nodesMaxY = Math.max(nodesMaxY, rect.y + rect.height);
  }

  // Nothing measured yet: the viewport is the only thing there is to show.
  if (nodesMinX === Infinity) return { ...viewBB };

  const capX = (nodesMaxX - nodesMinX) * MAX_VIEWPORT_STRETCH;
  const capY = (nodesMaxY - nodesMinY) * MAX_VIEWPORT_STRETCH;
  const viewMaxX = viewBB.x + viewBB.width;
  const viewMaxY = viewBB.y + viewBB.height;

  const minX = nodesMinX - Math.min(Math.max(nodesMinX - viewBB.x, 0), capX);
  const minY = nodesMinY - Math.min(Math.max(nodesMinY - viewBB.y, 0), capY);
  const maxX = nodesMaxX + Math.min(Math.max(viewMaxX - nodesMaxX, 0), capX);
  const maxY = nodesMaxY + Math.min(Math.max(viewMaxY - nodesMaxY, 0), capY);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
