import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { Node, Rect, Viewport } from "reactflow";
import {
  CanvasCornerGutter,
  CanvasToolbarBand,
  MiniMapSize,
} from "../constants/CanvasChrome";
import { NODE_FALLBACK_HEIGHT, NODE_FALLBACK_WIDTH } from "../utils/autoLayout";
import { isTerminalStatus } from "../utils/runChoreography";
import {
  boundsOf,
  framedSubset,
  framingFor,
  moveDurationMs,
  needsMove,
  REST_AFTER_MOVE_MS,
  RETARGET_COALESCE_MS,
} from "../utils/runCamera";
import type { CameraViewport } from "../types/CameraViewport";
import type { RunCameraHandle } from "../types/RunCameraHandle";

/** The slice of the ReactFlow instance the camera drives. Narrow on purpose:
 * the canvas captures the instance through `onInit`, and this says exactly what
 * is asked of it. */
interface RunCameraInstance {
  setCenter: (
    x: number,
    y: number,
    options: { zoom: number; duration: number },
  ) => void;
  getViewport: () => Viewport;
}

interface UseRunCameraParams {
  instanceRef: MutableRefObject<RunCameraInstance | null>;
  /** Live canvas nodes, as a ref: the camera reads positions on its own timer,
   * and must not be rebuilt every time a node repaints. */
  nodesRef: MutableRefObject<Node[]>;
  /** The element the flow is drawn in — measured for its on-screen size. */
  containerRef: RefObject<HTMLElement | null>;
}

interface UseRunCameraResult {
  camera: RunCameraHandle;
  /** A run is being followed — whether or not the user has taken over. */
  isFollowing: boolean;
  /** The user moved the camera mid-run; following is paused until resumed. */
  isSuspended: boolean;
  suspend: () => void;
  resume: () => void;
  /** For ReactFlow's `onMoveStart`. */
  onViewportInteraction: (event: MouseEvent | TouchEvent | null) => void;
}

/** Cameras are motion, and motion is the thing a reduced-motion preference is
 * about — but refusing to move at all would hide the run rather than calm it.
 * The compromise is a cut instead of a glide, decided per move so a preference
 * changed mid-session is honoured. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function readViewportBox(element: HTMLElement | null): CameraViewport | null {
  if (!element) return null;

  const { width, height } = element.getBoundingClientRect();
  // Mid-mount, or a collapsed pane: there is no meaningful framing to compute.
  if (width < 1 || height < 1) return null;

  return {
    width,
    height,
    insetTop: CanvasToolbarBand,
    // The minimap is the tallest fixture on the canvas floor, and the band it
    // occupies is derived the same way `CanvasActionsBottom` derives its own.
    insetBottom: MiniMapSize.height + CanvasCornerGutter * 2,
  };
}

/**
 * Points the camera at whatever the run is currently doing.
 *
 * The active set is built from the *paced* releases rather than the runner's
 * events, so the camera arrives with the light rather than ahead of it, and it
 * is a set rather than a node because a fan-out lights several branches at once.
 * All of the geometry lives in `utils/runCamera`; what is here is the clock, the
 * bookkeeping, and the rule that the user always wins:
 *
 * - a run starting engages following and glides in from wherever the user was,
 *   though only as far as it has to: a viewport that already reads well is
 *   panned within rather than rescaled;
 * - a hand on the canvas suspends it, and nothing re-engages it but the user;
 * - the end of the playback releases it and leaves the camera where the run
 *   finished, because the alternative — pulling back out to frame the whole
 *   graph — undoes the arrival on every single run, and a workflow gets run
 *   over and over. The overview is one click away on the controls.
 */
export default function useRunCamera({
  instanceRef,
  nodesRef,
  containerRef,
}: UseRunCameraParams): UseRunCameraResult {
  const [isFollowing, setIsFollowing] = useState(false);
  const [isSuspended, setIsSuspended] = useState(false);

  // The same two facts as refs. Every decision below is made inside a timer or
  // an event handler, where the state values would be a render behind.
  const followingRef = useRef(false);
  const suspendedRef = useRef(false);

  /** Nodes currently shown as working, and how recently each lit up. Recency is
   * what decides who the camera keeps when it cannot frame them all. */
  const activeRef = useRef<Map<string, number>>(new Map());
  const seqRef = useRef(0);

  /**
   * What to frame when nothing is running.
   *
   * Between steps the active set is legitimately empty — a node finishes a beat
   * before its successor starts — and the entry point is emptier still, released
   * as `success` without ever being shown working, so it would never enter the
   * active set at all. Holding on the last thing shown covers both: it is where
   * the eye already is, and it is the only target the opening move has.
   */
  const holdRef = useRef<readonly string[]>([]);

  /**
   * When the camera is next allowed to move: the end of the move in flight plus
   * a beat of stillness.
   *
   * A glide that is retargeted while it is still running never arrives — the
   * viewport just drifts continuously for as long as the run lasts, which is the
   * difference between a camera and a slow pan across the whole workflow. This
   * makes every move finish, and be seen to finish.
   */
  const restUntilRef = useRef(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** The framing set, most-recently-lit first, as rectangles in flow space. */
  const collectRects = useCallback((): Rect[] => {
    const active = activeRef.current;
    const ids =
      active.size > 0
        ? [...active.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([nodeId]) => nodeId)
        : holdRef.current;
    if (ids.length === 0) return [];

    const byId = new Map(nodesRef.current.map((node) => [node.id, node]));
    const rects: Rect[] = [];

    for (const id of ids) {
      const node = byId.get(id);
      // Deleted mid-run, or not in this canvas at all (a sub-workflow's node
      // arriving on the parent's stream) — nothing to point at.
      if (!node) continue;

      const position = node.positionAbsolute ?? node.position;
      if (!position) continue;

      rects.push({
        x: position.x,
        y: position.y,
        // ReactFlow fills these in once it has measured; a node still waiting
        // for its first `dimensions` change gets the layout's own guess.
        width: node.width ?? NODE_FALLBACK_WIDTH,
        height: node.height ?? NODE_FALLBACK_HEIGHT,
      });
    }

    return rects;
  }, [nodesRef]);

  /**
   * Point the camera at the current framing set, if it owes it a move.
   *
   * - `scheduled` is the ordinary case: the deadzone may say the action is
   *   close enough, and a move still in flight is waited out.
   * - `settling` is the last move of a run, which does not queue behind a rest
   *   because there will be no later chance to make it.
   * - `resumed` is the user pressing the pill, which is a request to be taken
   *   there and so overrules both.
   */
  const retarget = useCallback(
    (mode: "scheduled" | "settling" | "resumed" = "scheduled") => {
      clearTimer();
      if (!followingRef.current || suspendedRef.current) return;

      const instance = instanceRef.current;
      if (!instance) return;

      const box = readViewportBox(containerRef.current);
      if (!box) return;

      const rects = collectRects();
      if (rects.length === 0) return;

      const bounds = boundsOf(framedSubset(rects, box));
      if (!bounds) return;

      // Wait out the last move rather than interrupting it. Re-booked, not
      // dropped: whatever is lit when the camera is free again is what it wants,
      // and by then it may well be somewhere else entirely.
      const now = Date.now();
      if (mode === "scheduled" && now < restUntilRef.current) {
        timerRef.current = setTimeout(
          () => retarget(),
          restUntilRef.current - now,
        );
        return;
      }

      const viewport = instance.getViewport();
      const target = framingFor(bounds, box, viewport.zoom);

      // Still inside the part of the frame the camera is willing to ignore.
      if (mode !== "resumed" && !needsMove(bounds, target, viewport, box)) {
        return;
      }

      const duration = moveDurationMs(
        target,
        viewport,
        box,
        prefersReducedMotion(),
      );
      restUntilRef.current = now + duration + REST_AFTER_MOVE_MS;

      instance.setCenter(target.x, target.y, { zoom: target.zoom, duration });
    },
    [clearTimer, collectRects, containerRef, instanceRef],
  );

  /**
   * Book one move for the end of the current coalescing window.
   *
   * A fixed window, not a reset-on-every-event debounce: `drain` releases a
   * whole batch synchronously, so several branches lighting up arrive in one
   * tick and must produce one move — but a steady stream of releases must not
   * be able to postpone the camera indefinitely.
   */
  const scheduleRetarget = useCallback(() => {
    if (!followingRef.current || suspendedRef.current) return;
    if (timerRef.current !== null) return;

    timerRef.current = setTimeout(() => retarget(), RETARGET_COALESCE_MS);
  }, [retarget]);

  const suspend = useCallback(() => {
    if (!followingRef.current || suspendedRef.current) return;

    clearTimer();
    suspendedRef.current = true;
    setIsSuspended(true);
  }, [clearTimer]);

  const resume = useCallback(() => {
    if (!followingRef.current || !suspendedRef.current) return;

    suspendedRef.current = false;
    setIsSuspended(false);
    retarget("resumed");
  }, [retarget]);

  const onViewportInteraction = useCallback(
    (event: MouseEvent | TouchEvent | null) => {
      // ReactFlow reports its own d3 transitions with no source event, so a
      // null here is the camera hearing itself. Anything else is a hand on the
      // canvas — including one that grabs it mid-glide, which is exactly when
      // someone decides they would rather look somewhere else.
      if (!event) return;
      suspend();
    },
    [suspend],
  );

  const camera = useMemo<RunCameraHandle>(() => {
    return {
      onRunStart: (entryNodeIds) => {
        activeRef.current.clear();
        seqRef.current = 0;
        // Entry points are the opening target but never join the active set:
        // they are released as `success`, so they are something to look at
        // rather than something to watch.
        holdRef.current = [...entryNodeIds];
        restUntilRef.current = 0;
        followingRef.current = true;
        suspendedRef.current = false;
        setIsFollowing(true);
        setIsSuspended(false);

        scheduleRetarget();
      },

      onNodeShown: (nodeId, status) => {
        if (!followingRef.current) return;

        // Tracked even while suspended, so resuming lands on the live front
        // rather than on wherever the run had got to when the user took over.
        if (isTerminalStatus(status)) {
          activeRef.current.delete(nodeId);
          holdRef.current = [nodeId];
        } else {
          seqRef.current += 1;
          activeRef.current.set(nodeId, seqRef.current);
        }

        scheduleRetarget();
      },

      onRunSettled: () => {
        // One last look at where it ended, and only if that is not already on
        // screen — which after a run long enough to follow, it usually is. This
        // is what the end-of-run fit used to be for, minus the part that hurt:
        // a short run can finish while the opening move is still arriving, and
        // without this the camera would be left holding on the entry point with
        // the actual result off the edge. It goes through the same framing as
        // every other move, so it keeps the zoom it has: it can pan to the
        // result but never pull back out to the overview, which is what made
        // every run a round trip.
        // Also clears any booked retarget, so nothing lands after the run.
        retarget("settling");

        followingRef.current = false;
        suspendedRef.current = false;
        activeRef.current.clear();
        holdRef.current = [];
        restUntilRef.current = 0;
        setIsFollowing(false);
        setIsSuspended(false);
      },
    };
  }, [clearTimer, retarget, scheduleRetarget]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    camera,
    isFollowing,
    isSuspended,
    suspend,
    resume,
    onViewportInteraction,
  };
}
