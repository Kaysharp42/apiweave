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
  lookingAt,
  planCrossing,
  screenDiagonalPx,
  stepCamera,
  stepZoomTarget,
  transformOf,
  ATTENTION_HALFLIFE_MS,
  COMFORT_ZOOM,
  CROSS_MIN_TRAVEL_SCREENS,
  CROSS_MIN_ZOOM,
  CROSS_PAN_SCREENS_PER_S,
  DEADZONE_FLOOR,
  MAX_FRAME_MS,
  MAX_PAN_SCREENS_PER_S,
  MAX_ZOOM_OCTAVES_PER_S,
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
const RADIUS = attentionRadius(box, 0.7);

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

/** The aim, with the camera looking at wherever the newest point is — which is
 * where a camera following this branch would be. */
function aimAt(
  points: readonly AttentionPoint[],
  now = 0,
  anchor?: { x: number; y: number },
): CameraFocus | null {
  const head = points[0];
  const at = anchor ?? {
    x: head ? head.x + head.width / 2 : 0,
    y: head ? head.y + head.height / 2 : 0,
  };
  return attentionFocus(points, now, RADIUS, at);
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
    engagedX: false,
    engagedY: false,
    workZoom: zoom,
    crossing: null,
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
  limit = 900,
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
  it("has nothing to report with nothing to look at", () => {
    expect(aimAt([])).toBeNull();
  });

  it("is the node itself when that is all there is", () => {
    const focus = aimAt([point(500, 300)])!;
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
    const before = aimAt(running, 1000)!;
    const after = aimAt(justDone, 1000)!;
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("does not move in that frame wherever the node is", () => {
    // The invariant, and the reason neither weight may branch on `running`:
    // finishing sets the node's age to zero, so at that instant nothing about it
    // has changed. It holds at any distance, which is what makes the distance gate
    // safe to have at all.
    for (const at of [200, box.width / 2 / 0.7, 40000]) {
      const running = [point(0), point(at)];
      const justDone = [
        point(0),
        { ...point(at), running: false, since: 1000 },
      ];
      expect(aimAt(justDone, 1000)!.x).toBeCloseTo(aimAt(running, 1000)!.x, 9);
    }
  });

  it("aims along a branch it has not reached, from the end it gets to first", () => {
    // Every frame of a crossing is this case: the whole branch is far outside the
    // gate. Measuring distances against the closest one keeps the answer meaningful
    // instead of underflowing to zero and changing rule partway across, and the
    // answer is the near end of the branch — which is where you would aim anyway.
    const far = [point(40000), point(39000, 0, { running: false, since: 0 })];
    const focus = aimAt(far, 0, { x: 0, y: 0 })!;
    expect(focus.x).toBeCloseTo(39140, 6);

    // And it stays meaningful at a distance where a plain Gaussian is exactly zero.
    const absurd = aimAt([point(4_000_000), point(3_900_000)], 0, {
      x: 0,
      y: 0,
    })!;
    expect(Number.isFinite(absurd.x)).toBe(true);
    expect(absurd.x).toBeCloseTo(3_900_140, 6);
  });

  it("lets a distant tail fade out of the aim rather than dragging it back", () => {
    // What the gate is actually for: a join folds another branch's last few nodes
    // into this one from forty columns away, and they should leave the shot as
    // they age rather than pulling the camera back across the graph.
    const near = aimAt([
      point(0),
      point(2000, 0, { running: false, since: -ATTENTION_HALFLIFE_MS }),
    ])!;
    const far = aimAt([
      point(0),
      point(40000, 0, { running: false, since: -ATTENTION_HALFLIFE_MS }),
    ])!;

    const pulledNear = (near.x - 140) / 2000;
    const pulledFar = (far.x - 140) / 40000;
    expect(pulledFar).toBeLessThan(pulledNear / 4);
  });

  it("slides off a finished node over about a second", () => {
    // Live work holds its full claim while a result loses half of its own every
    // half-life, so the aim creeps towards what is still going — and creeps,
    // rather than jumps.
    const points = [point(600), point(0, 0, { running: false, since: 0 })];
    const anchor = { x: 740, y: 60 };
    const start = aimAt(points, 0, anchor)!;
    const later = aimAt(points, ATTENTION_HALFLIFE_MS * 3, anchor)!;

    expect(later.x).toBeGreaterThan(start.x + 100);
    expect(later.x).toBeLessThan(740);

    let previous = start.x;
    for (let t = FRAME; t <= ATTENTION_HALFLIFE_MS * 3; t += FRAME) {
      const step = aimAt(points, t, anchor)!;
      expect(step.x - previous).toBeGreaterThanOrEqual(0);
      expect(step.x - previous).toBeLessThan(3);
      previous = step.x;
    }
  });

  it("lets live work outweigh a finished neighbour", () => {
    const stale = aimAt(
      [point(0), point(800, 0, { running: false, since: -3000 })],
      0,
    )!;
    const both = aimAt([point(0), point(800)], 0)!;
    expect(stale.x).toBeLessThan(both.x);
  });

  it("holds full attention on a node however long it takes", () => {
    const quick = aimAt([point(0, 0, { since: 0 })])!;
    const slow = aimAt([point(0, 0, { since: -60000 })])!;
    expect(slow).toEqual(quick);
  });

  it("is a spread, so a straggler nudges the zoom instead of setting it", () => {
    // Live nodes on the subject branch are all equally the scene, so the case
    // where this matters is a straggler that has finished and is on its way out.
    const straggler = point(1200, 0, {
      running: false,
      since: -ATTENTION_HALFLIFE_MS,
    });
    const points = [point(0), point(300), straggler];
    const tight = aimAt([point(0), point(300)])!;
    const lopsided = aimAt(points)!;

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
    expect(adoptCamera({ x: 0, y: 0, zoom: 0.72 }, box, true).workZoom).toBe(
      0.72,
    );
  });

  it("keeps one past the comfortable band too", () => {
    expect(adoptCamera({ x: 0, y: 0, zoom: 1.8 }, box, true).workZoom).toBe(
      1.8,
    );
  });

  it("overrides a view too far out to read", () => {
    expect(adoptCamera({ x: 0, y: 0, zoom: 0.08 }, box, true).workZoom).toBe(
      COMFORT_ZOOM,
    );
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

describe("lookingAt", () => {
  it("is the middle of what the viewer can see, not of the container", () => {
    const focus = focusOf(4000, 2000);
    const motion = settled(focus, 0.7);
    const at = lookingAt(motion, box);
    expect(at.x).toBeCloseTo(focus.x, 6);
    expect(at.y).toBeCloseTo(focus.y, 6);
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
    expect(next.engagedX).toBe(false);
    expect(next.engagedY).toBe(false);
  });

  it("follows once the action leaves the deadzone", () => {
    const focus = focusOf(500, 300);
    const motion = settled(focus, 0.7);
    const gone = { ...focus, x: focus.x + 2000 };

    const next = stepCamera(motion, gone, box, FRAME, false);
    expect(next.engagedX).toBe(true);
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

  it("follows sideways without driving the picture up and down", () => {
    // The latch is per axis. With one shared latch, a run walking left to right
    // kept X engaged for ever, which kept Y engaged too — so every wobble in the
    // vertical spread of the branch was chased. Measured on a real run, that was
    // 133 vertical direction reversals in 63 seconds.
    let motion = settled(focusOf(0, 0), 0.7);
    let reversals = 0;
    let previous = 0;

    for (let step = 1; step < 400; step += 1) {
      // Walking right, with the branch's vertical spread jittering as nodes come
      // and go — the shape of a real event stream.
      const focus = focusOf(step * 30, Math.sin(step) * 90);
      const before = motion.y;
      motion = stepCamera(motion, focus, box, FRAME, false);
      const direction = Math.sign(motion.y - before);
      if (direction !== 0 && previous !== 0 && direction !== previous) {
        reversals += 1;
      }
      if (direction !== 0) previous = direction;
    }

    expect(motion.x).toBeGreaterThan(0);
    expect(reversals).toBeLessThan(6);
  });

  it("gives a subject the size of the viewport a deadzone anyway", () => {
    // The clipping term reaches zero exactly when the subject is as large as the
    // frame — which on a big graph is most of the run — and a deadzone of zero is
    // a camera that corrects every frame.
    const huge = focusOf(0, 0, 1600 / 0.7, 1000 / 0.7);
    const motion = settled(huge, 0.7);
    const drifted = {
      ...huge,
      x: huge.x + (0.4 * DEADZONE_FLOOR * 1600) / 0.7,
    };

    const next = stepCamera(motion, drifted, box, FRAME, false);
    expect(next.engagedX).toBe(false);
    expect(next.x).toBe(motion.x);
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
    // Gaps are all the same gap: past the clamp, longer away is not longer in.
    expect(stepCamera(motion, gone, box, 9000, false)).toEqual(next);
  });

  it("integrates a slow but real frame in full", () => {
    const motion = settled(focusOf(0, 0), 0.7);
    const gone = focusOf(1500, 0);

    const at100 = stepCamera(motion, gone, box, 100, false);
    const at200 = stepCamera(motion, gone, box, 200, false);

    // A clamp that bound at real frame rates would flatten both to one step;
    // integrated in full, twice the time moves strictly farther.
    expect(Math.abs(at200.x - motion.x)).toBeGreaterThan(
      Math.abs(at100.x - motion.x),
    );
  });

  it("cuts instead of gliding under reduced motion", () => {
    const motion = settled(focusOf(0, 0), 0.7);
    const gone = focusOf(2400, 0);

    const next = stepCamera(motion, gone, box, FRAME, true);
    expect(next.x).toBeCloseTo(framingFor(gone, box, 0.7).x, 6);
    expect(next.vx).toBe(0);
    expect(isAtRest(next)).toBe(true);
  });

  it("abandons a crossing under reduced motion rather than flying it", () => {
    const start = settled(focusOf(0, 0), 0.7);
    const elsewhere = focusOf(60000, 0);
    const planned = planCrossing(start, elsewhere, box);
    expect(planned.crossing).not.toBeNull();

    const next = stepCamera(planned, elsewhere, box, FRAME, true);
    expect(next.crossing).toBeNull();
    expect(next.zoom).toBe(0.7);
    expect(next.x).toBeCloseTo(framingFor(elsewhere, box, 0.7).x, 6);
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
        expect(motion.workZoom).toBe(0.7);
      }
      motion = stepCamera(motion, wide, box, FRAME * 2, false);
      expect(motion.workZoom).toBeLessThan(0.7);
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
      expect(motion.workZoom).toBe(0.7);
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
          const before = motion.workZoom;
          motion = stepCamera(motion, focus, box, FRAME, false);
          expect(motion.workZoom).toBeLessThanOrEqual(before);
        }
        zooms.push(motion.workZoom);
      }

      expect(zooms[zooms.length - 1]).toBe(MIN_READABLE_ZOOM);
      expect(new Set(zooms).size).toBeLessThanOrEqual(4);
    });

    it("does not re-frame the run for what is on screen mid-crossing", () => {
      // Mid-crossing the whole graph is in frame, which would read as a subject
      // far too wide to fit. Committing the rest of the run to that would let
      // every handoff ratchet the framing outward.
      const start = settled(focusOf(0, 0), 0.7);
      const elsewhere = focusOf(40000, 0, 20000, 4000);
      let motion = planCrossing(start, elsewhere, box);
      expect(motion.crossing).not.toBeNull();

      for (let step = 0; step < 40; step += 1) {
        motion = stepCamera(motion, elsewhere, box, FRAME, false);
        if (!motion.crossing) break;
        expect(motion.workZoom).toBe(0.7);
        expect(motion.crampedMs).toBe(0);
      }
    });
  });

  it("holds its ground when there is nothing to look at", () => {
    const motion = settled(focusOf(500, 300), 0.7);
    const next = stepCamera(motion, null, box, FRAME, false);
    expect(next.x).toBe(motion.x);
    expect(next.y).toBe(motion.y);
    expect(next.engagedX).toBe(false);
    expect(next.engagedY).toBe(false);
  });
});

describe("planCrossing", () => {
  const start = settled(focusOf(0, 0), 0.7);
  const screen = screenDiagonalPx(box);

  it("leaves a trip the springs can just pan", () => {
    const near = focusOf((CROSS_MIN_TRAVEL_SCREENS * screen * 0.8) / 0.7, 0);
    expect(planCrossing(start, near, box)).toBe(start);
  });

  it("has nothing to plan without a destination", () => {
    expect(planCrossing(start, null, box)).toBe(start);
  });

  it("pulls back far enough to make a long trip one glance", () => {
    const far = focusOf(30000, 0);
    const planned = planCrossing(start, far, box);
    const travel = Math.abs(framingFor(far, box, 0.7).x - start.x);

    expect(planned.crossing).not.toBeNull();
    // The trip spans well under a screen at the zoom it is flown at, so the
    // destination is in view before the camera sets off.
    expect(travel * planned.crossing!.zoom).toBeLessThan(screen);
  });

  it("goes wider the further it has to go", () => {
    const near = planCrossing(start, focusOf(8000, 0), box).crossing!;
    const far = planCrossing(start, focusOf(60000, 0), box).crossing!;
    expect(far.zoom).toBeLessThan(near.zoom);
  });

  it("does not touch the zoom the run is being watched at", () => {
    const planned = planCrossing(start, focusOf(30000, 0), box);
    expect(planned.workZoom).toBe(start.workZoom);
  });

  it("has a floor, so no graph is too wide to cross", () => {
    const planned = planCrossing(start, focusOf(4_000_000, 0), box);
    expect(planned.crossing!.zoom).toBe(CROSS_MIN_ZOOM);
  });

  it("never chooses a zoom closer in than the one it is leaving", () => {
    const tight = settled(focusOf(0, 0), MIN_READABLE_ZOOM);
    const planned = planCrossing(tight, focusOf(30000, 0), box);
    expect(planned.crossing!.zoom).toBeLessThanOrEqual(MIN_READABLE_ZOOM);
  });
});

describe("crossing to another branch", () => {
  const screen = screenDiagonalPx(box);

  /** Fly a whole handoff and report what it looked like. */
  function fly(fromZoom: number, toX: number) {
    const start = settled(focusOf(0, 0), fromZoom);
    const destination = focusOf(toX, 600);
    let motion = planCrossing(start, destination, box);

    let peakStepPx = 0;
    let peakOctavesPerS = 0;
    let frames = 0;
    let crossingFrames = 0;
    let onScreenAt = -1;

    for (; frames < 1200; frames += 1) {
      const before = motion;
      motion = stepCamera(motion, destination, box, FRAME, false);
      if (before.crossing) crossingFrames += 1;
      if (
        onScreenAt < 0 &&
        Math.abs(offsetPx(motion, destination)) < box.width / 2
      ) {
        onScreenAt = frames;
      }
      peakStepPx = Math.max(
        peakStepPx,
        Math.hypot(motion.x - before.x, motion.y - before.y) * motion.zoom,
      );
      peakOctavesPerS = Math.max(
        peakOctavesPerS,
        Math.abs(Math.log2(motion.zoom / before.zoom)) / (FRAME / 1000),
      );
      if (isAtRest(motion)) break;
    }

    return {
      motion,
      destination,
      seconds: (frames * FRAME) / 1000,
      crossingSeconds: (crossingFrames * FRAME) / 1000,
      onScreenSeconds: (onScreenAt * FRAME) / 1000,
      peakStepPx,
      peakOctavesPerS,
    };
  }

  it("crosses the graph without a single jump", () => {
    // The whole point. The model this replaced covered this distance in one
    // frame, 174 times in 63 seconds.
    const flight = fly(0.7, 30000);
    expect(flight.peakStepPx).toBeLessThanOrEqual(
      (CROSS_PAN_SCREENS_PER_S * screen * FRAME) / 1000 + 1,
    );
    expect(flight.peakOctavesPerS).toBeLessThanOrEqual(
      MAX_ZOOM_OCTAVES_PER_S + 1e-6,
    );
  });

  it("arrives, and at the framing the run was being watched at", () => {
    const flight = fly(0.7, 30000);
    expect(isAtRest(flight.motion)).toBe(true);
    expect(flight.motion.crossing).toBeNull();
    expect(flight.motion.zoom / 0.7).toBeCloseTo(1, 2);
    // On screen, and composed rather than dead centre.
    expect(Math.abs(offsetPx(flight.motion, flight.destination))).toBeLessThan(
      box.width / 2,
    );
  });

  it("shows the viewer where it is going almost at once, however far that is", () => {
    // The number that decides whether a handoff reads as a camera move or as a
    // wait. The pull-back brings the destination into frame long before the camera
    // has finished settling on it, so most of the move is spent already looking at
    // the right place.
    for (const travel of [9000, 30000, 90000]) {
      expect(fly(0.7, travel).onScreenSeconds).toBeLessThan(2.5);
    }
  });

  it("costs far less than proportionally more for a far longer trip", () => {
    // Distance is paid for in octaves rather than in seconds — one octave per
    // doubling — which is the whole reason a handoff between distant branches is
    // affordable at all.
    const near = fly(0.7, 9000);
    const far = fly(0.7, 90000);

    expect(far.seconds).toBeLessThan(near.seconds * 2);
    expect(far.seconds).toBeLessThan(9);
  });

  it("is one continuous move, not three animations", () => {
    // The push back in overlaps the last of the pan: the camera is still
    // travelling when the zoom starts coming back.
    const start = settled(focusOf(0, 0), 0.7);
    const destination = focusOf(30000, 600);
    let motion = planCrossing(start, destination, box);

    let overlapped = false;
    let panning = false;
    for (let step = 0; step < 1200; step += 1) {
      const before = motion;
      motion = stepCamera(motion, destination, box, FRAME, false);
      const moved = Math.hypot(motion.x - before.x, motion.y - before.y);
      const zoomedIn = motion.zoom > before.zoom * 1.000001;
      panning = moved * motion.zoom > 1;
      if (zoomedIn && panning) overlapped = true;
      if (isAtRest(motion)) break;
    }

    expect(overlapped).toBe(true);
  });

  it("keeps up with a branch that is still moving while it flies there", () => {
    // The destination is a live branch, so it advances while the camera is on its
    // way; it has to land on where the branch is rather than where it was.
    const start = settled(focusOf(0, 0), 0.7);
    let destination = focusOf(30000, 0);
    let motion = planCrossing(start, destination, box);
    let advanced = 0;

    for (let step = 0; step < 1200; step += 1) {
      // The branch keeps working until the camera has arrived, then holds.
      if (motion.crossing) {
        advanced += 12;
        destination = focusOf(30000 + advanced, 0);
      }
      motion = stepCamera(motion, destination, box, FRAME, false);
      if (isAtRest(motion)) break;
    }

    expect(advanced).toBeGreaterThan(0);
    expect(isAtRest(motion)).toBe(true);
    expect(Math.abs(offsetPx(motion, destination))).toBeLessThan(box.width / 2);
  });
});

describe("isAtRest", () => {
  it("is not resting while it is still correcting", () => {
    expect(isAtRest({ ...settled(focusOf(0, 0), 0.7), engagedX: true })).toBe(
      false,
    );
    expect(isAtRest({ ...settled(focusOf(0, 0), 0.7), engagedY: true })).toBe(
      false,
    );
  });

  it("is not resting mid-crossing", () => {
    const motion = {
      ...settled(focusOf(0, 0), 0.7),
      crossing: { zoom: 0.1, settleWithin: 1000 },
    };
    expect(isAtRest(motion)).toBe(false);
  });

  it("is not resting while the zoom has somewhere to be", () => {
    const motion = { ...settled(focusOf(0, 0), 0.7), workZoom: 0.5 };
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
