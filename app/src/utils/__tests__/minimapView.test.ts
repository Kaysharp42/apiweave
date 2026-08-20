import { describe, it, expect } from "vitest";
import {
  legibleNodeRect,
  minimapBoundingRect,
  minimapTransformView,
  sameTransformView,
  MIN_NODE_PX,
} from "../minimapView";
import type { MinimapTransformView } from "../../types/MinimapTransformView";

const state = {
  transform: [100, 200, 0.5] as [number, number, number],
  width: 1600,
  height: 1000,
};

describe("minimapTransformView", () => {
  it("reads the live transform while unfrozen", () => {
    expect(minimapTransformView(state, false, null)).toEqual({
      transform: state.transform,
      width: 1600,
      height: 1000,
    });
  });

  it("holds the snapshot while frozen, ignoring store updates", () => {
    const snapshot: MinimapTransformView = {
      transform: [10, 20, 1],
      width: 1600,
      height: 1000,
    };
    const moved = {
      ...state,
      transform: [500, 600, 2] as [number, number, number],
    };

    // Same object back, not the store's: that identity is what lets the
    // selector compare equal on every one of the camera's frames.
    expect(minimapTransformView(moved, true, snapshot)).toBe(snapshot);
  });

  it("keeps the live transform while frozen before any snapshot exists", () => {
    expect(minimapTransformView(state, true, null)).toEqual({
      transform: state.transform,
      width: 1600,
      height: 1000,
    });
  });
});

describe("sameTransformView", () => {
  const a: MinimapTransformView = {
    transform: [1, 2, 3],
    width: 100,
    height: 200,
  };

  it("is true when nothing the minimap draws changed", () => {
    expect(sameTransformView(a, { ...a })).toBe(true);
  });

  it("is false on any pan or zoom, however small", () => {
    expect(sameTransformView(a, { ...a, transform: [1.1, 2, 3] })).toBe(false);
    expect(sameTransformView(a, { ...a, transform: [1, 2, 3.5] })).toBe(false);
  });

  it("is false when the renderer resized", () => {
    expect(sameTransformView(a, { ...a, width: 120 })).toBe(false);
  });
});

describe("minimapBoundingRect", () => {
  const view = { x: 0, y: 0, width: 100, height: 100 };

  it("is the viewport itself while no node is measured", () => {
    expect(
      minimapBoundingRect(
        [{ id: "a", x: 5, y: 5, width: 0, height: 10, selected: false }],
        view,
      ),
    ).toEqual(view);
  });

  it("unions the nodes with the viewport, capped to one node-span of overhang per side", () => {
    // Node spans 40x20; the viewport reaches 110 past it on the right and 200
    // past it above. Both get capped to the node's own span (40, then 20)
    // rather than reaching all the way to the viewport's edge.
    const rect = minimapBoundingRect(
      [{ id: "a", x: -50, y: 200, width: 40, height: 20, selected: false }],
      view,
    );
    expect(rect).toEqual({ x: -50, y: 180, width: 80, height: 40 });
  });

  it("fits the true node rects, not the enlarged ones drawn from them", () => {
    // The floor is a drawing concern only. If it fed back into the bounds, a
    // graph long enough to trigger it would grow its own fit box and need a
    // larger floor again.
    const nodes = [
      { id: "a", x: 0, y: 0, width: 280, height: 120, selected: false },
      { id: "b", x: 29158, y: 286, width: 280, height: 120, selected: false },
    ];
    const rect = minimapBoundingRect(nodes, { x: 0, y: 0, width: 1, height: 1 });
    expect(rect.width).toBe(29438);
    expect(rect.height).toBe(406);
  });

  it("keeps nodes legible instead of ballooning to the viewport when zoomed far out", () => {
    // A tight cluster of nodes vs. a viewport ten times its size, as happens
    // after a few wheel-zoom-outs on the main canvas — the bug this guards
    // against shrank every node to sub-pixel by unioning all the way out to
    // the huge viewport.
    const nodes = [
      { id: "a", x: 0, y: 0, width: 150, height: 40, selected: false },
      { id: "b", x: 300, y: 250, width: 150, height: 40, selected: false },
    ];
    const farView = { x: -2000, y: -1500, width: 5000, height: 4000 };
    const rect = minimapBoundingRect(nodes, farView);

    // Nodes span 450x290; the fit box may grow by at most one node-span of
    // overhang per side, so at most 3x the node span in total — nowhere near
    // the 5000x4000 viewport.
    expect(rect.width).toBeLessThanOrEqual(450 * 3);
    expect(rect.height).toBeLessThanOrEqual(290 * 3);
  });
});

describe("legibleNodeRect", () => {
  it("leaves a node that is already big enough alone", () => {
    // A small graph: 4 world units per pixel, so a 280x120 node is 70x30px.
    const rect = { x: 100, y: 50, width: 280, height: 120 };
    expect(legibleNodeRect(rect, 4)).toEqual(rect);
  });

  it("grows a sub-pixel node to the floor, about its own centre", () => {
    // The real 130-node case: ~29438x406 units of graph into 220x150, which is
    // 133.8 units per pixel. Unfloored the node draws 2.1 x 0.9 px, and
    // `crispEdges` snaps the height away entirely.
    const viewScale = 133.8;
    const drawn = legibleNodeRect(
      { x: 29158, y: 286, width: 280, height: 120 },
      viewScale,
    );

    expect(drawn.width / viewScale).toBeCloseTo(MIN_NODE_PX, 5);
    expect(drawn.height / viewScale).toBeCloseTo(MIN_NODE_PX, 5);
    // Centred on where the node actually is, so the map stays truthful.
    expect(drawn.x + drawn.width / 2).toBeCloseTo(29158 + 140, 5);
    expect(drawn.y + drawn.height / 2).toBeCloseTo(286 + 60, 5);
  });

  it("gives an unmeasured node a mark rather than nothing", () => {
    // ReactFlow reports no dimensions until it has measured; the fork maps
    // those to zero. A zero-size rect paints nothing, so a node awaiting
    // measurement would silently vanish from the map.
    const drawn = legibleNodeRect({ x: 400, y: 300, width: 0, height: 0 }, 10);
    expect(drawn.width).toBe(MIN_NODE_PX * 10);
    expect(drawn.height).toBe(MIN_NODE_PX * 10);
  });

  it("passes the rect through when there is no usable scale yet", () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 };
    expect(legibleNodeRect(rect, 0)).toEqual(rect);
    expect(legibleNodeRect(rect, Number.NaN)).toEqual(rect);
    expect(legibleNodeRect(rect, Number.POSITIVE_INFINITY)).toEqual(rect);
  });
});
