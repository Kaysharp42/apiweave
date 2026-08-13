import type { Rect, Viewport } from "reactflow";
import type { CameraFraming } from "../types/CameraFraming";
import type { CameraViewport } from "../types/CameraViewport";

/**
 * The arithmetic behind "the camera follows the run".
 *
 * Everything here is pure and screen-space-aware but React-free: it turns a set
 * of rectangles (the nodes that are lit up right now, newest first) plus the
 * size of the canvas into a `setCenter` argument list. `useRunCamera` owns the
 * clock, the active set and the ReactFlow instance; this owns only the geometry,
 * which is the part worth having tests for.
 *
 * The governing rule is that stillness is the default. A camera that is
 * technically always correct — recentred on every hop, rezoomed to fit whatever
 * is lit — is in continuous motion for the whole run, and continuous motion is
 * what makes this unwatchable. So the camera holds unless the run has actually
 * left the frame, and it holds its zoom hardest of all: a pan is a glance, a
 * zoom is the room changing size.
 */

/**
 * The zoom band the camera will choose for itself.
 *
 * The floor is the point below which a node stops being readable — fit-view on
 * a 130-node workflow lands around 0.08, which is what the feature exists to
 * escape. The ceiling stops a single small node from filling the screen, which
 * reads as a zoom bug rather than as focus.
 */
export const FOLLOW_MIN_ZOOM = 0.5;
export const FOLLOW_MAX_ZOOM = 1.0;

/**
 * At or above this the nodes can be read, so the zoom the user is already at is
 * good enough and the camera will not touch it.
 *
 * This is what stops a re-run from being a zoom cycle. The first run from a
 * far-out overview earns its establishing dolly; every run after it starts from
 * a viewport that already works, and the camera should pan within it rather
 * than blowing it up to its own preferred scale and back again.
 */
export const READABLE_ZOOM = 0.55;

/**
 * The fraction of the free area the action may roam inside before the camera
 * follows it.
 *
 * Without a deadzone every node hop is a pan, because "the target moved by one
 * node width" is always true. With one, the several nodes that fit on screen at
 * a readable zoom are simply watched, and the camera moves when the run walks
 * off the edge — a few times per run instead of once per node.
 */
export const FOLLOW_DEADZONE = 0.6;

/** Breathing room around the framed set, in screen pixels so it looks the same
 * at every zoom. Roughly a third of a node — enough that the edges entering and
 * leaving the active node are visible, which is most of why you are watching. */
export const FOLLOW_PADDING_PX = 96;

/**
 * Pacing, expressed per unit of distance travelled rather than per kind of move.
 *
 * A move's duration should come from how far it goes, which makes the opening
 * dolly long and a nudge short without anyone having to label them. The zoom
 * rate is the one that matters: a doubling of scale is about the most the eye
 * takes comfortably in a second, and the old camera was doing a full doubling
 * in 400ms — twice, per run.
 */
export const ZOOM_OCTAVE_MS = 900;
export const PAN_SCREEN_MS = 700;

/** Below this a move stops reading as a move and starts reading as a twitch. */
export const MIN_MOVE_MS = 260;

/** …and past this it stops reading as a camera and starts reading as a wait. */
export const MAX_MOVE_MS = 1400;

/** Enforced stillness after every move, so consecutive hops cannot fuse into
 * one unbroken drift. The pause is what makes the motion legible as motion. */
export const REST_AFTER_MOVE_MS = 240;

/**
 * How long retargets are collected before one move is issued.
 *
 * `drain` releases a whole batch of paced events synchronously, so a fan-out
 * lighting up three branches arrives as three calls in one tick. Without this
 * the camera would issue three `setCenter`s, each cancelling the last, and the
 * final one would be framed on an active set that was already stale.
 */
export const RETARGET_COALESCE_MS = 90;

/** Zoom drifts by rounding alone, so equality needs a tolerance. */
export const NO_OP_MOVE_ZOOM = 0.01;

/** Smallest rectangle containing every input; `null` for an empty set, which
 * the callers treat as "nothing to look at, hold still". */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The part of the canvas that is actually free to hold content. */
function usableSize(viewport: CameraViewport): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(1, viewport.width),
    height: Math.max(
      1,
      viewport.height - viewport.insetTop - viewport.insetBottom,
    ),
  };
}

/**
 * The zoom at which `bounds` exactly fills the usable area, padding included —
 * before any clamping. Padding is subtracted in screen space because that is
 * where it is perceived; the ratio that remains is the scale.
 */
export function fitZoomFor(bounds: Rect, viewport: CameraViewport): number {
  const usable = usableSize(viewport);
  const availableWidth = Math.max(1, usable.width - FOLLOW_PADDING_PX * 2);
  const availableHeight = Math.max(1, usable.height - FOLLOW_PADDING_PX * 2);

  return Math.min(
    availableWidth / Math.max(1, bounds.width),
    availableHeight / Math.max(1, bounds.height),
  );
}

/**
 * Which of the lit-up nodes the camera will actually frame.
 *
 * "Frame everything that is running" is the rule, and for an ordinary fan-out
 * it selects the whole set. It stops being a useful rule when one slow branch
 * sits running while another walks a long way across the graph: the bounding
 * box then spans the gap, and at the zoom floor the viewport is mostly the
 * empty space between them — the camera would be technically correct and show
 * nothing.
 *
 * So the set is grown newest-first and stops at the last rectangle that still
 * fits at the floor. The freshest action is always on screen, companions join it
 * whenever they can, and it is the stragglers the camera gives up on rather than
 * legibility. `rects` must arrive most-recently-activated first; the first one is
 * kept unconditionally, even if it alone is too big to fit.
 */
export function framedSubset(
  rects: readonly Rect[],
  viewport: CameraViewport,
): Rect[] {
  const kept: Rect[] = [];

  for (const rect of rects) {
    if (kept.length === 0) {
      kept.push(rect);
      continue;
    }

    const candidate = boundsOf([...kept, rect]);
    if (candidate && fitZoomFor(candidate, viewport) >= FOLLOW_MIN_ZOOM) {
      kept.push(rect);
    }
  }

  return kept;
}

/**
 * The zoom to end this move at.
 *
 * `currentZoom` is where the viewport is now, or `null` for "no opinion, pick
 * the best one". The bias is heavily towards leaving it alone: a zoom that can
 * be read and that the framed set fits inside is a zoom worth keeping, whoever
 * chose it. Only an unreadably far-out view, or a set too big for the current
 * scale, earns a change.
 */
export function zoomFor(
  bounds: Rect,
  viewport: CameraViewport,
  currentZoom: number | null,
): number {
  const fitZoom = fitZoomFor(bounds, viewport);
  const preferred = Math.min(
    FOLLOW_MAX_ZOOM,
    Math.max(FOLLOW_MIN_ZOOM, fitZoom),
  );

  if (currentZoom === null) return preferred;

  const readable = currentZoom >= READABLE_ZOOM;
  const setFits = fitZoom >= currentZoom;

  return readable && setFits ? currentZoom : preferred;
}

/**
 * Turn a rectangle into a camera target.
 *
 * The centre is the rectangle's centre, pushed by half the chrome imbalance:
 * `setCenter` aims at the middle of the whole container, and the middle of the
 * *free* area is lower than that whenever the toolbar covers more than the
 * minimap does. When the camera does move it moves all the way to centre, so
 * that the hops which follow land inside the deadzone and cost nothing.
 */
export function framingFor(
  bounds: Rect,
  viewport: CameraViewport,
  currentZoom: number | null = null,
): CameraFraming {
  const zoom = zoomFor(bounds, viewport, currentZoom);

  // Screen-space offset from the container's centre to the free area's centre.
  const centreShiftPx = (viewport.insetTop - viewport.insetBottom) / 2;

  return {
    x: bounds.x + bounds.width / 2,
    // A point sent to the container centre appears `centreShiftPx` above where
    // it is wanted, so the target is moved back by that much in flow units.
    y: bounds.y + bounds.height / 2 - centreShiftPx / zoom,
    zoom,
  };
}

/** How far the content's centre may sit from the frame's centre before the
 * camera owes it a move. Content small enough to live inside the deadzone roams
 * there freely; content bigger than that has only to stay on screen. */
function allowedDriftPx(
  contentPx: number,
  usablePx: number,
  deadzonePx: number,
): number {
  if (contentPx <= deadzonePx) return (deadzonePx - contentPx) / 2;
  return Math.max(0, (usablePx - contentPx) / 2);
}

/**
 * True when the run has left the part of the frame the camera is willing to
 * ignore, or when the zoom has to change.
 *
 * ReactFlow's `Viewport` is a transform, so where the content currently appears
 * has to be derived: screen = flow * zoom + translate.
 */
export function needsMove(
  bounds: Rect,
  target: CameraFraming,
  current: Viewport,
  viewport: CameraViewport,
): boolean {
  if (Math.abs(target.zoom - current.zoom) > NO_OP_MOVE_ZOOM) return true;

  const usable = usableSize(viewport);

  // Centre of the area not covered by the toolbar or the minimap, in screen px.
  const frameCentreX = viewport.width / 2;
  const frameCentreY = viewport.insetTop + usable.height / 2;

  const contentCentreX =
    (bounds.x + bounds.width / 2) * current.zoom + current.x;
  const contentCentreY =
    (bounds.y + bounds.height / 2) * current.zoom + current.y;

  const allowedX = allowedDriftPx(
    bounds.width * current.zoom,
    usable.width,
    usable.width * FOLLOW_DEADZONE,
  );
  const allowedY = allowedDriftPx(
    bounds.height * current.zoom,
    usable.height,
    usable.height * FOLLOW_DEADZONE,
  );

  return (
    Math.abs(contentCentreX - frameCentreX) > allowedX ||
    Math.abs(contentCentreY - frameCentreY) > allowedY
  );
}

/**
 * How long this move gets, from how far it actually travels.
 *
 * Zoom and pan are costed separately and the slower of the two wins, because a
 * move that changes scale a lot needs time for the scale even if it barely
 * translates. Reduced motion gets 0, which is a cut rather than a glide: the
 * point of the camera is to put the action in front of you, and that survives
 * losing the animation, whereas refusing to move at all would just hide the run.
 */
export function moveDurationMs(
  target: CameraFraming,
  current: Viewport,
  viewport: CameraViewport,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 0;

  const fromZoom = Math.max(current.zoom, 1e-6);
  const toZoom = Math.max(target.zoom, 1e-6);
  const octaves = Math.abs(Math.log2(toZoom / fromZoom));

  const currentCentreX = (viewport.width / 2 - current.x) / current.zoom;
  const currentCentreY = (viewport.height / 2 - current.y) / current.zoom;
  // Measured at the zoom it arrives at, which is the scale the eye sees it in.
  const travelPx = Math.hypot(
    (target.x - currentCentreX) * target.zoom,
    (target.y - currentCentreY) * target.zoom,
  );
  const screens =
    travelPx / Math.max(1, Math.hypot(viewport.width, viewport.height));

  return Math.round(
    Math.min(
      MAX_MOVE_MS,
      Math.max(
        MIN_MOVE_MS,
        Math.max(octaves * ZOOM_OCTAVE_MS, screens * PAN_SCREEN_MS),
      ),
    ),
  );
}
