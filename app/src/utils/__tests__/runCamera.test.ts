import { describe, it, expect } from "vitest";
import type { Rect, Viewport } from "reactflow";
import {
  boundsOf,
  fitZoomFor,
  framedSubset,
  framingFor,
  moveDurationMs,
  needsMove,
  zoomFor,
  FOLLOW_DEADZONE,
  FOLLOW_MAX_ZOOM,
  FOLLOW_MIN_ZOOM,
  FOLLOW_PADDING_PX,
  MAX_MOVE_MS,
  MIN_MOVE_MS,
  PAN_SCREEN_MS,
  READABLE_ZOOM,
  ZOOM_OCTAVE_MS,
} from "../runCamera";
import type { CameraViewport } from "../../types/CameraViewport";

/** A roomy canvas with the real chrome bands: toolbar on top, minimap below. */
const viewport: CameraViewport = {
  width: 1600,
  height: 1000,
  insetTop: 56,
  insetBottom: 12,
};

/** Same canvas with no chrome, for the tests about centring alone. */
const bareViewport: CameraViewport = {
  width: 1600,
  height: 1000,
  insetTop: 0,
  insetBottom: 0,
};

function node(x: number, y = 0, width = 280, height = 120): Rect {
  return { x, y, width, height };
}

/** The transform that would result from actually arriving at `framing`. */
function viewportShowing(
  framing: { x: number; y: number; zoom: number },
  box: CameraViewport,
): Viewport {
  return {
    x: box.width / 2 - framing.x * framing.zoom,
    y: box.height / 2 - framing.y * framing.zoom,
    zoom: framing.zoom,
  };
}

describe("boundsOf", () => {
  it("has nothing to report for an empty set", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("returns the single rectangle it was given", () => {
    expect(boundsOf([node(100, 50)])).toEqual({
      x: 100,
      y: 50,
      width: 280,
      height: 120,
    });
  });

  it("spans every rectangle, in both axes", () => {
    const bounds = boundsOf([node(0, 0), node(1000, 400)]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 1280, height: 520 });
  });
});

describe("framingFor", () => {
  it("clamps to the ceiling rather than filling the screen with one node", () => {
    const bounds = boundsOf([node(0)])!;
    // A lone 280x120 node could be blown up past 5x before it filled the canvas.
    expect(fitZoomFor(bounds, viewport)).toBeGreaterThan(FOLLOW_MAX_ZOOM);
    expect(framingFor(bounds, viewport).zoom).toBe(FOLLOW_MAX_ZOOM);
  });

  it("clamps to the floor rather than zooming out to nothing", () => {
    const bounds = boundsOf([node(0), node(10000)])!;
    expect(fitZoomFor(bounds, viewport)).toBeLessThan(FOLLOW_MIN_ZOOM);
    expect(framingFor(bounds, viewport).zoom).toBe(FOLLOW_MIN_ZOOM);
  });

  it("aims at the centre of the set when no chrome is in the way", () => {
    const bounds = boundsOf([node(0, 0), node(1000, 400)])!;
    const framing = framingFor(bounds, bareViewport);
    expect(framing.x).toBe(640); // (0 + 1280) / 2
    expect(framing.y).toBe(260); // (0 + 520) / 2
  });

  it("aims above the centre so the toolbar band does not cover the action", () => {
    const bounds = boundsOf([node(0)])!;
    const framed = framingFor(bounds, viewport);
    const bare = framingFor(bounds, bareViewport);

    // Free space sits lower than the container's middle, so the target moves up
    // by half the imbalance — which pushes the node itself down, clear of the
    // toolbar. Horizontal framing is untouched.
    expect(framed.x).toBe(bare.x);
    expect(framed.y).toBeLessThan(bare.y);
    expect(bare.y - framed.y).toBeCloseTo((56 - 12) / 2 / framed.zoom, 6);
  });

  it("leaves the padding it promised on each side", () => {
    // A set wide enough to be zoom-limited by width, so the fit is exact.
    const bounds = boundsOf([node(0), node(2000)])!;
    const framing = framingFor(bounds, bareViewport);
    expect(framing.zoom).toBeGreaterThan(FOLLOW_MIN_ZOOM);
    expect(framing.zoom).toBeLessThan(FOLLOW_MAX_ZOOM);

    const onScreenWidth = bounds.width * framing.zoom;
    expect(bareViewport.width - onScreenWidth).toBeCloseTo(
      FOLLOW_PADDING_PX * 2,
      6,
    );
  });
});

describe("framedSubset", () => {
  it("keeps every active node when they fit together", () => {
    const rects = [node(0), node(600), node(1200)];
    expect(framedSubset(rects, viewport)).toEqual(rects);
  });

  it("keeps a companion branch that only fits once zoomed out", () => {
    // 0..2680 wide needs ~0.53 — under the ceiling but still above the floor.
    const rects = [node(0), node(2400)];
    expect(framedSubset(rects, viewport)).toEqual(rects);
  });

  it("abandons a straggler rather than framing the gap around it", () => {
    const newest = node(0);
    const straggler = node(20000);
    expect(framedSubset([newest, straggler], viewport)).toEqual([newest]);
  });

  it("still frames the newest node when it alone overflows the floor", () => {
    const huge = node(0, 0, 40000, 20000);
    expect(framedSubset([huge], viewport)).toEqual([huge]);
  });

  it("prefers the newest node, whichever end of the graph it is on", () => {
    // Same pair, opposite arrival order: the survivor follows recency.
    const left = node(0);
    const right = node(20000);
    expect(framedSubset([right, left], viewport)).toEqual([right]);
    expect(framedSubset([left, right], viewport)).toEqual([left]);
  });

  it("has nothing to frame for an empty active set", () => {
    expect(framedSubset([], viewport)).toEqual([]);
  });
});

describe("zoomFor", () => {
  const lone = boundsOf([node(500, 300)])!;

  it("picks the best zoom when it has no view to respect", () => {
    expect(zoomFor(lone, viewport, null)).toBe(FOLLOW_MAX_ZOOM);
  });

  it("keeps a readable zoom the set already fits inside", () => {
    // The whole point: a re-run from a working viewport must not rescale it.
    expect(zoomFor(lone, viewport, 0.72)).toBe(0.72);
  });

  it("overrides a zoom too far out to read", () => {
    // Fit-view on a big graph — the view this feature exists to escape.
    expect(zoomFor(lone, viewport, 0.08)).toBe(FOLLOW_MAX_ZOOM);
  });

  it("pulls back when the set no longer fits at the current zoom", () => {
    const spread = boundsOf([node(0), node(2400)])!;
    const zoom = zoomFor(spread, viewport, 1.0);
    expect(zoom).toBeLessThan(1.0);
    expect(zoom).toBeCloseTo(fitZoomFor(spread, viewport), 6);
  });

  it("respects a zoom the user chose past the ceiling", () => {
    // Above the band the camera would pick for itself, but they can read it and
    // the action fits, so there is nothing to correct.
    expect(zoomFor(lone, viewport, 1.8)).toBe(1.8);
  });

  it("treats the readable threshold as the dividing line", () => {
    expect(zoomFor(lone, viewport, READABLE_ZOOM)).toBe(READABLE_ZOOM);
    expect(zoomFor(lone, viewport, READABLE_ZOOM - 0.01)).toBe(FOLLOW_MAX_ZOOM);
  });
});

describe("needsMove", () => {
  const bounds = boundsOf([node(500, 300)])!;
  const target = framingFor(bounds, viewport);
  const settled = viewportShowing(target, viewport);

  /** The widest drift the deadzone tolerates for `bounds` on this canvas. */
  const slackX = (viewport.width * FOLLOW_DEADZONE - bounds.width) / 2;

  it("holds still once the action is centred", () => {
    expect(needsMove(bounds, target, settled, viewport)).toBe(false);
  });

  it("ignores drift that stays inside the deadzone", () => {
    const nudged: Viewport = { ...settled, x: settled.x - (slackX - 20) };
    expect(needsMove(bounds, target, nudged, viewport)).toBe(false);
  });

  it("follows the action once it leaves the deadzone", () => {
    const escaped: Viewport = { ...settled, x: settled.x - (slackX + 20) };
    expect(needsMove(bounds, target, escaped, viewport)).toBe(true);
  });

  it("follows a vertical escape too", () => {
    const usableHeight =
      viewport.height - viewport.insetTop - viewport.insetBottom;
    const slackY = (usableHeight * FOLLOW_DEADZONE - bounds.height) / 2;
    const escaped: Viewport = { ...settled, y: settled.y - (slackY + 20) };
    expect(needsMove(bounds, target, escaped, viewport)).toBe(true);
  });

  it("always takes a move that changes zoom", () => {
    const zoomed: Viewport = { ...settled, zoom: settled.zoom * 0.5 };
    expect(needsMove(bounds, target, zoomed, viewport)).toBe(true);
  });

  it("only asks a set too big for the deadzone to stay on screen", () => {
    // Wider than the deadzone, so centring it is impossible to insist on; what
    // matters is that none of it has fallen off the edge.
    const wide = node(0, 300, 1200, 120);
    const wideTarget = framingFor(wide, viewport);
    const showing = viewportShowing(wideTarget, viewport);

    const onScreen: Viewport = { ...showing, x: showing.x - 150 };
    const hangingOff: Viewport = { ...showing, x: showing.x - 250 };

    expect(needsMove(wide, wideTarget, onScreen, viewport)).toBe(false);
    expect(needsMove(wide, wideTarget, hangingOff, viewport)).toBe(true);
  });
});

describe("moveDurationMs", () => {
  const bounds = boundsOf([node(500, 300)])!;
  const target = framingFor(bounds, viewport);
  const settled = viewportShowing(target, viewport);

  it("cuts instead of glides under reduced motion", () => {
    const far: Viewport = { ...settled, zoom: 0.08 };
    expect(moveDurationMs(target, far, viewport, true)).toBe(0);
  });

  it("spends a second on a doubling of scale", () => {
    const halfway = viewportShowing({ ...target, zoom: 0.5 }, viewport);
    expect(moveDurationMs(target, halfway, viewport, false)).toBe(
      ZOOM_OCTAVE_MS,
    );
  });

  it("caps the establishing dolly rather than crawling in", () => {
    // 0.08 to 1.0 is over three-and-a-half octaves; taken literally that would
    // be a move nobody waits out.
    const overview = viewportShowing({ ...target, zoom: 0.08 }, viewport);
    expect(moveDurationMs(target, overview, viewport, false)).toBe(MAX_MOVE_MS);
  });

  it("scales a pan with how far it actually travels", () => {
    const near = viewportShowing(
      { ...target, x: target.x - 1000 / target.zoom },
      viewport,
    );
    const far = viewportShowing(
      { ...target, x: target.x - 2000 / target.zoom },
      viewport,
    );

    const nearMs = moveDurationMs(target, near, viewport, false);
    const farMs = moveDurationMs(target, far, viewport, false);

    expect(nearMs).toBeGreaterThan(MIN_MOVE_MS);
    expect(farMs).toBeLessThan(MAX_MOVE_MS);
    expect(farMs / nearMs).toBeCloseTo(2, 1);

    const diagonal = Math.hypot(viewport.width, viewport.height);
    expect(nearMs).toBe(Math.round((1000 / diagonal) * PAN_SCREEN_MS));
  });

  it("refuses to shorten a small correction into a twitch", () => {
    const nudged: Viewport = { ...settled, x: settled.x - 30 };
    expect(moveDurationMs(target, nudged, viewport, false)).toBe(MIN_MOVE_MS);
  });
});
