import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Node, Rect, Viewport } from "reactflow";
import useRunCamera from "./useRunCamera";
import {
  boundsOf,
  framingFor,
  MAX_MOVE_MS,
  REST_AFTER_MOVE_MS,
  RETARGET_COALESCE_MS,
} from "../utils/runCamera";
import {
  CanvasCornerGutter,
  CanvasToolbarBand,
  MiniMapSize,
} from "../constants/CanvasChrome";
import type { CameraViewport } from "../types/CameraViewport";

/**
 * The hook's job is *which* nodes get framed and *when* — the arithmetic of
 * turning a set of rectangles into a viewport is `runCamera`'s, and is tested
 * there. So the expected values here are computed with those same functions:
 * these tests would still fail if the hook framed the wrong set, and would not
 * churn if the framing constants were retuned.
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
const WORKING_ZOOM = 0.7;

function rectOf(node: Node): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? 280,
    height: node.height ?? 120,
  };
}

function framingOf(nodes: Node[], currentZoom: number | null) {
  return framingFor(boundsOf(nodes.map(rectOf))!, cameraBox, currentZoom);
}

function makeNode(id: string, x: number, y = 0): Node {
  return { id, position: { x, y }, width: 280, height: 120, data: {} };
}

/** Fake instance that also *arrives* where it is sent, so the deadzone and the
 * kept-zoom rule are exercised against a viewport that really moved. */
function makeInstance(initialZoom = OVERVIEW_ZOOM) {
  let viewport: Viewport = { x: 0, y: 0, zoom: initialZoom };

  const setCenter = vi.fn(
    (x: number, y: number, options: { zoom: number; duration: number }) => {
      viewport = {
        x: CANVAS.width / 2 - x * options.zoom,
        y: CANVAS.height / 2 - y * options.zoom,
        zoom: options.zoom,
      };
    },
  );

  return { setCenter, getViewport: () => viewport };
}

function makeContainer(): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      width: CANVAS.width,
      height: CANVAS.height,
    }),
  } as unknown as HTMLElement;
}

const start = makeNode("start-1", 0);
/** Close enough to `start` to sit inside the deadzone at a readable zoom. */
const neighbour = makeNode("near", 200);
const first = makeNode("a", 600);
const second = makeNode("b", 600, 900);
const distant = makeNode("far", 30000);

const allNodes = [start, neighbour, first, second, distant];

function setup(nodes: Node[] = allNodes, initialZoom = OVERVIEW_ZOOM) {
  const instance = makeInstance(initialZoom);
  const instanceRef = { current: instance };
  const nodesRef = { current: nodes };
  const containerRef = { current: makeContainer() };

  const view = renderHook(() =>
    useRunCamera({ instanceRef, nodesRef, containerRef }),
  );

  return { ...view, instance };
}

/** Let the coalescing window close and the booked move fire. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(RETARGET_COALESCE_MS + 1);
  });
}

/** …and then let the move finish and the camera's rest elapse, so the next
 * retarget is free to act rather than being deferred. */
function rest() {
  act(() => {
    vi.advanceTimersByTime(MAX_MOVE_MS + REST_AFTER_MOVE_MS + 1);
  });
}

function settleAndRest() {
  settle();
  rest();
}

/** Every zoom the camera has asked for, in order. */
function zoomsOf(instance: ReturnType<typeof makeInstance>): number[] {
  return instance.setCenter.mock.calls.map((call) => call[2].zoom);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRunCamera", () => {
  it("ignores node activity outside a run", () => {
    const { result, instance } = setup();

    act(() => {
      result.current.camera.onNodeShown("a", "running");
    });
    settleAndRest();

    expect(instance.setCenter).not.toHaveBeenCalled();
    expect(result.current.isFollowing).toBe(false);
  });

  it("glides to the entry point when a run starts", () => {
    const { result, instance } = setup();

    act(() => {
      result.current.camera.onRunStart(["start-1"]);
    });
    expect(result.current.isFollowing).toBe(true);
    // Nothing yet — the move waits for the coalescing window.
    expect(instance.setCenter).not.toHaveBeenCalled();

    settle();

    const target = framingOf([start], OVERVIEW_ZOOM);
    expect(instance.setCenter).toHaveBeenCalledTimes(1);
    expect(instance.setCenter).toHaveBeenCalledWith(
      target.x,
      target.y,
      expect.objectContaining({ zoom: target.zoom }),
    );
  });

  it("issues one move for a batch of releases in the same tick", () => {
    const { result, instance } = setup();

    act(() => {
      result.current.camera.onRunStart(["start-1"]);
    });
    settleAndRest();
    instance.setCenter.mockClear();

    // A fan-out: two branches light up inside one drain.
    act(() => {
      result.current.camera.onNodeShown("a", "running");
      result.current.camera.onNodeShown("b", "running");
    });
    settle();

    expect(instance.setCenter).toHaveBeenCalledTimes(1);
  });

  it("frames every branch that is running at once", () => {
    const { result, instance } = setup();

    act(() => {
      result.current.camera.onRunStart(["start-1"]);
    });
    settleAndRest();
    instance.setCenter.mockClear();

    act(() => {
      result.current.camera.onNodeShown("start-1", "success");
      result.current.camera.onNodeShown("a", "running");
      result.current.camera.onNodeShown("b", "running");
    });
    settle();

    // The pair is too tall to hold at the zoom the opening settled on, so this
    // is one of the few moves that is allowed to rescale.
    const target = framingOf([first, second], 1);
    expect(instance.setCenter).toHaveBeenCalledWith(
      target.x,
      target.y,
      expect.objectContaining({ zoom: target.zoom }),
    );
  });

  it("abandons a straggler branch rather than framing the gap", () => {
    const { result, instance } = setup();

    act(() => {
      result.current.camera.onRunStart(["start-1"]);
    });
    settleAndRest();

    // `far` is still running from earlier; `a` is the fresh one.
    act(() => {
      result.current.camera.onNodeShown("far", "running");
    });
    settleAndRest();
    instance.setCenter.mockClear();

    act(() => {
      result.current.camera.onNodeShown("a", "running");
    });
    settle();

    const target = framingOf([first], 1);
    expect(instance.setCenter).toHaveBeenCalledWith(
      target.x,
      target.y,
      expect.objectContaining({ zoom: target.zoom }),
    );
  });

  it("holds on the node that just finished while nothing is running", () => {
    const { result, instance } = setup();

    act(() => {
      result.current.camera.onRunStart(["start-1"]);
      result.current.camera.onNodeShown("start-1", "success");
    });
    settleAndRest();
    instance.setCenter.mockClear();

    // `a` finishes and nothing has started yet: the active set is empty, and the
    // camera should follow it there rather than snap back to Start.
    act(() => {
      result.current.camera.onNodeShown("a", "running");
      result.current.camera.onNodeShown("a", "success");
    });
    settle();

    const target = framingOf([first], 1);
    expect(instance.setCenter).toHaveBeenCalledWith(
      target.x,
      target.y,
      expect.objectContaining({ zoom: target.zoom }),
    );
  });

  describe("holding still", () => {
    it("does not move for a node already on screen", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settleAndRest();
      instance.setCenter.mockClear();

      // Two node-widths away, well inside the frame: watching it is enough.
      act(() => {
        result.current.camera.onNodeShown("near", "running");
      });
      settleAndRest();

      expect(instance.setCenter).not.toHaveBeenCalled();
    });

    it("skips a move it has already made", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
        result.current.camera.onNodeShown("a", "running");
      });
      settleAndRest();
      expect(instance.setCenter).toHaveBeenCalledTimes(1);

      // The same node reported again — the camera is already framing it.
      act(() => {
        result.current.camera.onNodeShown("a", "running");
      });
      settleAndRest();

      expect(instance.setCenter).toHaveBeenCalledTimes(1);
    });

    it("lets a move finish before starting the next one", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settle();
      expect(instance.setCenter).toHaveBeenCalledTimes(1);

      // The run walks on while the opening dolly is still in the air. A camera
      // that retargets now never arrives anywhere — it just drifts continuously.
      act(() => {
        result.current.camera.onNodeShown("far", "running");
      });
      settle();
      expect(instance.setCenter).toHaveBeenCalledTimes(1);

      rest();
      expect(instance.setCenter).toHaveBeenCalledTimes(2);
    });

    it("frames wherever the run got to by the time it is free to move", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settle();
      instance.setCenter.mockClear();

      // Both arrive during the opening move; only the later one is still lit.
      act(() => {
        result.current.camera.onNodeShown("far", "running");
        result.current.camera.onNodeShown("far", "success");
      });
      act(() => {
        result.current.camera.onNodeShown("a", "running");
      });
      rest();

      const target = framingOf([first], 1);
      expect(instance.setCenter).toHaveBeenCalledTimes(1);
      expect(instance.setCenter).toHaveBeenCalledWith(
        target.x,
        target.y,
        expect.objectContaining({ zoom: target.zoom }),
      );
    });
  });

  describe("leaving the zoom alone", () => {
    it("zooms in only when the view is too far out to read", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settle();

      expect(zoomsOf(instance)[0]).toBeGreaterThan(OVERVIEW_ZOOM);
    });

    it("pans without rescaling a viewport that already works", () => {
      const { result, instance } = setup(allNodes, WORKING_ZOOM);

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settleAndRest();

      act(() => {
        result.current.camera.onNodeShown("start-1", "success");
        result.current.camera.onNodeShown("a", "running");
      });
      settleAndRest();

      act(() => {
        result.current.camera.onNodeShown("a", "success");
        result.current.camera.onNodeShown("far", "running");
      });
      settleAndRest();

      // The whole run at the zoom it started at. Re-deriving it every hop is
      // what turned a re-run into a sequence of dolly moves.
      expect(instance.setCenter).toHaveBeenCalled();
      for (const zoom of zoomsOf(instance)) {
        expect(zoom).toBe(WORKING_ZOOM);
      }
    });

    it("still pulls back for a set that will not fit as it is", () => {
      const { result, instance } = setup(allNodes, WORKING_ZOOM);

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
        result.current.camera.onNodeShown("a", "running");
        result.current.camera.onNodeShown("b", "running");
      });
      settle();

      const zooms = zoomsOf(instance);
      expect(zooms[zooms.length - 1]).toBeLessThan(WORKING_ZOOM);
    });
  });

  describe("handing the camera back", () => {
    it("stops following once the user pans, and stays stopped", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settleAndRest();
      instance.setCenter.mockClear();

      act(() => {
        result.current.onViewportInteraction(new MouseEvent("mousedown"));
      });
      expect(result.current.isSuspended).toBe(true);

      act(() => {
        result.current.camera.onNodeShown("a", "running");
      });
      settleAndRest();

      expect(instance.setCenter).not.toHaveBeenCalled();
      expect(result.current.isFollowing).toBe(true);
    });

    it("does not mistake its own transition for a user pan", () => {
      const { result } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settleAndRest();

      act(() => {
        result.current.onViewportInteraction(null);
      });

      expect(result.current.isSuspended).toBe(false);
    });

    it("catches up with the live front when following resumes", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settleAndRest();

      act(() => {
        result.current.suspend();
      });
      // The run keeps going while the user is looking elsewhere.
      act(() => {
        result.current.camera.onNodeShown("a", "running");
      });
      instance.setCenter.mockClear();

      act(() => {
        result.current.resume();
      });

      // Immediate, not booked: the point of pressing resume is to get there.
      const target = framingOf([first], 1);
      expect(result.current.isSuspended).toBe(false);
      expect(instance.setCenter).toHaveBeenCalledWith(
        target.x,
        target.y,
        expect.objectContaining({ zoom: target.zoom }),
      );
    });

    it("takes resume literally even when the target is already framed", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settleAndRest();

      // Suspend and resume without the run moving on: the deadzone would say
      // there is nothing to do, but the user asked to be taken back.
      act(() => {
        result.current.suspend();
      });
      instance.setCenter.mockClear();
      act(() => {
        result.current.resume();
      });

      expect(instance.setCenter).toHaveBeenCalledTimes(1);
    });

    it("suspends only during a run", () => {
      const { result } = setup();

      act(() => {
        result.current.suspend();
      });

      expect(result.current.isSuspended).toBe(false);
    });
  });

  describe("end of run", () => {
    it("leaves the camera on the node the run finished at", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
        result.current.camera.onNodeShown("a", "running");
      });
      settleAndRest();

      const framed = instance.getViewport();
      instance.setCenter.mockClear();

      act(() => {
        result.current.camera.onRunSettled();
      });
      settleAndRest();

      // No parting move of any kind. Pulling back to frame the whole graph
      // undid the arrival on every run, and a workflow gets run over and over.
      expect(instance.setCenter).not.toHaveBeenCalled();
      expect(instance.getViewport()).toEqual(framed);
      expect(result.current.isFollowing).toBe(false);
      expect(result.current.isSuspended).toBe(false);
    });

    it("pans to the result when the run finished off screen", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settleAndRest();
      instance.setCenter.mockClear();

      // A short run can finish while the opening move is still arriving, which
      // would otherwise leave the camera holding on the entry point with the
      // result off the edge.
      act(() => {
        result.current.camera.onNodeShown("a", "running");
        result.current.camera.onNodeShown("a", "success");
        result.current.camera.onRunSettled();
      });

      const target = framingOf([first], 1);
      expect(instance.setCenter).toHaveBeenCalledTimes(1);
      expect(instance.setCenter).toHaveBeenCalledWith(
        target.x,
        target.y,
        expect.objectContaining({ zoom: target.zoom }),
      );
    });

    it("does not let a booked move land after the run is over", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settleAndRest();

      // A final flush releases the tail of the queue and settles in the same
      // turn. Whatever the settling move does, it is the last thing that
      // happens — the retarget the release booked must not fire behind it.
      act(() => {
        result.current.camera.onNodeShown("a", "running");
        result.current.camera.onRunSettled();
      });
      const afterSettle = instance.setCenter.mock.calls.length;
      settleAndRest();

      expect(instance.setCenter.mock.calls.length).toBe(afterSettle);
    });

    it("leaves the result alone when it is already framed", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
        result.current.camera.onNodeShown("a", "running");
      });
      settleAndRest();
      act(() => {
        result.current.camera.onNodeShown("a", "success");
      });
      instance.setCenter.mockClear();

      // The camera followed the run all the way; there is nothing left to show.
      act(() => {
        result.current.camera.onRunSettled();
      });

      expect(instance.setCenter).not.toHaveBeenCalled();
    });

    it("does not pan away from a camera the user took back", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settleAndRest();
      act(() => {
        result.current.onViewportInteraction(new MouseEvent("mousedown"));
        result.current.camera.onNodeShown("a", "running");
      });
      instance.setCenter.mockClear();

      act(() => {
        result.current.camera.onRunSettled();
      });

      expect(instance.setCenter).not.toHaveBeenCalled();
    });

    it("does not carry a rest debt into the next run", () => {
      const { result, instance } = setup();

      act(() => {
        result.current.camera.onRunStart(["start-1"]);
        result.current.camera.onNodeShown("a", "running");
      });
      settle();
      act(() => {
        result.current.camera.onRunSettled();
      });
      instance.setCenter.mockClear();

      // Run again straight away: the opening move must not be held back by the
      // rest owed to the previous run's last hop.
      act(() => {
        result.current.camera.onRunStart(["start-1"]);
      });
      settle();

      expect(instance.setCenter).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps a stable handle so subscriptions are not rebuilt", () => {
    const { result, rerender } = setup();
    const handle = result.current.camera;

    rerender();

    expect(result.current.camera).toBe(handle);
  });
});
