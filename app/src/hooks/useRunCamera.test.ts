import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Node, Viewport } from "reactflow";
import useRunCamera from "./useRunCamera";
import { centreOf, COMFORT_ZOOM, MIN_READABLE_ZOOM } from "../utils/runCamera";
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

function setup(nodes = allNodes, zoom = OVERVIEW_ZOOM) {
  const instance = makeInstance(zoom);
  const container = {
    getBoundingClientRect: () =>
      ({ width: CANVAS.width, height: CANVAS.height }) as DOMRect,
  } as HTMLElement;

  const rendered = renderHook(() =>
    useRunCamera({
      instanceRef: { current: instance },
      nodesRef: { current: nodes },
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
    const { result, instance } = setup([...wide, neighbour], WORKING_ZOOM);

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
    const { result, instance } = setup(allNodes, WORKING_ZOOM);

    act(() => {
      result.current.camera.onRunStart(["start"]);
    });
    settle();

    act(() => {
      result.current.camera.onNodeShown("far", "running");
    });
    settle();

    // On screen, and left of centre with the canvas it is heading into in view.
    const offset = offsetPx(instance, centreX(faraway));
    expect(Math.abs(offset)).toBeLessThan(CANVAS.width / 2);
    expect(offset).toBeLessThan(0);
  });

  it("cuts to a branch too far away to pan to", () => {
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
    settle();

    // One write of arbitrary displacement, rather than a second and a half of
    // sliding across canvas with nothing on it.
    expect(instance.setViewport.mock.calls.length).toBe(1);
    expect(Math.abs(instance.current.x - from.x)).toBeGreaterThan(CANVAS.width);
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

      // No pulling back out to the whole graph: the zoom is untouched and the
      // camera is still where the run ended.
      expect(instance.current.zoom).toBeCloseTo(WORKING_ZOOM, 6);
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
      expect(instance.current.zoom).toBeCloseTo(WORKING_ZOOM, 6);
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
