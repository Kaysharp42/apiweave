import type { Viewport } from "@xyflow/react";
import type { AttentionPoint } from "../types/AttentionPoint";
import type { CameraFocus } from "../types/CameraFocus";
import type { CameraFraming } from "../types/CameraFraming";
import type { CameraMotion } from "../types/CameraMotion";
import type { CameraViewport } from "../types/CameraViewport";

/**
 * The camera that follows a run: a physical model, integrated per frame.
 *
 * Everything here is pure. `useRunCamera` owns the clock, the event stream and
 * the ReactFlow instance, and `runFronts` decides *which branch* is being
 * watched; this owns the motion, which is the part that has to be right and the
 * part worth testing.
 *
 * Two earlier models failed here, and the lessons from both are load-bearing:
 *
 *  1. **The aim must not be able to teleport.** A bounding box is defined by its
 *     two most extreme members, so a node arriving or finishing redefines it in a
 *     single frame. An average over everything lit is worse on a workflow with
 *     concurrent branches: any locality rule re-picks a winner each time a
 *     different branch reports, which measured out as 2.8 hard cuts per second
 *     for a whole minute. So the subject is *one branch* — chosen in `runFronts`,
 *     held for as long as it has something to show — and within it the aim is an
 *     attention-weighted mean that moves only as fast as its weights decay.
 *  2. **Zoom must not be able to cycle.** Zoom used to be re-derived per move,
 *     and the floor it could choose sat *below* the threshold at which it judged
 *     a zoom readable, so it picked zooms it would reject on the next hop. Here
 *     `workZoom` steps outward in quantised rungs and never back; a crossing may
 *     borrow a wider zoom for the length of one handoff, but it restores the exact
 *     value it found. Cycling is not damped, it is unrepresentable.
 *  3. **Motion must be continuous through a change of target.** A sequence of
 *     animations fuses into drift or fights itself, and a retarget mid-flight
 *     restarts from zero velocity. Here there is one critically damped spring per
 *     axis, integrated continuously, so the camera always eases to a stop instead
 *     of arriving at one.
 *  4. **There are no cuts.** The previous model cut past a distance threshold as a
 *     safety valve, and once the aim started teleporting nearly every correction
 *     tripped it — a cut also zeroes velocity, so the springs never ran. Distance
 *     is now handled by moving the camera *back* far enough that any trip is one
 *     glance (`planCrossing`), which is what a camera operator does and is smooth
 *     at any distance. The only remaining jump is the one a reduced-motion
 *     preference asks for.
 *
 * What is left of the first model is the part that was right: stillness is the
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
// fallow-ignore-next-line code-duplication -- the "clone" here is one run of documented tuning constants matching another: `export const NAME = <number>;` under a paragraph explaining the number. There is no behaviour in common to extract, and collapsing them into a table would cost each constant the explanation that is the reason it can be trusted.
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
 * How far from where the camera is looking a node still counts, as a fraction of
 * the viewport width.
 *
 * Measured from the camera's own centre rather than from whichever node reported
 * last. That is the difference between a gate that moves as smoothly as the camera
 * does and one that re-centres itself on every event — the latter was the defect
 * that made the aim teleport, and moving the anchor is the whole of the fix.
 *
 * The value is inherited from the previous model, where it was tuned against a real
 * run, and it is worth keeping for a reason that has nothing to do with locality:
 * a branch advancing every couple of hundred milliseconds leaves a trail whose
 * age-weighted spread is several screens wide, and this is what bounds it. Widen it
 * much and the zoom bottoms out; tighten it much and the camera stops seeing where
 * the run came from.
 */
export const ATTENTION_RADIUS_SCREENS = 0.75;

/** Past this, a finished node is forgotten outright — it has a millionth of the
 * weight of live work, and keeping it only costs arithmetic. */
export const ATTENTION_WINDOW_MS = 4000;

/** How many of a branch's nodes the aim is computed from, newest first. A branch
 * can be a hundred nodes long by the end of a run and the tail of it has no
 * measurable weight; this keeps the per-frame cost flat instead of growing with
 * how long the run has been going. */
export const ATTENTION_POINTS_MAX = 24;

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
 * The deadzone a subject that fills the screen still gets, as a fraction of the
 * viewport.
 *
 * Without this the deadzone is "the room left before it clips", which reaches zero
 * exactly when the subject is as large as the viewport — so on the big graphs where
 * stillness matters most the camera owed a correction for every pixel of drift.
 * A subject that cannot be framed perfectly is better framed approximately and
 * held than framed exactly and chased.
 */
export const DEADZONE_FLOOR = 0.18;

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
export const MAX_ZOOM_OCTAVES_PER_S = 3.5;

/**
 * The crossing: how the camera travels between branches.
 *
 * Film grammar says you pan within a place and cut between places, and the second
 * half of that is what the previous model acted on — with the result that it cut
 * two or three times a second and the run became unwatchable. The grammar is not
 * wrong; the premise is. There is a third move, and it is the one a camera operator
 * on a crane actually makes: pull back until both places are one place, cross, push
 * back in. It reads as a single deliberate gesture, it shows the viewer how the two
 * branches relate — which on a workflow graph is genuinely informative — and its
 * cost barely grows with distance, because the whole point is that the distance is
 * measured at a zoom where it is small.
 *
 * `MIN_TRAVEL` is where it starts being worth it: below a screen the destination is
 * nearly in frame already and a plain pan is both shorter and more legible. `SPAN`
 * is how much of the screen the trip is allowed to occupy at the crossing zoom, so
 * the far end is comfortably in view before the camera sets off. `ARRIVE` is how
 * close it has to get before the push back in begins, **in screens at the zoom it is
 * returning to** — generous, because the push-in overlapping the last of the pan is
 * exactly what makes it one move instead of two.
 *
 * `SPAN` is also what makes the move's cost logarithmic in its distance rather than
 * linear: holding the trip at a fixed fraction of the frame fixes the pan at about
 * nine tenths of a second whatever the distance, and only the pull-back grows — by
 * one octave per doubling. A trip ten times as long costs about three more octaves,
 * which at `MAX_ZOOM_OCTAVES_PER_S` is under a second. Note that the zoom this
 * formula asks for is close to fit-view over the trip by construction, so nodes
 * being unreadable at the midpoint is not a side effect to be floored away — it is
 * the move working.
 *
 * `MIN_ZOOM` is therefore a hard limit rather than a taste one: **it must stay above
 * the `minZoom` ReactFlow is mounted with** (0.02, in `WorkflowCanvas`). A zoom
 * below that would be clamped on the way in, so the camera would read back a
 * viewport it did not write, conclude that the user had taken over, and suspend
 * itself in the middle of the crossing. Past the floor a trip goes back to paying
 * for its distance in seconds rather than in octaves, which for graphs this feature
 * will meet is well past the far end of plausible.
 */
export const CROSS_MIN_TRAVEL_SCREENS = 0.9;
export const CROSS_SPAN_SCREENS = 0.75;
export const CROSS_ARRIVE_SCREENS = 0.6;
export const CROSS_MIN_ZOOM = 0.03;

/**
 * Pan speed while crossing, in viewport diagonals per second.
 *
 * Brisker than a following pan, and it should be: a following pan is the viewer
 * reading the canvas as it moves, while a crossing is the viewer waiting to be
 * somewhere else.
 *
 * The zoom is *not* given a separate limit for crossings. It was, briefly, with the
 * push back in left slower on the theory that arriving more gently than you leave is
 * the grammar — and it cost a second of dead time at the far end, where the camera
 * was already in place and only the zoom was still creeping. `MAX_ZOOM_OCTAVES_PER_S`
 * serves both halves; it never binds on an ordinary ⅓-octave step-out, where the
 * spring is the governor, so its value only shows up in the deliberate moves.
 */
export const CROSS_PAN_SCREENS_PER_S = 0.9;

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

/**
 * Longest frame the integrator will believe. A backgrounded tab produces gaps of
 * seconds; taken literally they become a lurch, and the springs are
 * unconditionally stable so the only cost of clamping is arriving late.
 *
 * The clamp must be a *safety valve, not a governor*: it exists for gaps no real
 * display produces. The springs are exact solutions, stable at any step, so
 * nothing requires a small value — and clamping a genuinely slow frame costs
 * more than lateness, because the frame's motion is silently shrunk. At 10 fps
 * the old value threw away half of every frame, so the camera ran at half its
 * tuned speed and in coarser steps: the camera did not look slow, it *was* slow.
 * This is far past the longest frame an interactive tab produces — even 5 fps is
 * 200 ms — so a real frame is always integrated in full, and only a tab that
 * stopped painting is treated as a gap.
 */
export const MAX_FRAME_MS = 250;

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

/** How far from where the camera is looking a finished node still counts, in flow
 * units. Screen-relative, so zooming out genuinely widens what the camera is
 * willing to treat as one scene. */
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
 * Where the subject branch's attention is, as a weighted mean over what the
 * camera has been shown of it.
 *
 * `points` are one branch's nodes — the choice of branch is `runFronts`' job, and
 * it is what makes this function's answer a place rather than an average of
 * places. Within the branch, two weights apply:
 *
 * - **age**, halving every `ATTENTION_HALFLIFE_MS`, except that anything still
 *   running counts as brand new however long it has been working. So a slow node
 *   holds the camera and a finished one releases it gradually.
 * - **distance from `anchor`**, a Gaussian at `radius`. `anchor` is the camera's
 *   own centre, and that single change from the previous model — which anchored at
 *   whichever node had reported last — is what stops the aim teleporting: the gate
 *   now moves as smoothly as the camera does instead of re-centring itself on
 *   every event. What the gate earns is a bounded shot. It sheds the tail a join
 *   folds in from forty columns away, and it keeps a long branch's trailing
 *   history from asking the zoom to cover everything the run has touched in the
 *   last four seconds — without it, a fast branch demands about a third of the
 *   zoom it should and the run bottoms out at `MIN_READABLE_ZOOM` for good.
 *
 * The two weights multiply, and neither of them branches on whether a node is
 * running: `running` only feeds the *age*, as an age of zero. So a node's weight
 * does not change in the frame it finishes — at that instant its age is genuinely
 * zero — and the aim is continuous through the one event that used to move it
 * discontinuously. That property is worth more than any refinement of the gate,
 * and it is why the gate must not be conditioned on `running`.
 *
 * A camera further from the branch than the radius — which is every frame of a
 * crossing — gets an aim dominated by whichever of its nodes is closest, and so
 * flies to the end of the branch it will reach first and tracks along it from
 * there. That is a consequence of the gate rather than a rule of its own, and it is
 * the composition you would choose anyway.
 *
 * `points` must arrive newest-first; `points[0]` is always part of the answer, so
 * a branch whose every node has faded still resolves to somewhere. The returned
 * size is a spread, not an extent: see `EXTENT_SIGMAS`.
 */
export function attentionFocus(
  points: readonly AttentionPoint[],
  now: number,
  radius: number,
  anchor: { x: number; y: number },
): CameraFocus | null {
  const newest = points[0];
  if (!newest) return null;

  const spread = Math.max(1, radius * radius);

  // Every squared distance is measured against the closest one, which is a common
  // factor on every weight and therefore cancels exactly out of the weighted mean
  // and the variance below. What it buys is that the nearest point's exponent is
  // always zero, so a camera a long way from the branch it is flying to gets the
  // same answer as one right next to it instead of underflowing every weight to
  // zero at some threshold distance and changing rule.
  let closest = Infinity;
  for (const point of points) {
    const dx = point.x + point.width / 2 - anchor.x;
    const dy = point.y + point.height / 2 - anchor.y;
    closest = Math.min(closest, dx * dx + dy * dy);
  }

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
      (centreX - anchor.x) * (centreX - anchor.x) +
      (centreY - anchor.y) * (centreY - anchor.y);
    const weight = byAge * Math.exp(-(away - closest) / spread);

    weighted.push({ x: centreX, y: centreY, weight });
    total += weight;
    sumX += weight * centreX;
    sumY += weight * centreY;
    sumHalfWidth += (weight * point.width) / 2;
    sumHalfHeight += (weight * point.height) / 2;
  }

  // Everything underflowed: the branch has finished and faded, or the camera is
  // still a long way from it. Its newest node is the only thing left to say, and
  // it is also exactly where a camera on its way here should be heading.
  if (total <= 0) {
    return {
      x: newest.x + newest.width / 2,
      y: newest.y + newest.height / 2,
      width: newest.width,
      height: newest.height,
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

/**
 * The flow point the camera is actually looking at.
 *
 * `motion.x`/`y` are the centre of the *container*, but the toolbar and minimap
 * cover bands of it, so the middle of what the viewer sees sits elsewhere. This is
 * the inverse of the shift `framingFor` applies, and it is what a distance from
 * "where the camera is pointed" has to be measured from for the answer to match
 * what it looks like.
 */
export function lookingAt(
  motion: CameraMotion,
  viewport: CameraViewport,
): { x: number; y: number } {
  return {
    x: motion.x,
    y: motion.y + centreShiftPx(viewport) / Math.max(motion.zoom, 1e-6),
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
 * The same transform, with its translation snapped to the device-pixel grid.
 *
 * ReactFlow moves the canvas with one `translate(x,y) scale(k)` on
 * `.react-flow__viewport`, and every node, edge and glyph is rasterised
 * relative to it. Chromium rasterises such a layer once, at a raster
 * translation chosen from the transform it first saw, and then *keeps that
 * raster translation as the transform changes* so a moving layer does not
 * invalidate its tilings every frame. The fractional part of the difference is
 * left to the compositor, which resamples — so the whole canvas softens while
 * the camera moves and snaps sharp the moment it stops. It is worst at a half
 * pixel of drift and it does not care how simple the graph is: a single row of
 * nodes panning sideways blurs exactly as much as a hundred.
 *
 * The spring integrates in continuous graph coordinates and must keep doing so —
 * a camera quantised at the model level judders. Only the *written* transform is
 * snapped, which leaves at most half a device pixel of aim error, far inside the
 * deadzone, and removes the fraction the compositor was resampling.
 *
 * Note `k` is deliberately not snapped. It multiplies the children, not this
 * translation, so at a settled zoom it contributes a fixed sub-pixel offset that
 * bakes into the raster once instead of shimmering per frame. Zoom *changes*
 * blur regardless — that is a re-raster at a new scale, and the only cure is not
 * zooming.
 */
export function snapTransform(transform: Viewport, dpr: number): Viewport {
  const scale = dpr > 0 ? dpr : 1;
  return {
    x: Math.round(transform.x * scale) / scale,
    y: Math.round(transform.y * scale) / scale,
    zoom: transform.zoom,
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
    engagedX: engaged,
    engagedY: engaged,
    workZoom: centre.zoom >= MIN_READABLE_ZOOM ? centre.zoom : COMFORT_ZOOM,
    crossing: null,
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
 * that nearly fills the screen is held centred while a small one roams — but never
 * less than `DEADZONE_FLOOR`, because the clipping term reaches zero exactly when
 * the focus is as large as the viewport, and a deadzone of zero is a camera that
 * corrects on every frame.
 */
function deadzoneHalfPx(usablePx: number, contentPx: number): number {
  const beforeClipping = Math.max(0, (usablePx - contentPx) / 2);
  return Math.max(
    Math.min(beforeClipping, (usablePx * DEADZONE) / 2),
    (usablePx * DEADZONE_FLOOR) / 2,
  );
}

/**
 * Set up a handoff to a subject somewhere else entirely.
 *
 * Called by the caller when the branch being followed changes — and on the opening
 * move of a run, which is the same problem: the camera is one place and the thing
 * to watch is another. Returns the motion unchanged when the trip is short enough
 * to simply pan, which is the common case and includes every re-run of a workflow
 * the user is already looking at.
 *
 * The zoom is chosen so the trip spans `CROSS_SPAN_SCREENS` of the frame, which
 * makes the move's duration nearly independent of its distance: forty columns and
 * four look the same from far enough back. `workZoom` is deliberately untouched, so
 * the push-in at the far end lands on the framing the run was being watched at.
 */
export function planCrossing(
  motion: CameraMotion,
  focus: CameraFocus | null,
  viewport: CameraViewport,
): CameraMotion {
  if (!focus) return motion;

  const target = framingFor(focus, viewport, motion.workZoom);
  const travel = Math.hypot(target.x - motion.x, target.y - motion.y);
  const screen = screenDiagonalPx(viewport);

  // Near enough that a pan is the shorter and more legible move: the destination
  // is already at the edge of frame, and there is content to track all the way.
  if (travel * motion.workZoom <= CROSS_MIN_TRAVEL_SCREENS * screen) {
    return motion;
  }

  const zoom = Math.max(
    CROSS_MIN_ZOOM,
    Math.min(motion.workZoom, (CROSS_SPAN_SCREENS * screen) / travel),
  );

  return {
    ...motion,
    crossing: {
      zoom,
      // In working-zoom terms, not crossing-zoom terms. Measuring it out at the
      // wide zoom is a trap: a third of a screen there is several screens once the
      // camera is back in, so the push-in would start miles short and the rest of
      // the trip would crawl at following speed. That mistake was worth four
      // seconds of dead time on a long handoff.
      settleWithin: (CROSS_ARRIVE_SCREENS * screen) / motion.workZoom,
    },
    // A crossing is one move with one mark, so it starts from a clean aim: the
    // lead that composes a following pan would only fight it.
    engagedX: true,
    engagedY: true,
    aimBiasX: 0,
    aimBiasY: 0,
  };
}

/**
 * The zoom the run is watched at, which may only be lowered, and only after the
 * subject has genuinely failed to fit for a while. Frozen mid-crossing, where
 * what is on screen is the trip rather than the subject.
 */
function nextWorkZoom(
  motion: CameraMotion,
  focus: CameraFocus | null,
  viewport: CameraViewport,
  stepMs: number,
): { workZoom: number; crampedMs: number } {
  if (!focus || motion.crossing) {
    return { workZoom: motion.workZoom, crampedMs: motion.crampedMs };
  }

  const required = fitZoomFor(focus, viewport);
  if (required * ZOOM_OUT_SLACK >= motion.workZoom) {
    return { workZoom: motion.workZoom, crampedMs: 0 };
  }

  const crampedMs = motion.crampedMs + stepMs;
  if (crampedMs < ZOOM_OUT_DWELL_MS) {
    return { workZoom: motion.workZoom, crampedMs };
  }

  return { workZoom: stepZoomTarget(motion.workZoom, required), crampedMs: 0 };
}

/**
 * The crossing still in flight, if it is.
 *
 * A crossing ends on arrival rather than on a clock, and arrival is measured at
 * the crossing's own zoom: the push back in overlaps the last of the pan, which
 * is what fuses the three phases into one gesture.
 */
function liveCrossing(
  motion: CameraMotion,
  mark: CameraFraming | null,
): CameraMotion["crossing"] {
  const crossing = motion.crossing;
  if (!crossing) return null;
  if (!mark) return null;

  const away = Math.hypot(mark.x - motion.x, mark.y - motion.y);
  return away <= crossing.settleWithin ? null : crossing;
}

/** Where the camera is aiming, and whether it is correcting at all. */
interface CameraAim {
  readonly engagedX: boolean;
  readonly engagedY: boolean;
  readonly aimBiasX: number;
  readonly aimBiasY: number;
  readonly aimX: number;
  readonly aimY: number;
}

/**
 * One axis of the deadzone latch: engaged when the action leaves the deadzone,
 * released only once it is back near the mark this correction chose.
 *
 * A fresh correction picks that mark past the action, against the direction it
 * left in; an engaged axis keeps the one it has.
 */
function axisLatch(
  engaged: boolean,
  bias: number,
  offset: number,
  deadzoneHalf: number,
): { engaged: boolean; bias: number } {
  if (Math.abs(offset) > deadzoneHalf) {
    return {
      engaged: true,
      bias: engaged ? bias : -Math.sign(offset) * AIM_LEAD * deadzoneHalf,
    };
  }

  if (engaged && Math.abs(offset - bias) <= deadzoneHalf * DEADZONE_RELEASE) {
    return { engaged: false, bias: 0 };
  }

  return { engaged, bias };
}

/**
 * Following: latched per axis, so a correction runs to completion rather than
 * stopping the instant it has done enough, and so following the run sideways does
 * not also drive the picture up and down. An axis that is not correcting aims at
 * where it already is — which is not the same as freezing, because the spring
 * keeps its momentum and eases the last of it away.
 */
function followAim(
  motion: CameraMotion,
  focus: CameraFocus,
  viewport: CameraViewport,
  zoomTarget: number,
): CameraAim {
  const usable = usableSize(viewport);
  const centred = framingFor(focus, viewport, zoomTarget);
  const offX = (focus.x - motion.x) * motion.zoom;
  const offY = (focus.y - motion.y) * motion.zoom - centreShiftPx(viewport);

  const x = axisLatch(
    motion.engagedX,
    motion.aimBiasX,
    offX,
    deadzoneHalfPx(usable.width, focus.width * motion.zoom),
  );
  const y = axisLatch(
    motion.engagedY,
    motion.aimBiasY,
    offY,
    deadzoneHalfPx(usable.height, focus.height * motion.zoom),
  );

  return {
    engagedX: x.engaged,
    engagedY: y.engaged,
    aimBiasX: x.bias,
    aimBiasY: y.bias,
    aimX: x.engaged ? centred.x - x.bias / zoomTarget : motion.x,
    aimY: y.engaged ? centred.y - y.bias / zoomTarget : motion.y,
  };
}

/** Crossing: one move, one mark, both axes — the deadzone is about staying still
 * where you are, and this is the case where staying is not on offer. */
function crossingAim(mark: CameraFraming): CameraAim {
  return {
    engagedX: true,
    engagedY: true,
    aimBiasX: 0,
    aimBiasY: 0,
    aimX: mark.x,
    aimY: mark.y,
  };
}

/** Nothing to look at: hold position and let the springs run out. */
function idleAim(motion: CameraMotion): CameraAim {
  return {
    engagedX: false,
    engagedY: false,
    aimBiasX: 0,
    aimBiasY: 0,
    aimX: motion.x,
    aimY: motion.y,
  };
}

/**
 * The pan for one frame, speed-capped in screen terms so the limit means the same
 * thing at every zoom; the step and the velocity are scaled together so the spring
 * stays consistent with itself on the frame after. A crossing is allowed to be
 * brisker than a following pan, because nobody is reading the canvas during one.
 */
function integratePan(
  motion: CameraMotion,
  aim: CameraAim,
  viewport: CameraViewport,
  crossing: CameraMotion["crossing"],
  dt: number,
): { x: number; y: number; vx: number; vy: number } {
  const nextX = criticallyDamped(motion.x, motion.vx, aim.aimX, PAN_OMEGA, dt);
  const nextY = criticallyDamped(motion.y, motion.vy, aim.aimY, PAN_OMEGA, dt);

  const maxScreensPerS = crossing
    ? CROSS_PAN_SCREENS_PER_S
    : MAX_PAN_SCREENS_PER_S;
  const maxSpeed =
    (maxScreensPerS * screenDiagonalPx(viewport)) / Math.max(motion.zoom, 1e-6);
  const stepped = Math.hypot(
    nextX.position - motion.x,
    nextY.position - motion.y,
  );
  if (stepped <= maxSpeed * dt || stepped <= 0) {
    return {
      x: nextX.position,
      y: nextY.position,
      vx: nextX.velocity,
      vy: nextY.velocity,
    };
  }

  const scale = (maxSpeed * dt) / stepped;
  const speed = Math.hypot(nextX.velocity, nextY.velocity);
  const slow = speed > maxSpeed ? maxSpeed / speed : 1;

  return {
    x: motion.x + (nextX.position - motion.x) * scale,
    y: motion.y + (nextY.position - motion.y) * scale,
    vx: nextX.velocity * slow,
    vy: nextY.velocity * slow,
  };
}

/** The zoom for one frame. Zoom travels in octaves, which is the scale the eye
 * judges it on: halving and doubling are the same size of change. */
function integrateZoom(
  motion: CameraMotion,
  zoomTarget: number,
  dt: number,
): { zoom: number; vZoom: number } {
  const octaves = Math.log2(Math.max(motion.zoom, 1e-6));
  const next = criticallyDamped(
    octaves,
    motion.vZoom,
    Math.log2(zoomTarget),
    ZOOM_OMEGA,
    dt,
  );

  const maxOctaves = MAX_ZOOM_OCTAVES_PER_S * dt;
  if (Math.abs(next.position - octaves) <= maxOctaves) {
    return { zoom: Math.pow(2, next.position), vZoom: next.velocity };
  }

  return {
    zoom: Math.pow(
      2,
      octaves + Math.sign(next.position - octaves) * maxOctaves,
    ),
    vZoom:
      Math.sign(next.velocity) *
      Math.min(Math.abs(next.velocity), MAX_ZOOM_OCTAVES_PER_S),
  };
}

/**
 * Motion is not wanted at all: arrive, and be still.
 *
 * The only jump left in the model, and the only one anybody asked for — so it goes
 * straight to the framing the run is watched at, and a crossing it interrupts is
 * simply over.
 */
function landImmediately(
  motion: CameraMotion,
  focus: CameraFocus | null,
  viewport: CameraViewport,
  aim: CameraAim,
  workZoom: number,
  crampedMs: number,
): CameraMotion {
  const landed =
    focus && (aim.engagedX || aim.engagedY)
      ? framingFor(focus, viewport, workZoom)
      : { x: motion.x, y: motion.y };

  return {
    x: landed.x,
    y: landed.y,
    zoom: workZoom,
    vx: 0,
    vy: 0,
    vZoom: 0,
    engagedX: false,
    engagedY: false,
    workZoom,
    crossing: null,
    crampedMs,
    aimBiasX: 0,
    aimBiasY: 0,
  };
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
  const { workZoom, crampedMs } = nextWorkZoom(motion, focus, viewport, stepMs);

  // The mark is the framing at the *working* zoom throughout, not at the crossing
  // zoom. The two differ by the inset shift, which in flow units is large while
  // zoomed out, so aiming at the wide framing would land the camera somewhere it
  // then had to correct away from once the zoom came back. This way the crossing
  // converges on the exact position the run will be watched from, and the push-in
  // has nothing to do but zoom.
  const mark = focus ? framingFor(focus, viewport, workZoom) : null;
  const crossing = liveCrossing(motion, mark);
  const zoomTarget = crossing ? crossing.zoom : workZoom;

  let aim: CameraAim;
  if (mark && crossing) aim = crossingAim(mark);
  else if (focus) aim = followAim(motion, focus, viewport, zoomTarget);
  else aim = idleAim(motion);

  if (reducedMotion) {
    return landImmediately(motion, focus, viewport, aim, workZoom, crampedMs);
  }

  const pan = integratePan(motion, aim, viewport, crossing, dt);
  const zoom = integrateZoom(motion, zoomTarget, dt);

  return {
    x: pan.x,
    y: pan.y,
    zoom: zoom.zoom,
    vx: pan.vx,
    vy: pan.vy,
    vZoom: zoom.vZoom,
    engagedX: aim.engagedX,
    engagedY: aim.engagedY,
    workZoom,
    crossing,
    crampedMs,
    aimBiasX: aim.aimBiasX,
    aimBiasY: aim.aimBiasY,
  };
}

/** Nothing is moving and nothing is owed: the caller can stop asking for frames
 * until something happens. */
export function isAtRest(motion: CameraMotion): boolean {
  if (motion.engagedX || motion.engagedY) return false;
  if (motion.crossing) return false;
  if (Math.hypot(motion.vx, motion.vy) * motion.zoom > REST_SPEED_PX_PER_S) {
    return false;
  }
  if (Math.abs(motion.vZoom) > REST_ZOOM_OCTAVES_PER_S) return false;

  return (
    Math.abs(Math.log2(motion.zoom / motion.workZoom)) <=
    REST_ZOOM_OCTAVES_PER_S
  );
}
