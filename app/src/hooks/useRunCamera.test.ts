import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Edge, Node, Viewport } from "reactflow";
import useRunCamera from "./useRunCamera";
import {
  centreOf,
  screenDiagonalPx,
  COMFORT_ZOOM,
  CROSS_PAN_SCREENS_PER_S,
  MIN_READABLE_ZOOM,
} from "../utils/runCamera";
import {
  CanvasCornerGutter,
  CanvasToolbarBand,
  MiniMapSize,
} from "../constants/CanvasChrome";
import type { CameraViewport } from "../types/CameraViewport";

/**
 * The hook's job is *what* the camera is aimed at and *when* it is allowed to
 * move — the motion itself belongs to `runCamera` and is tested there. So these
 * assert about where the viewport ends up and what it does on the way, never
 * about a particular curve: they would fail if the hook attended to the wrong
 * nodes or ignored the user, and would not churn if the springs were retuned.
 */

const CANVAS = { width: 1600, height: 1000 };

const cameraBox: CameraViewport = {
  width: CANVAS.width,
  height: CANVAS.height,
  insetTop: CanvasToolbarBand,
  insetBottom: MiniMapSize.height + CanvasCornerGutter * 2,
};

/** Far enough out that a node is a speck — the view the camera exists to fix. */
const OVERVIEW_ZOOM = 0.08;

/** Somewhere a person might reasonably have left the canvas, node text legible. */
const WORKING_ZOOM = 0.68;

/** Node pitch of a real auto-layout, so "the next node along" means what it means
 * on the canvas rather than an arbitrary distance. */
const PITCH = 420;

function makeNode(id: string, x: number, y = 0): Node {
  return { id, position: { x, y }, width: 280, height: 120, data: {} };
}

/** The centre of a node, which is what the camera aims at. */
function centreX(node: Node): number {
  return node.position.x + 140;
}

const start = makeNode("start", 0);
const neighbour = makeNode("near", PITCH);
const third = makeNode("mid", PITCH * 2);
const faraway = makeNode("far", PITCH * 30);
const allNodes = [start, neighbour, third, faraway];

function link(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

/** One chain, so the camera has a single branch to follow. Which branch is the
 * subject is `runFronts`' decision and is tested there; here the graph exists so
 * that decision has an unambiguous answer. */
const allEdges = [
  link("start", "near"),
  link("near", "mid"),
  link("mid", "far"),
];

/** A ReactFlow stand-in that actually applies what it is given, so every
 * decision downstream is made against a viewport that really moved. */
function makeInstance(zoom = OVERVIEW_ZOOM) {
  let viewport: Viewport = { x: CANVAS.width / 2, y: CANVAS.height / 2, zoom };
  return {
    setViewport: vi.fn((next: Viewport) => {
      viewport = next;
    }),
    getViewport: () => viewport,
    get current() {
      return viewport;
    },
  };
}

type Instance = ReturnType<typeof makeInstance>;

function setup(nodes = allNodes, zoom = OVERVIEW_ZOOM, edges = allEdges) {
  const instance = makeInstance(zoom);
  const container = {
    getBoundingClientRect: () =>
      ({ width: CANVAS.width, height: CANVAS.height }) as DOMRect,
  } as HTMLElement;

  const rendered = renderHook(() =>
    useRunCamera({
      instanceRef: { current: instance },
      nodesRef: { current: nodes },
      edgesRef: { current: edges },
      containerRef: { current: container },
    }),
  );

  return { ...rendered, instance };
}

/** Let the camera have `ms` worth of frames. */
function frames(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Long enough for any move plus its ease-out to be over. */
function settle() {
  frames(6000);
}

/** Where the camera is looking now, in flow coordinates. */
function looking(instance: Instance) {
  return centreOf(instance.current, cameraBox);
}

/** How far right of the free area's centre a point currently appears. */
function offsetPx(instance: Instance, flowX: number): number {
  return (flowX - looking(instance).x) * instance.current.zoom;
}

/** Every distinct zoom the viewport was ever put at. */
function zoomsSeen(instance: Instance): number[] {
  const seen: number[] = [];
  let last: number | null = null;
  for (const [viewport] of instance.setViewport.mock.calls) {
    if (last === null || Math.abs(last - viewport.zoom) > 1e-9) {
      seen.push(viewport.zoom);
      last = viewport.zoom;
    }
  }
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "Date",
      "performance",
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useRunCamera", () => {
  it("does nothing at all until a run starts", () => {
    const { result, instance } = setup();

    act(() => {
      result.current.camera.onNodeShown("start", "running");
    });
    settle();

    expect(instance.setViewport).not.toHaveBeenCalled();
    expect(result.current.isFollowing).toBe(false);
  });

  it("glides in to the entry point from an overview", () => {
    const { result, instance } = setup();

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });
    expect(result.current.isFollowing).toBe(true);

    // Not a jump: the establishing move takes many frames, and it is a way
    // through the zooms rather than a step between two of them.
    frames(100);
    expect(instance.setViewport.mock.calls.length).toBeGreaterThan(3);
    expect(instance.current.zoom).toBeGreaterThan(OVERVIEW_ZOOM);
    expect(instance.current.zoom).toBeLessThan(COMFORT_ZOOM);

    settle();
    expect(instance.current.zoom).toBeCloseTo(COMFORT_ZOOM, 2);
    // Framed, near the middle — not pixel-centred, because the camera lets go as
    // soon as it is close enough rather than chasing the last hundred pixels.
    expect(Math.abs(offsetPx(instance, centreX(start)))).toBeLessThan(200);
  });

  it("keeps a viewport that already reads well, for the whole run", () => {
    // The failure this replaced: a re-run from a working zoom rescaled to the
    // camera's own preference and back again, over and over.
    const { result, instance } = setup(allNodes, WORKING_ZOOM);

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });
    settle();

    for (const node of [neighbour, third]) {
      act(() => {
        result.current.camera.onNodeShown(node.id, "running");
      });
      frames(400);
      act(() => {
        result.current.camera.onNodeShown(node.id, "success");
      });
      settle();
    }

    expect(zoomsSeen(instance)).toEqual([WORKING_ZOOM]);
  });

  it("never zooms back in once it has zoomed out", () => {
    // A wide fan-out and then a lone node, repeatedly: the shape that used to
    // produce a full zoom round trip every couple of seconds.
    const wide = [
      makeNode("a", 0),
      makeNode("b", PITCH * 3),
      makeNode("c", PITCH * 6),
    ];
    const { result, instance } = setup([...wide, neighbour], WORKING_ZOOM, [
      link("a", "b"),
      link("b", "c"),
      link("c", "near"),
    ]);

    act(() => {
      result.current.camera.onRunStart(["a"]);
    });
    settle();

    for (let take = 0; take < 6; take += 1) {
      act(() => {
        for (const node of wide) {
          result.current.camera.onNodeShown(node.id, "running");
        }
      });
      frames(900);
      act(() => {
        for (const node of wide) {
          result.current.camera.onNodeShown(node.id, "success");
        }
        result.current.camera.onNodeShown("near", "running");
      });
      settle();
    }

    const zooms = zoomsSeen(instance);
    expect(zooms.length).toBeGreaterThan(1);
    expect([...zooms].sort((a, b) => b - a)).toEqual(zooms);
    expect(Math.min(...zooms)).toBeGreaterThanOrEqual(MIN_READABLE_ZOOM);
  });

  it("holds still for a node that is already on screen", () => {
    const { result, instance } = setup(allNodes, WORKING_ZOOM);

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });
    settle();
    const before = instance.current;
    instance.setViewport.mockClear();

    act(() => {
      result.current.camera.onNodeShown("near", "running");
    });
    settle();

    expect(instance.setViewport).not.toHaveBeenCalled();
    expect(instance.current).toEqual(before);
  });

  it("stops asking for frames once there is nothing left to do", () => {
    const { result, instance } = setup(allNodes, WORKING_ZOOM);

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });
    settle();
    instance.setViewport.mockClear();
    frames(4000);

    expect(instance.setViewport).not.toHaveBeenCalled();
  });

  it("follows the run to a node that has left the frame", () => {
    // Far enough out of frame to owe a move, near enough that the move is a pan —
    // which is where the lead composition applies. A trip long enough to need a
    // crane move lands centred instead, and picks the lead up on its next
    // correction; that case is covered under "crossing" below.
    const out = makeNode("out", PITCH * 4);
    const { result, instance } = setup([start, out], WORKING_ZOOM, [
      link("start", "out"),
    ]);

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });
    settle();

    act(() => {
      result.current.camera.onNodeShown("out", "running");
    });
    settle();

    // On screen, and left of centre with the canvas it is heading into in view.
    const offset = offsetPx(instance, centreX(out));
    expect(Math.abs(offset)).toBeLessThan(CANVAS.width / 2);
    expect(offset).toBeLessThan(0);
  });

  it("flies to a branch too far away to pan to, and never jumps", () => {
    // What this replaced cut here, and once the aim started teleporting nearly
    // every correction tripped that threshold — 174 cuts in 63 seconds. Distance is
    // now paid for by pulling back rather than by skipping the journey.
    const { result, instance } = setup(allNodes, WORKING_ZOOM);

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });
    settle();
    const from = instance.current;
    instance.setViewport.mockClear();

    act(() => {
      result.current.camera.onNodeShown("far", "running");
    });

    // Sampled a frame at a time so a jump cannot hide between two samples.
    let previous = instance.current;
    let biggestStepPx = 0;
    for (let elapsed = 0; elapsed < 9000; elapsed += 16) {
      frames(16);
      const now = instance.current;
      const movedPx =
        Math.hypot(
          (now.x - previous.x) / now.zoom,
          (now.y - previous.y) / now.zoom,
        ) * now.zoom;
      biggestStepPx = Math.max(biggestStepPx, movedPx);
      previous = now;
    }

    expect(instance.setViewport.mock.calls.length).toBeGreaterThan(60);
    expect(Math.abs(instance.current.x - from.x)).toBeGreaterThan(CANVAS.width);
    // No single frame moves more than a camera move plausibly could.
    expect(biggestStepPx).toBeLessThan(CANVAS.width / 4);
    // And it pulled back to get there, then came back to the working zoom.
    expect(Math.min(...zoomsSeen(instance))).toBeLessThan(WORKING_ZOOM / 2);
    expect(instance.current.zoom).toBeCloseTo(WORKING_ZOOM, 2);
  });

  describe("the user always wins", () => {
    it("stops the moment a hand lands on the canvas", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start"]);
      });
      frames(100);

      act(() => {
        result.current.onViewportInteraction(new MouseEvent("mousedown"));
      });
      const taken = instance.current;
      settle();

      expect(result.current.isSuspended).toBe(true);
      expect(instance.current).toEqual(taken);
    });

    it("does not mistake its own frames for a hand", () => {
      const { result } = setup();

      act(() => {
        result.current.camera.onRunStart(["start"]);
      });
      // The camera writes the viewport on every frame of this; a transform with
      // no source event behind it must never be mistaken for a hand.
      frames(500);
      act(() => {
        result.current.onViewportInteraction(null);
      });

      expect(result.current.isSuspended).toBe(false);
    });

    it("gives way to a viewport change it did not make", () => {
      // ReactFlow's own zoom and fit-view buttons move the canvas through a
      // transform with no source event, so `onMoveStart` never hears about them.
      // Without this the camera would quietly undo them on its next frame.
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start"]);
      });
      frames(100);

      const elsewhere = { x: -4000, y: -2000, zoom: 0.3 };
      instance.setViewport(elsewhere);
      frames(500);

      expect(result.current.isSuspended).toBe(true);
      expect(instance.current).toEqual(elsewhere);
    });

    it("keeps tracking while suspended, and resumes onto the live front", () => {
      const { result, instance } = setup(allNodes, WORKING_ZOOM);

      act(() => {
        result.current.camera.onRunStart(["start"]);
      });
      settle();
      act(() => {
        result.current.onViewportInteraction(new MouseEvent("mousedown"));
      });
      act(() => {
        result.current.camera.onNodeShown("mid", "running");
      });
      settle();

      act(() => {
        result.current.resume();
      });
      settle();

      expect(result.current.isSuspended).toBe(false);
      expect(Math.abs(offsetPx(instance, centreX(third)))).toBeLessThan(
        CANVAS.width / 2,
      );
    });

    it("takes resume literally, deadzone or no deadzone", () => {
      const { result, instance } = setup(allNodes, WORKING_ZOOM);

      act(() => {
        result.current.camera.onRunStart(["start"]);
      });
      settle();
      act(() => {
        result.current.onViewportInteraction(new MouseEvent("mousedown"));
      });

      // Nudged by less than the camera would ever have followed on its own.
      const taken = instance.current;
      instance.setViewport({ ...taken, x: taken.x - 300 });
      const displaced = Math.abs(offsetPx(instance, centreX(start)));
      instance.setViewport.mockClear();

      act(() => {
        result.current.resume();
      });
      settle();

      // Pressing the pill is a request to be taken there, so it recentres rather
      // than deciding the nudge was close enough.
      expect(instance.setViewport).toHaveBeenCalled();
      expect(Math.abs(offsetPx(instance, centreX(start)))).toBeLessThan(
        displaced / 2,
      );
    });
  });

  describe("end of run", () => {
    it("leaves the camera on the node the run finished at", () => {
      const { result, instance } = setup(allNodes, WORKING_ZOOM);

      act(() => {
        result.current.camera.onRunStart(["start"]);
      });
      settle();
      act(() => {
        result.current.camera.onNodeShown("far", "running");
      });
      settle();
      const arrived = looking(instance);

      act(() => {
        result.current.camera.onNodeShown("far", "success");
        result.current.camera.onRunSettled();
      });
      settle();

      // No pulling back out to the whole graph: the run is still being watched at
      // the zoom it started at — to within the tolerance the camera calls "stopped",
      // because getting there involved a crane move out and back.
      expect(instance.current.zoom).toBeCloseTo(WORKING_ZOOM, 2);
      expect(looking(instance).x).toBeCloseTo(arrived.x, -2);
      expect(result.current.isFollowing).toBe(false);
    });

    it("still arrives when the run finished before the camera did", () => {
      const { result, instance } = setup(allNodes, WORKING_ZOOM);

      act(() => {
        result.current.camera.onRunStart(["start"]);
        result.current.camera.onNodeShown("mid", "running");
      });
      // Over almost at once — without the settling pass the camera would be left
      // holding on the entry point with the actual result off the edge.
      frames(80);
      act(() => {
        result.current.camera.onNodeShown("mid", "success");
        result.current.camera.onRunSettled();
      });
      settle();

      expect(Math.abs(offsetPx(instance, centreX(third)))).toBeLessThan(
        CANVAS.width / 2,
      );
      expect(result.current.isFollowing).toBe(false);
    });

    it("lets go immediately when the user already has the camera", () => {
      const { result, instance } = setup(allNodes, WORKING_ZOOM);

      act(() => {
        result.current.camera.onRunStart(["start"]);
      });
      frames(100);
      act(() => {
        result.current.onViewportInteraction(new MouseEvent("mousedown"));
      });
      const taken = instance.current;

      act(() => {
        result.current.camera.onRunSettled();
      });
      settle();

      expect(result.current.isFollowing).toBe(false);
      expect(instance.current).toEqual(taken);
    });

    it("does not carry anything into the next run", () => {
      const { result, instance } = setup(allNodes, WORKING_ZOOM);

      act(() => {
        result.current.camera.onRunStart(["far"]);
      });
      settle();
      act(() => {
        result.current.camera.onRunSettled();
      });
      settle();

      act(() => {
        result.current.camera.onRunStart(["start"]);
      });
      settle();

      expect(Math.abs(offsetPx(instance, centreX(start)))).toBeLessThan(
        CANVAS.width / 2,
      );
      expect(instance.current.zoom).toBeCloseTo(WORKING_ZOOM, 2);
    });
  });

  it("ignores a node that is not on this canvas", () => {
    const { result, instance } = setup([start], WORKING_ZOOM);

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });
    settle();
    instance.setViewport.mockClear();

    act(() => {
      result.current.camera.onNodeShown("from-a-sub-workflow", "running");
    });
    settle();

    expect(instance.setViewport).not.toHaveBeenCalled();
  });

  it("waits rather than giving up when the canvas has no size yet", () => {
    const instance = makeInstance();
    const { result } = renderHook(() =>
      useRunCamera({
        instanceRef: { current: instance },
        nodesRef: { current: allNodes },
        edgesRef: { current: allEdges },
        containerRef: {
          current: {
            getBoundingClientRect: () => ({ width: 0, height: 0 }) as DOMRect,
          } as HTMLElement,
        },
      }),
    );

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });
    settle();

    expect(instance.setViewport).not.toHaveBeenCalled();
    expect(result.current.isFollowing).toBe(true);
  });
});

/**
 * The workload that broke both previous cameras, at its real shape.
 *
 * Not a synthetic single advancing front — that is exactly the probe that
 * certified the strobing model as fixed. This is the measured shape of the user's
 * workflow: 130 nodes as three long rows that execute concurrently and are tens of
 * columns apart at any instant, one join at the end, and an event landing every
 * hundred milliseconds or so.
 *
 * The reference measurement to beat, taken by frame-differencing a 63-second screen
 * recording of the previous build: 174 discrete camera events, 171 of them
 * single-frame teleports, 86% of frames pixel-identical, 0 zoom changes. Which is
 * to say the camera never panned at all — it cut 2.8 times a second for a minute.
 */
describe("three concurrent branches, tens of columns apart", () => {
  const PER_ROW = 43;
  const ROW_PITCH = 460;
  const DWELL_MS = 200;
  const FRAME_MS = 16;

  /**
   * A row per distinct pace, which is the part that matters.
   *
   * Rows advancing at the same rate stay column-aligned, and a camera alternating
   * between aligned branches barely moves — a workload like that would certify the
   * strobing model as fixed. Real branches call different endpoints, so they diverge:
   * by the end of this run they are more than twenty columns apart, which is the
   * "very different columns at the same moment" the recording showed and the input
   * that made the aim teleport.
   */
  const ROWS = [
    { id: "a", beat: 520 },
    { id: "b", beat: 680 },
    { id: "c", beat: 940 },
  ];

  function buildGraph() {
    const nodes: Node[] = [makeNode("start", 0, ROW_PITCH)];
    const edges: Edge[] = [];

    ROWS.forEach((row, index) => {
      edges.push(link("start", `${row.id}0`));
      for (let step = 0; step < PER_ROW; step += 1) {
        nodes.push(
          makeNode(`${row.id}${step}`, (step + 1) * PITCH, index * ROW_PITCH),
        );
        if (step > 0) {
          edges.push(link(`${row.id}${step - 1}`, `${row.id}${step}`));
        }
      }
      edges.push(link(`${row.id}${PER_ROW - 1}`, "join"));
    });

    nodes.push(makeNode("join", (PER_ROW + 2) * PITCH, ROW_PITCH));
    return { nodes, edges };
  }

  /** Every paced release the choreography would make, in order. */
  function schedule() {
    const events: { at: number; nodeId: string; status: string }[] = [];
    let lastFinish = 0;

    ROWS.forEach((row, index) => {
      for (let step = 0; step < PER_ROW; step += 1) {
        // Offset against each other as well, so consecutive events come from
        // different branches rather than arriving in tidy rounds.
        const lit = index * 90 + row.beat * step;
        events.push({ at: lit, nodeId: `${row.id}${step}`, status: "running" });
        events.push({
          at: lit + DWELL_MS,
          nodeId: `${row.id}${step}`,
          status: "success",
        });
        lastFinish = Math.max(lastFinish, lit + DWELL_MS);
      }
    });

    // The join fires once every row has landed, which is the moment the camera is
    // meant to have been parked waiting for the last of them.
    events.push({ at: lastFinish + 700, nodeId: "join", status: "running" });
    events.push({
      at: lastFinish + 700 + DWELL_MS,
      nodeId: "join",
      status: "success",
    });

    return events.sort((a, b) => a.at - b.at);
  }

  function run() {
    const { nodes, edges } = buildGraph();
    const { result, instance } = setup(nodes, WORKING_ZOOM, edges);
    const events = schedule();
    const screen = screenDiagonalPx(cameraBox);

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });

    let next = 0;
    let previous = looking(instance);
    let biggestStepPx = 0;
    let verticalReversals = 0;
    let heading = 0;
    let movingFrames = 0;
    const zooms: number[] = [];
    /** Which row the camera was following, per frame. Rows diverge in column, so
     * the camera's own x is what says which branch it has committed to. */
    const followed: number[] = [];
    const last = events[events.length - 1];
    const finish = (last ? last.at : 0) + 4000;

    for (let now = 0; now <= finish; now += FRAME_MS) {
      const due: { nodeId: string; status: string }[] = [];
      for (
        let event = events[next];
        event && event.at <= now;
        event = events[next]
      ) {
        due.push(event);
        next += 1;
      }
      act(() => {
        for (const event of due) {
          result.current.camera.onNodeShown(event.nodeId, event.status);
        }
      });
      frames(FRAME_MS);

      const at = looking(instance);
      const stepPx = Math.hypot(at.x - previous.x, at.y - previous.y) * at.zoom;
      biggestStepPx = Math.max(biggestStepPx, stepPx);
      if (stepPx > 0.5) movingFrames += 1;

      // A noise floor, so the last sub-pixel of an ease-out is not counted as the
      // camera changing its mind.
      const way = Math.sign(at.y - previous.y);
      if (Math.abs(at.y - previous.y) > 1 && way !== 0) {
        if (heading !== 0 && way !== heading) verticalReversals += 1;
        heading = way;
      }

      // The branch the camera is following is the one whose live front it can see.
      // Early in the run the rows have not diverged yet and several are in frame at
      // once; which one the camera is "on" is genuinely unanswerable then, so those
      // frames carry the previous answer forward instead of flipping a coin and
      // counting the flip as a handoff.
      const visible = ROWS.flatMap((row, index) => {
        const step = Math.min(PER_ROW - 1, Math.floor(now / row.beat));
        const frontX = (step + 1) * PITCH + 140;
        return Math.abs((frontX - at.x) * at.zoom) < CANVAS.width / 2
          ? [index]
          : [];
      });
      followed.push(
        visible.length === 1
          ? visible[0]!
          : (followed[followed.length - 1] ?? -1),
      );

      zooms.push(at.zoom);
      previous = at;
    }

    act(() => {
      result.current.camera.onRunSettled();
    });
    settle();

    return {
      seconds: finish / 1000,
      biggestStepPx,
      ceilingPx: (CROSS_PAN_SCREENS_PER_S * screen * FRAME_MS) / 1000,
      verticalReversals,
      movingFrames,
      totalFrames: Math.floor(finish / FRAME_MS) + 1,
      followed,
      zooms,
    };
  }

  it("never cuts, at any point in the whole run", () => {
    // The headline regression. Every frame's displacement has to be one a camera
    // move could plausibly produce, which is what "171 single-frame teleports" was
    // not.
    const measured = run();
    expect(measured.biggestStepPx).toBeLessThanOrEqual(measured.ceilingPx + 1);
  });

  it("does not hunt up and down", () => {
    // 133 vertical direction reversals in 63 seconds is what one shared engage
    // latch produced: X was permanently engaged on a left-to-right run, so Y was
    // too, and every wobble in the branch's vertical spread got chased.
    const measured = run();
    expect(measured.verticalReversals / measured.seconds).toBeLessThan(0.5);
  });

  it("watches every branch, one at a time", () => {
    // The behaviour asked for, and the assertion that would have caught the old
    // model outright: commit to a branch, follow it, and change branch only when it
    // has nothing left to show. Rows here run at different paces and so end at
    // different times, which is what creates the handoffs.
    const measured = run();
    const held = [0, 1, 2].map(
      (row) => measured.followed.filter((seen) => seen === row).length,
    );

    // Every branch gets a real turn alone in frame, not a glance. (The rest of the
    // run is the opening stretch, where the rows have not yet diverged enough for
    // the question to have an answer.)
    for (const frames of held) {
      expect(frames / measured.totalFrames).toBeGreaterThan(0.1);
    }

    // And it settles on one at a time. A branch has to hold the camera for half a
    // second to count as a change, so a frame of ambiguity where two rows are
    // level is not a handoff — but 174 of them in a minute could never pass this.
    const debounce = Math.round(500 / FRAME_MS);
    let handoffs = 0;
    let current = -1;
    for (let at = 0; at + debounce < measured.followed.length; at += 1) {
      const candidate = measured.followed[at];
      if (candidate === undefined || candidate === current) continue;
      const settled = measured.followed
        .slice(at, at + debounce)
        .every((seen) => seen === candidate);
      if (!settled) continue;

      // The run resolving from "several branches in frame" to one is not a handoff
      // — the camera did not move, the branches did.
      if (current !== -1 && candidate !== -1) handoffs += 1;
      current = candidate;
    }

    // One per branch that ends, and no more. The model this replaced changed where
    // it was looking 174 times in 63 seconds.
    expect(handoffs).toBeGreaterThan(0);
    expect(handoffs).toBeLessThanOrEqual(3);
  });

  it("keeps the run readable, and pulls back only to travel", () => {
    const measured = run();
    const readable = measured.zooms.filter((zoom) => zoom >= MIN_READABLE_ZOOM);

    // The working zoom is never allowed below `MIN_READABLE_ZOOM` and never rises
    // within a run, so time spent under that floor is exactly the crane moves and
    // nothing else — which makes this an exact count rather than a heuristic one.
    expect(readable.length / measured.zooms.length).toBeGreaterThan(0.85);
    expect(Math.max(...measured.zooms)).toBeLessThanOrEqual(
      WORKING_ZOOM + 1e-6,
    );

    let craneMoves = 0;
    let travelling = false;
    for (const zoom of measured.zooms) {
      if (!travelling && zoom < MIN_READABLE_ZOOM * 0.98) {
        travelling = true;
        craneMoves += 1;
      } else if (travelling && zoom >= MIN_READABLE_ZOOM) {
        travelling = false;
      }
    }

    // One per branch handoff, and no more: the camera commits to a branch and stays
    // there. The model this replaced changed where it was looking 174 times.
    expect(craneMoves).toBeGreaterThan(0);
    expect(craneMoves).toBeLessThanOrEqual(4);
  });

  it("actually moves — it is following the run, not ignoring it", () => {
    // The counterweight to every assertion above, which a camera that never moved
    // would also pass. 86% of frames were pixel-identical before, because the whole
    // motion budget went into cuts.
    const measured = run();
    expect(measured.movingFrames / measured.totalFrames).toBeGreaterThan(0.3);
  });
});
