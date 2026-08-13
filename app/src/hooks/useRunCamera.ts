import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { Node, Viewport } from "reactflow";
import {
  CanvasCornerGutter,
  CanvasToolbarBand,
  MiniMapSize,
} from "../constants/CanvasChrome";
import { NODE_FALLBACK_HEIGHT, NODE_FALLBACK_WIDTH } from "../utils/autoLayout";
import { isTerminalStatus } from "../utils/runChoreography";
import {
  adoptCamera,
  attentionFocus,
  attentionRadius,
  isAtRest,
  stepCamera,
  transformOf,
  ATTENTION_WINDOW_MS,
} from "../utils/runCamera";
import type { AttentionPoint } from "../types/AttentionPoint";
import type { CameraMotion } from "../types/CameraMotion";
import type { CameraViewport } from "../types/CameraViewport";
import type { RunCameraHandle } from "../types/RunCameraHandle";

/** The slice of the ReactFlow instance the camera drives. Narrow on purpose:
 * the canvas captures the instance through `onInit`, and this says exactly what
 * is asked of it. `setViewport` rather than `setCenter` because the camera runs
 * its own animation — it wants the transform applied, not animated to. */
interface RunCameraInstance {
  setViewport: (viewport: Viewport) => void;
  getViewport: () => Viewport;
}

/** What the camera remembers about one node it has been shown. */
interface SeenNode {
  running: boolean;
  since: number;
  seq: number;
}

interface UseRunCameraParams {
  instanceRef: MutableRefObject<RunCameraInstance | null>;
  /** Live canvas nodes, as a ref: the camera reads positions on its own frames,
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
 * The compromise is a cut instead of a glide, read per frame so a preference
 * changed mid-session is honoured. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Whether this transform is one of the ones the camera put there. Tolerances,
 * not equality: the value is read back after a round trip through d3. */
function wasWrittenHere(live: Viewport, written: readonly Viewport[]): boolean {
  return written.some(
    (mine) =>
      Math.abs(live.x - mine.x) < 0.75 &&
      Math.abs(live.y - mine.y) < 0.75 &&
      Math.abs(live.zoom - mine.zoom) < 1e-4,
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
 * The attention set is built from the *paced* releases rather than the runner's
 * events, so the camera arrives with the light rather than ahead of it. All of
 * the motion lives in `utils/runCamera`, which is a physical model stepped once
 * per frame; what is here is the frame loop, the event bookkeeping, and the rule
 * that the user always wins:
 *
 * - a run starting engages following and glides in from wherever the user was,
 *   though only as far as it has to: a viewport that already reads well is
 *   panned within rather than rescaled;
 * - a hand on the canvas suspends it, and nothing re-engages it but the user;
 * - the end of the playback lets the camera coast to a stop where the run
 *   finished, because pulling back out to frame the whole graph would undo the
 *   arrival on every run, and a workflow gets run over and over. The overview is
 *   one click away on the controls.
 *
 * The loop runs only while there is something to do — while the camera is still
 * moving, or while a finished node is still fading out of the aim — and any event
 * restarts it. A run that spends thirty seconds waiting on one request costs no
 * frames at all.
 */
export default function useRunCamera({
  instanceRef,
  nodesRef,
  containerRef,
}: UseRunCameraParams): UseRunCameraResult {
  const [isFollowing, setIsFollowing] = useState(false);
  const [isSuspended, setIsSuspended] = useState(false);

  // The same two facts as refs. Every decision below is made inside a frame or
  // an event handler, where the state values would be a render behind.
  const followingRef = useRef(false);
  const suspendedRef = useRef(false);
  /** The run is over; finish the move in flight and then let go. */
  const endingRef = useRef(false);

  /**
   * Every node the camera has been shown lately, and when it last mattered.
   *
   * Finished nodes stay in here and fade. That is deliberate and it is most of
   * why the motion is smooth: if a node were removed the moment it completed,
   * the aim would change discontinuously in that one frame, and no amount of
   * smoothing downstream recovers from a target that teleports.
   */
  const seenRef = useRef<Map<string, SeenNode>>(new Map());
  const seqRef = useRef(0);

  const motionRef = useRef<CameraMotion | null>(null);
  /** Set when the camera should recentre even though the focus is technically
   * close enough — the opening move, and the user asking to be taken back. */
  const engageRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  /**
   * The last few transforms the camera itself put there, newest first.
   *
   * Kept so the camera can recognise a viewport it did not set — the zoom and
   * fit-view buttons on ReactFlow's own controls move it without any source
   * event, so `onMoveStart` cannot report them and they would otherwise be
   * silently undone on the next frame. More than one is remembered because
   * `setViewport` applies through a zero-duration d3 transition, so the value
   * read back is a frame or so behind the value written.
   */
  const writtenRef = useRef<Viewport[]>([]);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  /** What the camera is attending to, newest first. Live work outranks finished
   * work, and within each the most recent news comes first; `points[0]` is the
   * anchor everything else is judged against. */
  const collectPoints = useCallback(
    (now: number): AttentionPoint[] => {
      const seen = seenRef.current;
      if (seen.size === 0) return [];

      const byId = new Map(nodesRef.current.map((node) => [node.id, node]));
      const ordered = [...seen.entries()].sort((a, b) => {
        if (a[1].running !== b[1].running) return a[1].running ? -1 : 1;
        return b[1].seq - a[1].seq;
      });

      const points: AttentionPoint[] = [];
      for (const [nodeId, record] of ordered) {
        // Long finished and far outweighed by anything live: keeping it would
        // only cost arithmetic. The first entry is always kept, because with
        // nothing running it is the only thing left to look at.
        if (
          points.length > 0 &&
          !record.running &&
          now - record.since > ATTENTION_WINDOW_MS
        ) {
          continue;
        }

        const node = byId.get(nodeId);
        // Deleted mid-run, or not in this canvas at all (a sub-workflow's node
        // arriving on the parent's stream) — nothing to point at.
        if (!node) continue;

        const position = node.positionAbsolute ?? node.position;
        if (!position) continue;

        points.push({
          x: position.x,
          y: position.y,
          // ReactFlow fills these in once it has measured; a node still waiting
          // for its first `dimensions` change gets the layout's own guess.
          width: node.width ?? NODE_FALLBACK_WIDTH,
          height: node.height ?? NODE_FALLBACK_HEIGHT,
          running: record.running,
          since: record.since,
        });
      }

      return points;
    },
    [nodesRef],
  );

  /** True once nothing is left to fade: every point is either live (a fixed full
   * claim on the camera) or old enough to have none. Until then the aim is still
   * drifting even if no events arrive, so the loop has to keep looking. */
  const attentionSettled = useCallback((now: number): boolean => {
    for (const record of seenRef.current.values()) {
      if (!record.running && now - record.since <= ATTENTION_WINDOW_MS) {
        return false;
      }
    }
    return true;
  }, []);

  const release = useCallback(() => {
    cancelFrame();
    followingRef.current = false;
    suspendedRef.current = false;
    endingRef.current = false;
    engageRef.current = false;
    motionRef.current = null;
    writtenRef.current = [];
    seenRef.current.clear();
    seqRef.current = 0;
    setIsFollowing(false);
    setIsSuspended(false);
  }, [cancelFrame]);

  const suspend = useCallback(() => {
    if (!followingRef.current || suspendedRef.current) return;

    cancelFrame();
    suspendedRef.current = true;
    setIsSuspended(true);
  }, [cancelFrame]);

  const step = useCallback(() => {
    frameRef.current = null;
    if (!followingRef.current || suspendedRef.current) return;

    const instance = instanceRef.current;
    const box = readViewportBox(containerRef.current);
    const now = Date.now();

    // Mid-mount, or a canvas with no size yet: come back next frame rather than
    // giving up on the run.
    if (!instance || !box) {
      lastFrameAtRef.current = now;
      frameRef.current = requestAnimationFrame(step);
      return;
    }

    const elapsed =
      lastFrameAtRef.current > 0 ? now - lastFrameAtRef.current : 0;
    lastFrameAtRef.current = now;

    const live = instance.getViewport();

    let motion = motionRef.current;
    if (!motion) {
      // Adopting the live transform rather than assuming one: the camera is
      // taking over from the user, who may have left the canvas anywhere.
      motion = adoptCamera(live, box, engageRef.current);
      writtenRef.current = [live];
      engageRef.current = false;
    } else if (!wasWrittenHere(live, writtenRef.current)) {
      // Someone else moved it. Almost certainly the zoom or fit-view buttons on
      // ReactFlow's controls, which pass no source event and so never reach
      // `onMoveStart` — but whatever it was, it was not the camera, and the rule
      // is that the camera loses.
      suspend();
      return;
    }

    const focus = attentionFocus(
      collectPoints(now),
      now,
      attentionRadius(box, motion.zoom),
    );

    motion = stepCamera(motion, focus, box, elapsed, prefersReducedMotion());
    motionRef.current = motion;

    const next = transformOf(motion, box);
    const [written] = writtenRef.current;
    // Sub-pixel changes are invisible and a `setViewport` is not free, so the
    // tail of every ease-out costs nothing.
    if (
      !written ||
      Math.abs(next.x - written.x) > 0.25 ||
      Math.abs(next.y - written.y) > 0.25 ||
      Math.abs(next.zoom - written.zoom) > 0.0002
    ) {
      writtenRef.current = [next, ...writtenRef.current].slice(0, 4);
      instance.setViewport(next);
    }

    const done = endingRef.current
      ? isAtRest(motion)
      : isAtRest(motion) && attentionSettled(now);

    if (done) {
      if (endingRef.current) release();
      return;
    }

    frameRef.current = requestAnimationFrame(step);
  }, [
    attentionSettled,
    collectPoints,
    containerRef,
    instanceRef,
    release,
    suspend,
  ]);

  /** Ask for a frame if one is not already coming. */
  const schedule = useCallback(() => {
    if (!followingRef.current || suspendedRef.current) return;
    if (frameRef.current !== null) return;

    // A loop that stopped has no idea how long it was away, and a gap measured
    // from the last frame of the last burst would be integrated as one long
    // step. Start the clock fresh instead.
    lastFrameAtRef.current = 0;
    frameRef.current = requestAnimationFrame(step);
  }, [step]);

  const resume = useCallback(() => {
    if (!followingRef.current || !suspendedRef.current) return;

    suspendedRef.current = false;
    setIsSuspended(false);
    // The user's viewport is now the camera's starting point, and asking to be
    // taken back is a request to be recentred whether or not the deadzone agrees.
    motionRef.current = null;
    writtenRef.current = [];
    engageRef.current = true;
    schedule();
  }, [schedule]);

  const onViewportInteraction = useCallback(
    (event: MouseEvent | TouchEvent | null) => {
      // A null source event is the camera hearing itself. ReactFlow already
      // drops those before `onMoveStart` — its d3 handlers return early without
      // one — so the camera writing the viewport sixty times a second is silent
      // here; this stays as the guard that makes that guarantee ours rather than
      // theirs. Anything else is a hand on the canvas, including one that grabs
      // it mid-glide, which is exactly when someone decides they would rather
      // look somewhere else.
      if (!event) return;
      suspend();
    },
    [suspend],
  );

  const camera = useMemo<RunCameraHandle>(() => {
    return {
      onRunStart: (entryNodeIds) => {
        seenRef.current.clear();
        seqRef.current = 0;
        // Entry points are the opening target but are never shown working: they
        // are released as `success`, so they are something to look at rather than
        // something to watch, and they fade like any other result.
        for (const nodeId of entryNodeIds) {
          seqRef.current += 1;
          seenRef.current.set(nodeId, {
            running: false,
            since: Date.now(),
            seq: seqRef.current,
          });
        }

        followingRef.current = true;
        suspendedRef.current = false;
        endingRef.current = false;
        motionRef.current = null;
        writtenRef.current = [];
        engageRef.current = true;
        setIsFollowing(true);
        setIsSuspended(false);

        schedule();
      },

      onNodeShown: (nodeId, status) => {
        if (!followingRef.current || endingRef.current) return;

        seqRef.current += 1;
        // Both cases are dated now: a result starts fading from the moment it
        // appears, and a node that lit up does not age at all until it finishes,
        // at which point this is overwritten with that moment.
        seenRef.current.set(nodeId, {
          running: !isTerminalStatus(status),
          since: Date.now(),
          seq: seqRef.current,
        });

        // Tracked even while suspended, so resuming lands on the live front
        // rather than on wherever the run had got to when the user took over.
        schedule();
      },

      onRunSettled: () => {
        if (!followingRef.current) return;

        // Nothing more will arrive, so the camera finishes whatever it was doing
        // and lets go. If the user has taken over there is nothing to finish —
        // the camera is not the one holding it.
        endingRef.current = true;
        if (suspendedRef.current) {
          release();
          return;
        }
        schedule();
      },
    };
  }, [release, schedule]);

  useEffect(() => cancelFrame, [cancelFrame]);

  return {
    camera,
    isFollowing,
    isSuspended,
    suspend,
    resume,
    onViewportInteraction,
  };
}
