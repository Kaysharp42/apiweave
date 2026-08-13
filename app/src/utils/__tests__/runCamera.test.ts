import { describe, it, expect } from "vitest";
import {
  adoptCamera,
  attentionFocus,
  attentionRadius,
  centreOf,
  criticallyDamped,
  fitZoomFor,
  framingFor,
  isAtRest,
  screenDiagonalPx,
  stepCamera,
  stepZoomTarget,
  transformOf,
  ATTENTION_HALFLIFE_MS,
  COMFORT_ZOOM,
  CUT_SCREENS,
  MAX_FRAME_MS,
  MAX_PAN_SCREENS_PER_S,
  MIN_READABLE_ZOOM,
  ZOOM_OUT_DWELL_MS,
  ZOOM_STEP_OCTAVES,
} from "../runCamera";
import type { AttentionPoint } from "../../types/AttentionPoint";
import type { CameraFocus } from "../../types/CameraFocus";
import type { CameraMotion } from "../../types/CameraMotion";
import type { CameraViewport } from "../../types/CameraViewport";

/** A roomy canvas with the real chrome bands: toolbar on top, minimap below. */
const box: CameraViewport = {
  width: 1600,
  height: 1000,
  insetTop: 56,
  insetBottom: 174,
};

const NODE = { width: 280, height: 120 };
const FRAME = 16;

function point(
  x: number,
  y = 0,
  extra: Partial<AttentionPoint> = {},
): AttentionPoint {
  return { x, y, ...NODE, running: true, since: 0, ...extra };
}

function focusOf(x: number, y = 0, width = 280, height = 120): CameraFocus {
  return { x, y, width, height };
}

/** A camera sitting exactly where it wants to be, with nothing left to do. */
function settled(focus: CameraFocus, zoom: number): CameraMotion {
  const framing = framingFor(focus, box, zoom);
  return {
    x: framing.x,
    y: framing.y,
    zoom,
    vx: 0,
    vy: 0,
    vZoom: 0,
    engaged: false,
    zoomTarget: zoom,
    crampedMs: 0,
    aimBiasX: 0,
    aimBiasY: 0,
  };
}

/** Where `focus` appears, in pixels right of the free area's centre. */
function offsetPx(motion: CameraMotion, focus: CameraFocus): number {
  return (
    (focus.x - motion.x) * motion.zoom - (box.insetTop - box.insetBottom) / 2
  );
}

/** Step until the camera stops, or give up. Returns the frames it took. */
function toRest(
  motion: CameraMotion,
  focus: CameraFocus | null,
  limit = 600,
): { motion: CameraMotion; frames: number; peakSpeedPx: number } {
  let peakSpeedPx = 0;
  for (let frames = 1; frames <= limit; frames += 1) {
    const before = motion;
    motion = stepCamera(motion, focus, box, FRAME, false);
    const moved =
      (Math.hypot(motion.x - before.x, motion.y - before.y) * motion.zoom) /
      (FRAME / 1000);
    peakSpeedPx = Math.max(peakSpeedPx, moved);
    if (isAtRest(motion)) return { motion, frames, peakSpeedPx };
  }
  return { motion, frames: limit, peakSpeedPx };
}

describe("criticallyDamped", () => {
  it("stays put when it is already there", () => {
    const next = criticallyDamped(100, 0, 100, 4, 0.016);
    expect(next.position).toBe(100);
    expect(next.velocity).toBe(0);
  });

  it("never overshoots, from any distance at any frame length", () => {
    for (const distance of [1, 37, 500, 12000]) {
      for (const dt of [0.004, 0.016, 0.05]) {
        let position = 0;
        let velocity = 0;
        // Four seconds of it, however that divides into frames — a critically
        // damped spring is unconditionally stable, so the frame length may only
        // change how finely the same curve is sampled.
        for (let elapsed = 0; elapsed < 4; elapsed += dt) {
          const next = criticallyDamped(position, velocity, distance, 3, dt);
          expect(next.position).toBeLessThanOrEqual(distance + 1e-9);
          expect(next.position).toBeGreaterThanOrEqual(position - 1e-9);
          position = next.position;
          velocity = next.velocity;
        }
        expect(position / distance).toBeCloseTo(1, 3);
      }
    }
  });

  it("carries momentum into the step", () => {
    // The property the whole design rests on: a camera already moving keeps
    // moving, so a target that changes mid-flight does not restart from rest.
    const fromRest = criticallyDamped(0, 0, 1000, 3, 0.016);
    const moving = criticallyDamped(0, 400, 1000, 3, 0.016);
    expect(moving.position).toBeGreaterThan(fromRest.position);
  });

  it("survives a frame long enough to have been a stall", () => {
    const next = criticallyDamped(0, 900, 1000, 3, 4);
    expect(Number.isFinite(next.position)).toBe(true);
    expect(Math.abs(next.position - 1000)).toBeLessThan(1);
    expect(Math.abs(next.velocity)).toBeLessThan(1);
  });
});

describe("attentionFocus", () => {
  const radius = attentionRadius(box, 0.7);

  it("has nothing to report with nothing to look at", () => {
    expect(attentionFocus([], 0, radius)).toBeNull();
  });

  it("is the node itself when that is all there is", () => {
    const focus = attentionFocus([point(500, 300)], 0, radius)!;
    expect(focus.x).toBeCloseTo(640, 6);
    expect(focus.y).toBeCloseTo(360, 6);
    expect(focus.width).toBeCloseTo(280, 6);
  });

  it("does not move at all in the frame a node finishes", () => {
    // The reason the aim is continuous: finishing is not an event the geometry
    // can see, only the start of a fade. A camera aimed at a bounding box gets a
    // step change here, and nothing downstream can smooth that away.
    const running = [point(0), point(600)];
    const justDone = [point(0), { ...point(600), running: false, since: 1000 }];
    const before = attentionFocus(running, 1000, radius)!;
    const after = attentionFocus(justDone, 1000, radius)!;
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("slides off a finished node over about a second", () => {
    // Live work holds its full claim while a result loses half of its own every
    // half-life, so the aim creeps towards what is still going — and creeps,
    // rather than jumps. (Two *results* keep their ratio to each other for ever,
    // which is right: with nothing running there is no news to move towards.)
    const points = [point(600), point(0, 0, { running: false, since: 0 })];
    const start = attentionFocus(points, 0, radius)!;
    const later = attentionFocus(points, ATTENTION_HALFLIFE_MS * 3, radius)!;

    // Three half-lives in, most of the way onto the live node (centre 740) and
    // still approaching it rather than having snapped there.
    expect(later.x).toBeGreaterThan(start.x + 200);
    expect(later.x).toBeLessThan(740);

    let previous = start.x;
    for (let t = FRAME; t <= ATTENTION_HALFLIFE_MS * 3; t += FRAME) {
      const step = attentionFocus(points, t, radius)!;
      expect(step.x - previous).toBeGreaterThanOrEqual(0);
      expect(step.x - previous).toBeLessThan(3);
      previous = step.x;
    }
  });

  it("ignores a branch too far away to be the same scene", () => {
    // This is what stops the camera framing the empty gap between two ends of a
    // wide graph, which is what a bounding box does by construction.
    const focus = attentionFocus([point(0), point(20000)], 0, radius)!;
    expect(focus.x).toBeCloseTo(140, 6);
    expect(focus.width).toBeCloseTo(280, 6);
  });

  it("takes in a companion that is part of the same scene", () => {
    const focus = attentionFocus([point(0), point(800)], 0, radius)!;
    // Between the two, and biased towards the newest — which is the anchor, and
    // the only one guaranteed to be on screen.
    expect(focus.x).toBeGreaterThan(140);
    expect(focus.x).toBeLessThan((140 + 940) / 2);
    expect(focus.width).toBeGreaterThan(280);
  });

  it("lets live work outweigh a finished neighbour", () => {
    const stale = attentionFocus(
      [point(0), point(800, 0, { running: false, since: -3000 })],
      0,
      radius,
    )!;
    const both = attentionFocus([point(0), point(800)], 0, radius)!;
    expect(stale.x).toBeLessThan(both.x);
  });

  it("holds full attention on a node however long it takes", () => {
    const quick = attentionFocus([point(0, 0, { since: 0 })], 0, radius)!;
    const slow = attentionFocus([point(0, 0, { since: -60000 })], 0, radius)!;
    expect(slow).toEqual(quick);
  });

  it("is a spread, so one outlier nudges the zoom instead of setting it", () => {
    const points = [point(0), point(300), point(1200)];
    const tight = attentionFocus([point(0), point(300)], 0, radius)!;
    const lopsided = attentionFocus(points, 0, radius)!;

    // What a bounding box would demand of the zoom: enough to reach the furthest
    // member from the aim. The spread asks for less, so the outlier moves the
    // zoom without dictating it.
    const enclosing =
      2 *
      Math.max(
        ...points.map(
          (p) => Math.abs(p.x + p.width / 2 - lopsided.x) + p.width / 2,
        ),
      );

    expect(lopsided.width).toBeGreaterThan(tight.width);
    expect(lopsided.width).toBeLessThan(enclosing);
  });
});

describe("stepZoomTarget", () => {
  it("keeps a zoom that still fits", () => {
    expect(stepZoomTarget(0.7, 0.7)).toBe(0.7);
    expect(stepZoomTarget(0.7, 1.4)).toBe(0.7);
  });

  it("forgives a few percent of overflow rather than rescaling for it", () => {
    expect(stepZoomTarget(0.7, 0.69)).toBe(0.7);
  });

  it("steps out in whole rungs", () => {
    const stepped = stepZoomTarget(0.8, 0.7);
    expect(stepped).toBeCloseTo(0.8 * Math.pow(2, -ZOOM_STEP_OCTAVES), 6);
    expect(stepped).toBeLessThan(0.7);
  });

  it("takes as many rungs as it needs in one go", () => {
    const stepped = stepZoomTarget(1, 0.5);
    expect(stepped).toBeCloseTo(Math.pow(2, -3 * ZOOM_STEP_OCTAVES), 6);
  });

  it("never goes below the point of being readable", () => {
    expect(stepZoomTarget(0.5, 0.01)).toBe(MIN_READABLE_ZOOM);
  });

  it("only ever goes outward", () => {
    let zoom = 0.9;
    for (const required of [0.6, 1.5, 0.55, 3, 0.5]) {
      const next = stepZoomTarget(zoom, required);
      expect(next).toBeLessThanOrEqual(zoom);
      zoom = next;
    }
  });
});

describe("adoptCamera", () => {
  it("keeps a zoom that can be read, whoever chose it", () => {
    const motion = adoptCamera({ x: 0, y: 0, zoom: 0.72 }, box, true);
    expect(motion.zoomTarget).toBe(0.72);
  });

  it("keeps one past the comfortable band too", () => {
    expect(adoptCamera({ x: 0, y: 0, zoom: 1.8 }, box, true).zoomTarget).toBe(
      1.8,
    );
  });

  it("overrides a view too far out to read", () => {
    const motion = adoptCamera({ x: 0, y: 0, zoom: 0.08 }, box, true);
    expect(motion.zoomTarget).toBe(COMFORT_ZOOM);
  });

  it("starts from where the viewport actually is", () => {
    const transform = { x: -400, y: -250, zoom: 0.5 };
    const centre = centreOf(transform, box);
    const motion = adoptCamera(transform, box, false);
    expect(motion.x).toBeCloseTo(centre.x, 9);
    expect(motion.y).toBeCloseTo(centre.y, 9);
    expect(transformOf(motion, box)).toEqual(transform);
  });
});

describe("stepCamera", () => {
  it("holds absolutely still for action already on screen", () => {
    const focus = focusOf(500, 300);
    const motion = settled(focus, 0.7);
    const nudged = { ...focus, x: focus.x + 300 };

    const next = stepCamera(motion, nudged, box, FRAME, false);
    expect(next.x).toBe(motion.x);
    expect(next.y).toBe(motion.y);
    expect(next.engaged).toBe(false);
  });

  it("follows once the action leaves the deadzone", () => {
    const focus = focusOf(500, 300);
    const motion = settled(focus, 0.7);
    const gone = { ...focus, x: focus.x + 2000 };

    const next = stepCamera(motion, gone, box, FRAME, false);
    expect(next.engaged).toBe(true);
    expect(next.x).toBeGreaterThan(motion.x);
  });

  it("aims past the action, not at it", () => {
    // Leading the subject: the run walked off to the right, so it should come to
    // rest left of centre with the canvas it is heading into in view — which is
    // also what buys the longest possible wait before the next move.
    const start = settled(focusOf(0, 0), 0.7);
    const gone = focusOf(2400, 0);
    const { motion } = toRest(start, gone);

    expect(isAtRest(motion)).toBe(true);
    expect(offsetPx(motion, gone)).toBeLessThan(-100);
  });

  it("comes to a stop rather than arriving at one", () => {
    const start = settled(focusOf(0, 0), 0.7);
    const gone = focusOf(2400, 0);

    let motion = start;
    const speeds: number[] = [];
    for (let step = 0; step < 400; step += 1) {
      const before = motion;
      motion = stepCamera(motion, gone, box, FRAME, false);
      speeds.push(Math.abs(motion.x - before.x));
      if (isAtRest(motion)) break;
    }

    const peak = Math.max(...speeds);
    const peakAt = speeds.indexOf(peak);
    // Accelerates in, decelerates out, and the last of it is a crawl.
    expect(peakAt).toBeGreaterThan(2);
    expect(speeds[speeds.length - 1]).toBeLessThan(peak / 10);
  });

  it("keeps its velocity continuous when the target moves mid-flight", () => {
    // A fresh animation would restart from rest here, which is the stutter this
    // model exists to avoid.
    let motion = settled(focusOf(0, 0), 0.7);
    let focus = focusOf(2400, 0);
    for (let step = 0; step < 20; step += 1) {
      motion = stepCamera(motion, focus, box, FRAME, false);
    }

    const before = motion.vx;
    focus = focusOf(3600, 0);
    motion = stepCamera(motion, focus, box, FRAME, false);
    expect(Math.abs(motion.vx - before)).toBeLessThan(Math.abs(before) * 0.15);
  });

  it("cuts rather than sliding across the whole graph", () => {
    const motion = settled(focusOf(0, 0), 0.7);
    const elsewhere = focusOf(
      ((CUT_SCREENS + 1) * screenDiagonalPx(box)) / 0.7,
      0,
    );

    const next = stepCamera(motion, elsewhere, box, FRAME, false);
    // There in one frame, and then perfectly still — the two things a slide
    // across two screens of empty canvas is not.
    expect(offsetPx(next, elsewhere)).toBeLessThan(0);
    expect(next.vx).toBe(0);
    expect(isAtRest(next)).toBe(true);
  });

  it("cuts instead of gliding under reduced motion", () => {
    const motion = settled(focusOf(0, 0), 0.7);
    const gone = focusOf(2400, 0);

    const next = stepCamera(motion, gone, box, FRAME, true);
    expect(next.x).toBeGreaterThan(framingFor(gone, box, 0.7).x);
    expect(next.vx).toBe(0);
    expect(isAtRest(next)).toBe(true);
  });

  it("never exceeds the pan speed limit", () => {
    const start = settled(focusOf(0, 0), 0.7);
    const gone = focusOf(3000, 900);
    const { peakSpeedPx } = toRest(start, gone);
    expect(peakSpeedPx).toBeLessThanOrEqual(
      MAX_PAN_SCREENS_PER_S * screenDiagonalPx(box) + 1,
    );
  });

  it("treats a stalled frame as a late frame, not a long one", () => {
    const motion = { ...settled(focusOf(0, 0), 0.7), vx: 4000 };
    const gone = focusOf(1500, 0);
    const next = stepCamera(motion, gone, box, 5000, false);

    const movedPx = (next.x - motion.x) * motion.zoom;
    expect(movedPx).toBeLessThanOrEqual(
      (MAX_PAN_SCREENS_PER_S * screenDiagonalPx(box) * MAX_FRAME_MS) / 1000 + 1,
    );
  });

  describe("zoom", () => {
    it("leaves a working viewport alone all run", () => {
      let motion = settled(focusOf(0, 0), 0.68);
      for (let step = 0; step < 300; step += 1) {
        const focus = focusOf(step * 40, 0);
        motion = stepCamera(motion, focus, box, FRAME, false);
        expect(motion.zoom).toBeCloseTo(0.68, 6);
      }
    });

    it("waits before committing the run to a wider view", () => {
      const wide = focusOf(0, 0, 4000, 120);
      let motion = settled(focusOf(0, 0), 0.7);
      expect(fitZoomFor(wide, box)).toBeLessThan(0.7);

      for (
        let elapsed = 0;
        elapsed < ZOOM_OUT_DWELL_MS - FRAME;
        elapsed += FRAME
      ) {
        motion = stepCamera(motion, wide, box, FRAME, false);
        expect(motion.zoomTarget).toBe(0.7);
      }
      motion = stepCamera(motion, wide, box, FRAME * 2, false);
      expect(motion.zoomTarget).toBeLessThan(0.7);
    });

    it("forgets a spread that did not last", () => {
      const wide = focusOf(0, 0, 4000, 120);
      const tight = focusOf(0, 0);
      let motion = settled(focusOf(0, 0), 0.7);

      for (let elapsed = 0; elapsed < 300; elapsed += FRAME) {
        motion = stepCamera(motion, wide, box, FRAME, false);
      }
      expect(motion.crampedMs).toBeGreaterThan(0);
      motion = stepCamera(motion, tight, box, FRAME, false);
      expect(motion.crampedMs).toBe(0);
      expect(motion.zoomTarget).toBe(0.7);
    });

    it("cannot cycle, because it cannot come back in", () => {
      // The failure this replaced: a wide fan-out then a lone node, over and
      // over, was a full zoom round trip every couple of seconds.
      let motion = settled(focusOf(0, 0), 0.9);
      const zooms: number[] = [];

      for (let beat = 0; beat < 40; beat += 1) {
        const focus =
          beat % 2 === 0
            ? focusOf(beat * 300, 0, 3600, 120)
            : focusOf(beat * 300);
        for (let elapsed = 0; elapsed < 800; elapsed += FRAME) {
          const before = motion.zoomTarget;
          motion = stepCamera(motion, focus, box, FRAME, false);
          expect(motion.zoomTarget).toBeLessThanOrEqual(before);
        }
        zooms.push(motion.zoomTarget);
      }

      expect(zooms[zooms.length - 1]).toBe(MIN_READABLE_ZOOM);
      expect(new Set(zooms).size).toBeLessThanOrEqual(4);
    });
  });

  it("holds its ground when there is nothing to look at", () => {
    const motion = settled(focusOf(500, 300), 0.7);
    const next = stepCamera(motion, null, box, FRAME, false);
    expect(next.x).toBe(motion.x);
    expect(next.y).toBe(motion.y);
    expect(next.engaged).toBe(false);
  });
});

describe("isAtRest", () => {
  it("is not resting while it is still correcting", () => {
    const motion = { ...settled(focusOf(0, 0), 0.7), engaged: true };
    expect(isAtRest(motion)).toBe(false);
  });

  it("is not resting while the zoom has somewhere to be", () => {
    const motion = { ...settled(focusOf(0, 0), 0.7), zoomTarget: 0.5 };
    expect(isAtRest(motion)).toBe(false);
  });

  it("is not resting while it still has speed the eye could follow", () => {
    const motion = { ...settled(focusOf(0, 0), 0.7), vx: 400 };
    expect(isAtRest(motion)).toBe(false);
  });

  it("rests once the last of the motion is below noticing", () => {
    expect(isAtRest({ ...settled(focusOf(0, 0), 0.7), vx: 1 })).toBe(true);
  });
});
