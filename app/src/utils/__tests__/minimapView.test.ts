import { describe, it, expect } from "vitest";
import {
  minimapBoundingRect,
  minimapTransformView,
  sameTransformView,
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

  it("unions the nodes with the viewport", () => {
    const rect = minimapBoundingRect(
      [{ id: "a", x: -50, y: 200, width: 40, height: 20, selected: false }],
      view,
    );
    expect(rect).toEqual({ x: -50, y: 0, width: 150, height: 220 });
  });
});
