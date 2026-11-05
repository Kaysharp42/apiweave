import type { Viewport } from "@xyflow/react";
import type { OpeningViewportInput } from "../types";

/**
 * The lowest zoom the canvas may open at, and the highest.
 *
 * Fitting a long left-to-right chain into a normal window lands around 0.05,
 * where every node is a few pixels of dotted line. Opening below 0.8 is
 * therefore not a view of the graph — the user has to zoom in before they can
 * read anything, and the first thing they see is a blank-looking canvas. Opening
 * at 0.8 shows the start of the workflow at a readable size and lets them pan;
 * the fit-view control still gives the full overview when they ask for it.
 */
export const OPENING_MIN_ZOOM = 0.8;
export const OPENING_MAX_ZOOM = 1;

/** Default clearance on every side, in screen pixels. */
export const OPENING_VIEW_PADDING = 48;

/**
 * The viewport a workflow opens at.
 *
 * `fitView` alone answers "how do I see everything", which on a long graph is
 * "from very far away". This answers the question the canvas actually has on
 * open — "where does this workflow start" — while still showing as much as it
 * can at a readable zoom:
 *
 * - the zoom is the fit zoom, clamped to `[OPENING_MIN_ZOOM, OPENING_MAX_ZOOM]`,
 *   so a small graph is never blown up past 1 and a large one is never shrunk
 *   below readability;
 * - each axis is decided on its own. If the graph fits on that axis at this
 *   zoom (including `padding`), it is centred, because there is nothing to
 *   scroll to. If it does not, its start edge — left for x, top for y — is
 *   placed at `padding`, so a long chain opens at its beginning and runs off the
 *   right edge rather than being squeezed to fit.
 *
 * An empty or unmeasured graph has no start edge to align to, so the identity
 * viewport is returned.
 */
export function openingViewport({
  bounds,
  container,
  padding,
}: OpeningViewportInput): Viewport {
  const { width, height } = container;
  if (width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0, zoom: 1 };

  const fitZoom = Math.min(
    width / (bounds.width + padding * 2),
    height / (bounds.height + padding * 2),
  );
  const zoom = Math.min(
    OPENING_MAX_ZOOM,
    Math.max(OPENING_MIN_ZOOM, fitZoom),
  );

  return {
    x: axisOffset(bounds.x, bounds.width, width, zoom, padding),
    y: axisOffset(bounds.y, bounds.height, height, zoom, padding),
    zoom,
  };
}

/**
 * Where one axis starts: centred when the scaled graph plus padding fits,
 * otherwise pinned to its start edge.
 */
function axisOffset(
  boundsStart: number,
  boundsSize: number,
  containerSize: number,
  zoom: number,
  padding: number,
): number {
  const scaled = boundsSize * zoom;
  const centred = (containerSize - scaled) / 2;
  return scaled + padding * 2 <= containerSize
    ? centred - boundsStart * zoom
    : padding - boundsStart * zoom;
}
