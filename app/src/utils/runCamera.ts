import type { Viewport } from "reactflow";
import type { AttentionPoint } from "../types/AttentionPoint";
import type { CameraFocus } from "../types/CameraFocus";
import type { CameraFraming } from "../types/CameraFraming";
import type { CameraMotion } from "../types/CameraMotion";
import type { CameraViewport } from "../types/CameraViewport";

/**
 * The camera that follows a run: a physical model, integrated per frame.
 *
 * Everything here is pure. `useRunCamera` owns the clock, the event stream and
 * the ReactFlow instance; this owns the motion, which is the part that has to be
 * right and the part worth testing.
 *
 * The previous camera decided each move separately — pick a target, animate to
 * it, rest, repeat — and on a large workflow that produced roughly one zoom
 * round trip every two and a half seconds and pans that crossed the whole graph.
 * Three things were wrong with the model, and all three are structural rather
 * than a matter of tuning:
 *
 *  1. **Its aim was a bounding box.** A box is defined by its two most extreme
 *     members, so a node arriving or finishing redefined it in a single frame,
 *     and a box around two distant branches centres on the empty space between
 *     them. Here the aim is an *attention-weighted mean* (`attentionFocus`): it
 *     moves only as fast as the weights decay, and it never points at a gap.
 *  2. **Its zoom could oscillate.** Zoom was re-derived per move from whatever
 *     was lit, and — worse — the floor it was allowed to choose sat *below* the
 *     threshold at which it considered a zoom readable, so the camera routinely
 *     picked a zoom it would reject on the next hop and bounced between the two.
 *     Here zoom is monotone within a run (`stepZoomTarget`): it steps outward,
 *     in quantised rungs, and never back. Cycling is not damped, it is
 *     unrepresentable.
 *  3. **Its motion was a sequence of animations.** Each was smooth alone, but
 *     consecutive ones fused into unbroken drift or fought each other, and a
 *     retarget mid-flight restarts from zero velocity — a visible stutter. Here
 *     there is one critically damped spring per axis, integrated continuously,
 *     so velocity is continuous *through* a change of target and the camera
 *     always eases to a stop instead of arriving at one.
 *
 * What is left of the old model is the part that was right: stillness is the
 * default, the user always wins, and a pan is a glance while a zoom is the room
 * changing size.
 */

/**
 * Below this a node stops being readable — fit-view on a large workflow lands
 * near 0.08, which is the view this feature exists to escape.
 *
 * This is one constant doing two jobs on purpose: it is both the lowest zoom the
 * camera will choose for itself and the test for "the zoom you are already at is
 * fine". Those were two different numbers before (0.5 and 0.55), and the gap
 * between them was the oscillation: every zoom the camera chose in that band was
 * rejected as unreadable the next time it looked.
 */
export const MIN_READABLE_ZOOM = 0.45;

/** Where the camera zooms to when it has to choose for itself, because the view
 * it inherited was too far out to read. Not a ceiling: a viewport the user set
 * closer than this is kept as it is. */
export const COMFORT_ZOOM = 0.7;

/** Breathing room around the focus, in screen pixels so it looks the same at
 * every zoom. Roughly a third of a node — enough that the edges entering and
 * leaving are visible, which is most of why you are watching. */
export const FOLLOW_PADDING_PX = 96;

/**
 * How long it takes a finished node to lose half its claim on the camera.
 *
 * This is the number that makes the aim continuous. Nothing is dropped when it
 * finishes; its weight decays, so the focus slides off it over about a second
 * instead of jumping off it in one frame.
 */
export const ATTENTION_HALFLIFE_MS = 900;

/**
 * How far from the newest activity other activity still counts, as a fraction of
 * the viewport width.
 *
 * Attention is local because a viewer's is: two branches a screen and a half
 * apart cannot both be watched, and the honest answer is to watch one. This is
 * what stops a fan-out from being framed as the gap between its ends.
 */
export const ATTENTION_RADIUS_SCREENS = 0.75;

/** Past this, a finished node is forgotten outright — it has a millionth of the
 * weight of live work, and keeping it only costs arithmetic. */
export const ATTENTION_WINDOW_MS = 4000;

/**
 * How much of the focus's spread the zoom has to accommodate, in standard
 * deviations of the weighted distribution.
 *
 * A spread rather than an extent, so one straggler nudges the zoom instead of
 * dictating it. At 1.5σ a tight cluster is framed exactly and a lopsided one is
 * framed around its bulk, which is the behaviour a bounding box cannot express.
 */
export const EXTENT_SIGMAS = 1.5;

/**
 * The fraction of the free area the focus may roam in before the camera follows
 * it, and how close to its mark it must get before the camera lets go.
 *
 * The deadzone is what buys stillness: several nodes fit on screen at a readable
 * zoom, and while the run is walking between them the camera has no business
 * moving. It is deliberately most of the frame, because on a large workflow the
 * front of the run advances continuously — perfect stillness is not on offer, and
 * the real choice is between many small corrections and few large ones.
 *
 * The release is much tighter than the entry — a Schmitt trigger — because a
 * correction that stopped as soon as it had helped would chatter at the boundary
 * forever.
 */
export const DEADZONE = 0.72;
export const DEADZONE_RELEASE = 0.2;

/**
 * How far past the action the camera aims, as a fraction of the deadzone.
 *
 * A camera that recentres puts the action in the middle, which on a workflow
 * walking left to right means it is halfway back out of frame immediately. Aiming
 * *against* the direction it left in does two things at once: it shows the empty
 * canvas the run is heading into, which is the composition any operator would
 * choose, and it doubles the distance the run can cover before the camera owes
 * another move. Fewer, slower moves is the whole game.
 */
export const AIM_LEAD = 0.8;

/**
 * Spring stiffnesses, in radians per second. Both springs are critically damped,
 * so these set the pace without any possibility of overshoot or ringing.
 *
 * A critically damped spring covers most of its distance in about `1/omega` and
 * settles in roughly `6/omega`, so these are slow on purpose: a correction takes
 * a couple of seconds and spends most of that under a third of its peak speed.
 * Slow also means graceful degradation — when the run advances faster than the
 * camera settles, consecutive corrections merge into one steady tracking shot
 * instead of a series of lurches, because the spring carries its velocity across
 * the change of target.
 */
export const PAN_OMEGA = 2.6;
export const ZOOM_OMEGA = 3;

/** Speed limits, so no target — however far away — can make the camera whip.
 * Pan is measured in viewport diagonals per second and zoom in octaves per
 * second, both being what the eye actually judges rather than what the
 * coordinate system happens to use. */
export const MAX_PAN_SCREENS_PER_S = 0.42;
export const MAX_ZOOM_OCTAVES_PER_S = 2;

/**
 * Past this much travel the camera cuts instead of panning.
 *
 * Film grammar, and it holds here: you pan within a place and cut between
 * places. Sliding across a screen and a half of empty canvas conveys nothing
 * except that the canvas is being slid, costs a second of motion, and leaves
 * the viewer nothing to track on the way. A cut costs one frame and is followed
 * by stillness.
 */
export const CUT_SCREENS = 1.5;

/** Zoom changes land on rungs a third of an octave apart, and only after the
 * focus has failed to fit for this long. Quantising stops a slow drift in the
 * required zoom from becoming a slow drift in the actual zoom; the dwell stops
 * two branches briefly overlapping from committing the rest of the run to a
 * wider view. */
export const ZOOM_STEP_OCTAVES = 1 / 3;
export const ZOOM_OUT_DWELL_MS = 450;

/** How far short of fitting the focus has to fall before it counts as not
 * fitting. Padding is generous, so a few percent of overflow is invisible. */
export const ZOOM_OUT_SLACK = 1.08;

/** Longest frame the integrator will believe. A backgrounded tab produces gaps
 * of seconds; taken literally they become a lurch, and the springs are
 * unconditionally stable so the only cost of clamping is arriving late. */
export const MAX_FRAME_MS = 50;

/** Below these the camera is holding still: a few pixels a second is slower than
 * the eye can follow, and continuing to integrate it only burns frames. */
export const REST_SPEED_PX_PER_S = 4;
export const REST_ZOOM_OCTAVES_PER_S = 0.004;

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

/** Screen-space offset from the container's centre to the free area's centre:
 * positive when the toolbar covers more than the minimap does. */
function centreShiftPx(viewport: CameraViewport): number {
  return (viewport.insetTop - viewport.insetBottom) / 2;
}

/** The diagonal of the free area, which is the unit "one screen" is measured in
 * — a diagonal rather than a width so a tall move and a wide one of the same
 * apparent size are paced the same. */
export function screenDiagonalPx(viewport: CameraViewport): number {
  const usable = usableSize(viewport);
  return Math.max(1, Math.hypot(usable.width, usable.height));
}

/**
 * The zoom at which something of this size exactly fills the usable area,
 * padding included — before any clamping. Padding is subtracted in screen space
 * because that is where it is perceived; the ratio that remains is the scale.
 */
export function fitZoomFor(
  size: { width: number; height: number },
  viewport: CameraViewport,
): number {
  const usable = usableSize(viewport);
  const availableWidth = Math.max(1, usable.width - FOLLOW_PADDING_PX * 2);
  const availableHeight = Math.max(1, usable.height - FOLLOW_PADDING_PX * 2);

  return Math.min(
    availableWidth / Math.max(1, size.width),
    availableHeight / Math.max(1, size.height),
  );
}

/** How far from the newest activity other activity still counts, in flow units.
 * Screen-relative, so zooming out genuinely widens what the camera is willing to
 * treat as one scene. */
export function attentionRadius(
  viewport: CameraViewport,
  zoom: number,
): number {
  return (
    (ATTENTION_RADIUS_SCREENS * usableSize(viewport).width) /
    Math.max(zoom, 1e-6)
  );
}

/**
 * Where the run's attention is, as a weighted mean over what the camera has
 * been shown.
 *
 * Two weights multiply:
 *
 * - **age**, halving every `ATTENTION_HALFLIFE_MS`, except that anything still
 *   running counts as brand new however long it has been working. So a slow node
 *   holds the camera and a finished one releases it gradually.
 * - **distance from the newest activity**, a Gaussian at `radius`. Measured from
 *   the newest point rather than from the camera, which is the difference between
 *   "what else is part of this scene" and "what else is nearby" — only the former
 *   is a reason to widen the shot, and only the former refuses to aim at the gap
 *   between two distant branches.
 *
 * `points` must arrive newest-first; `points[0]` is the anchor and is always
 * part of the answer. The returned size is a spread, not an extent: see
 * `EXTENT_SIGMAS`.
 */
export function attentionFocus(
  points: readonly AttentionPoint[],
  now: number,
  radius: number,
): CameraFocus | null {
  const anchor = points[0];
  if (!anchor) return null;

  const anchorX = anchor.x + anchor.width / 2;
  const anchorY = anchor.y + anchor.height / 2;
  const spread = Math.max(1, radius * radius);

  const weighted: { x: number; y: number; weight: number }[] = [];
  let total = 0;
  let sumX = 0;
  let sumY = 0;
  let sumHalfWidth = 0;
  let sumHalfHeight = 0;

  for (const point of points) {
    const centreX = point.x + point.width / 2;
    const centreY = point.y + point.height / 2;
    const age = point.running ? 0 : Math.max(0, now - point.since);
    const byAge = Math.pow(2, -age / ATTENTION_HALFLIFE_MS);
    const away =
      (centreX - anchorX) * (centreX - anchorX) +
      (centreY - anchorY) * (centreY - anchorY);
    const weight = byAge * Math.exp(-away / spread);

    weighted.push({ x: centreX, y: centreY, weight });
    total += weight;
    sumX += weight * centreX;
    sumY += weight * centreY;
    sumHalfWidth += (weight * point.width) / 2;
    sumHalfHeight += (weight * point.height) / 2;
  }

  // Everything underflowed: the anchor is old and the rest are older, so it is
  // the only thing left to say.
  if (total <= 0) {
    return {
      x: anchorX,
      y: anchorY,
      width: anchor.width,
      height: anchor.height,
    };
  }

  const x = sumX / total;
  const y = sumY / total;

  let varianceX = 0;
  let varianceY = 0;
  for (const entry of weighted) {
    varianceX += entry.weight * (entry.x - x) * (entry.x - x);
    varianceY += entry.weight * (entry.y - y) * (entry.y - y);
  }

  return {
    x,
    y,
    width:
      2 * (Math.sqrt(varianceX / total) * EXTENT_SIGMAS + sumHalfWidth / total),
    height:
      2 *
      (Math.sqrt(varianceY / total) * EXTENT_SIGMAS + sumHalfHeight / total),
  };
}

/** The camera position that centres `focus` in the free area at `zoom`. A point
 * sent to the container's centre appears `centreShiftPx` above where it is
 * wanted, so the target is moved back by that much in flow units. */
export function framingFor(
  focus: CameraFocus,
  viewport: CameraViewport,
  zoom: number,
): CameraFraming {
  return {
    x: focus.x,
    y: focus.y - centreShiftPx(viewport) / Math.max(zoom, 1e-6),
    zoom,
  };
}

/** ReactFlow's `Viewport` is a transform; the camera thinks in centres. */
export function centreOf(
  transform: Viewport,
  viewport: CameraViewport,
): CameraFraming {
  const zoom = Math.max(transform.zoom, 1e-6);
  return {
    x: (viewport.width / 2 - transform.x) / zoom,
    y: (viewport.height / 2 - transform.y) / zoom,
    zoom,
  };
}

/** …and back, for handing one to `setViewport`. */
export function transformOf(
  framing: CameraFraming,
  viewport: CameraViewport,
): Viewport {
  return {
    x: viewport.width / 2 - framing.x * framing.zoom,
    y: viewport.height / 2 - framing.y * framing.zoom,
    zoom: framing.zoom,
  };
}

/**
 * The camera's opening state, adopted from the viewport it inherited.
 *
 * A zoom that can be read is kept, whoever chose it and wherever it sits — that
 * single decision is what makes a re-run cost no zoom at all. Only a view too far
 * out to read is overridden, and then it goes to one comfortable value rather
 * than to whatever the first node happens to imply.
 */
export function adoptCamera(
  transform: Viewport,
  viewport: CameraViewport,
  engaged: boolean,
): CameraMotion {
  const centre = centreOf(transform, viewport);
  return {
    x: centre.x,
    y: centre.y,
    zoom: centre.zoom,
    vx: 0,
    vy: 0,
    vZoom: 0,
    engaged,
    zoomTarget: centre.zoom >= MIN_READABLE_ZOOM ? centre.zoom : COMFORT_ZOOM,
    crampedMs: 0,
    aimBiasX: 0,
    aimBiasY: 0,
  };
}

/**
 * One step of an exactly solved critically damped spring.
 *
 * Exact rather than integrated numerically because it then cannot overshoot, cannot
 * ring and cannot go unstable at any frame length, which is what allows a
 * dropped frame to cost lateness instead of a visible jolt. Carrying `velocity`
 * across the step is the point: it is what makes the motion continuous when the
 * target moves mid-flight, where a fresh animation would restart from rest.
 */
export function criticallyDamped(
  position: number,
  velocity: number,
  target: number,
  omega: number,
  dtSeconds: number,
): { position: number; velocity: number } {
  if (dtSeconds <= 0) return { position, velocity };

  const offset = position - target;
  const decay = Math.exp(-omega * dtSeconds);
  // u(t) = (u0 + (v0 + w u0) t) e^-wt is the critically damped solution;
  // u'(t) follows from it directly.
  const slope = velocity + omega * offset;

  return {
    position: target + (offset + slope * dtSeconds) * decay,
    velocity: (velocity - omega * slope * dtSeconds) * decay,
  };
}

/**
 * The next zoom rung outward, or the current zoom if it still works.
 *
 * Only ever outward, and only in whole rungs. Monotonicity is the guarantee that
 * matters: a run can zoom out at most a handful of times and can never zoom back
 * in, so the round trips that made the old camera unwatchable cannot occur, and
 * the cost is that a workflow which fans out wide once stays framed wide — which
 * for a wide workflow is the right answer anyway.
 */
export function stepZoomTarget(current: number, required: number): number {
  if (required * ZOOM_OUT_SLACK >= current) return current;

  const octaves = Math.log2(current / required);
  const rungs = Math.ceil(octaves / ZOOM_STEP_OCTAVES);

  return Math.max(
    MIN_READABLE_ZOOM,
    current * Math.pow(2, -rungs * ZOOM_STEP_OCTAVES),
  );
}

/**
 * How far the focus's centre may sit from the frame's centre before the camera
 * owes it a move.
 *
 * The smaller of "the deadzone" and "the room left before it clips", so a focus
 * that nearly fills the screen is held centred while a small one roams.
 */
function deadzoneHalfPx(usablePx: number, contentPx: number): number {
  const beforeClipping = Math.max(0, (usablePx - contentPx) / 2);
  return Math.min(beforeClipping, (usablePx * DEADZONE) / 2);
}

/** One frame of camera. Pure: the same state and input always produce the same
 * next state, which is what makes a whole run replayable in a test. */
export function stepCamera(
  motion: CameraMotion,
  focus: CameraFocus | null,
  viewport: CameraViewport,
  dtMs: number,
  reducedMotion: boolean,
): CameraMotion {
  const stepMs = Math.min(MAX_FRAME_MS, Math.max(0, dtMs));
  const dt = stepMs / 1000;

  // The zoom it wants, which it may only lower, and only after the focus has
  // genuinely failed to fit for a while.
  let zoomTarget = motion.zoomTarget;
  let crampedMs = motion.crampedMs;
  if (focus) {
    const required = fitZoomFor(focus, viewport);
    if (required * ZOOM_OUT_SLACK < zoomTarget) {
      crampedMs += stepMs;
      if (crampedMs >= ZOOM_OUT_DWELL_MS) {
        zoomTarget = stepZoomTarget(zoomTarget, required);
        crampedMs = 0;
      }
    } else {
      crampedMs = 0;
    }
  }

  // Whether it is correcting, and if so where to. Latched, so a correction runs
  // to completion rather than stopping the instant it has done enough.
  const usable = usableSize(viewport);
  let engaged = motion.engaged;
  let aimBiasX = motion.aimBiasX;
  let aimBiasY = motion.aimBiasY;

  if (focus) {
    const offX = (focus.x - motion.x) * motion.zoom;
    const offY = (focus.y - motion.y) * motion.zoom - centreShiftPx(viewport);
    const dzX = deadzoneHalfPx(usable.width, focus.width * motion.zoom);
    const dzY = deadzoneHalfPx(usable.height, focus.height * motion.zoom);
    const outX = Math.abs(offX) > dzX;
    const outY = Math.abs(offY) > dzY;

    if (outX || outY) {
      // A fresh correction picks its mark: past the action on whichever axis
      // lost it, and dead centre on the axis that is still fine, so following
      // sideways does not also shove the picture up and down.
      if (!engaged) {
        aimBiasX = outX ? -Math.sign(offX) * AIM_LEAD * dzX : 0;
        aimBiasY = outY ? -Math.sign(offY) * AIM_LEAD * dzY : 0;
      }
      engaged = true;
    } else if (
      engaged &&
      Math.abs(offX - aimBiasX) <= dzX * DEADZONE_RELEASE &&
      Math.abs(offY - aimBiasY) <= dzY * DEADZONE_RELEASE
    ) {
      engaged = false;
      aimBiasX = 0;
      aimBiasY = 0;
    }
  } else {
    engaged = false;
    aimBiasX = 0;
    aimBiasY = 0;
  }

  // Not correcting means aiming at where it already is, which is not the same as
  // freezing: the spring keeps its momentum and eases the last of it away.
  const centred = focus ? framingFor(focus, viewport, zoomTarget) : null;
  const aim =
    centred && engaged
      ? {
          x: centred.x - aimBiasX / zoomTarget,
          y: centred.y - aimBiasY / zoomTarget,
        }
      : { x: motion.x, y: motion.y };

  const screen = screenDiagonalPx(viewport);
  // Measured to the action rather than to the mark, so how far the lead happens
  // to reach past it cannot be what decides between a pan and a cut.
  const travelPx = centred
    ? Math.hypot(centred.x - motion.x, centred.y - motion.y) * motion.zoom
    : 0;

  // Too far to pan, or motion is not wanted at all: arrive, and be still.
  if (reducedMotion || (engaged && travelPx > CUT_SCREENS * screen)) {
    return {
      x: aim.x,
      y: aim.y,
      zoom: zoomTarget,
      vx: 0,
      vy: 0,
      vZoom: 0,
      engaged: false,
      zoomTarget,
      crampedMs,
      aimBiasX: 0,
      aimBiasY: 0,
    };
  }

  const nextX = criticallyDamped(motion.x, motion.vx, aim.x, PAN_OMEGA, dt);
  const nextY = criticallyDamped(motion.y, motion.vy, aim.y, PAN_OMEGA, dt);

  // Pan speed is capped in screen terms, so the limit means the same thing at
  // every zoom; the step and the velocity are scaled together so the spring
  // stays consistent with itself on the frame after.
  let x = nextX.position;
  let y = nextY.position;
  let vx = nextX.velocity;
  let vy = nextY.velocity;
  const maxSpeed =
    (MAX_PAN_SCREENS_PER_S * screen) / Math.max(motion.zoom, 1e-6);
  const stepped = Math.hypot(x - motion.x, y - motion.y);
  if (stepped > maxSpeed * dt && stepped > 0) {
    const scale = (maxSpeed * dt) / stepped;
    x = motion.x + (x - motion.x) * scale;
    y = motion.y + (y - motion.y) * scale;
    const speed = Math.hypot(vx, vy);
    if (speed > maxSpeed) {
      vx = (vx * maxSpeed) / speed;
      vy = (vy * maxSpeed) / speed;
    }
  }

  // Zoom travels in octaves, which is the scale the eye judges it on: halving
  // and doubling are the same size of change.
  const octaves = Math.log2(Math.max(motion.zoom, 1e-6));
  const nextZoom = criticallyDamped(
    octaves,
    motion.vZoom,
    Math.log2(zoomTarget),
    ZOOM_OMEGA,
    dt,
  );
  let zoomOctaves = nextZoom.position;
  let vZoom = nextZoom.velocity;
  const maxOctaves = MAX_ZOOM_OCTAVES_PER_S * dt;
  if (Math.abs(zoomOctaves - octaves) > maxOctaves) {
    zoomOctaves = octaves + Math.sign(zoomOctaves - octaves) * maxOctaves;
    vZoom =
      Math.sign(vZoom) * Math.min(Math.abs(vZoom), MAX_ZOOM_OCTAVES_PER_S);
  }

  return {
    x,
    y,
    zoom: Math.pow(2, zoomOctaves),
    vx,
    vy,
    vZoom,
    engaged,
    zoomTarget,
    crampedMs,
    aimBiasX,
    aimBiasY,
  };
}

/** Nothing is moving and nothing is owed: the caller can stop asking for frames
 * until something happens. */
export function isAtRest(motion: CameraMotion): boolean {
  if (motion.engaged) return false;
  if (Math.hypot(motion.vx, motion.vy) * motion.zoom > REST_SPEED_PX_PER_S) {
    return false;
  }
  if (Math.abs(motion.vZoom) > REST_ZOOM_OCTAVES_PER_S) return false;

  return (
    Math.abs(Math.log2(motion.zoom / motion.zoomTarget)) <=
    REST_ZOOM_OCTAVES_PER_S
  );
}
