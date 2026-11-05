import { describe, expect, it } from "vitest";
import {
  OPENING_MIN_ZOOM,
  OPENING_VIEW_PADDING,
  openingViewport,
} from "./openingViewport";

const container = { width: 1000, height: 800 };
const padding = OPENING_VIEW_PADDING;

describe("openingViewport", () => {
  it("centres a small graph at no more than 1x", () => {
    const view = openingViewport({
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      container,
      padding,
    });

    expect(view).toEqual({ x: 400, y: 350, zoom: 1 });
  });

  it("opens a long horizontal chain at its start and readable zoom", () => {
    const view = openingViewport({
      bounds: { x: 0, y: 0, width: 13_720, height: 100 },
      container,
      padding,
    });

    // The chain cannot fit, so the left edge sits at the padding and the view
    // runs off the right rather than shrinking the whole graph to a dotted line.
    expect(view.zoom).toBe(0.8);
    expect(view.x).toBe(padding);
    // The short axis still fits, so it stays centred.
    expect(view.y).toBe((container.height - 100 * view.zoom) / 2);
  });

  it("opens a tall graph at its top and readable zoom", () => {
    const view = openingViewport({
      bounds: { x: 100, y: 0, width: 200, height: 5000 },
      container,
      padding,
    });

    expect(view.zoom).toBe(OPENING_MIN_ZOOM);
    expect(view.y).toBe(padding);
    expect(view.x).toBe((container.width - 200 * view.zoom) / 2 - 100 * view.zoom);
  });

  it("aligns the start edge in flow coordinates, not the origin", () => {
    const view = openingViewport({
      bounds: { x: 5000, y: 2500, width: 13_720, height: 4000 },
      container,
      padding,
    });

    expect(view.zoom).toBe(OPENING_MIN_ZOOM);
    expect(view.x).toBe(padding - 5000 * view.zoom);
    expect(view.y).toBe(padding - 2500 * view.zoom);
  });

  it("returns the identity viewport for an unmeasured graph", () => {
    expect(
      openingViewport({
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        container,
        padding,
      }),
    ).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("returns the identity viewport before the container has a size", () => {
    expect(
      openingViewport({
        bounds: { x: 0, y: 0, width: 200, height: 100 },
        container: { width: 0, height: 0 },
        padding,
      }),
    ).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
