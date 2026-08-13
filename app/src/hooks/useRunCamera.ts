import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { Edge, Node, Viewport } from "reactflow";
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
  lookingAt,
  planCrossing,
  stepCamera,
  transformOf,
  ATTENTION_POINTS_MAX,
  ATTENTION_WINDOW_MS,
} from "../utils/runCamera";
import {
  chooseSubject,
  createFronts,
  frontsSettled,
  liveFront,
  nextHandoffAt,
  noteNode,
} from "../utils/runFronts";
import type { AttentionPoint } from "../types/AttentionPoint";
import type { CameraMotion } from "../types/CameraMotion";
import type { CameraViewport } from "../types/CameraViewport";
import type { RunCameraHandle } from "../types/RunCameraHandle";
import type { RunFrontsState } from "../types/RunFrontsState";
import type { SeenRunNode } from "../types/SeenRunNode";

/** The slice of the ReactFlow instance the camera drives. Narrow on purpose:
 * the canvas captures the instance through `onInit`, and this says exactly what
 * is asked of it. `setViewport` rather than `setCenter` because the camera runs
 * its own animation — it wants the transform applied, not animated to. */
interface RunCameraInstance {
  setViewport: (viewport: Viewport) => void;
  getViewport: () => Viewport;
}

interface UseRunCameraParams {
  instanceRef: MutableRefObject<RunCameraInstance | null>;
  /** Live canvas nodes, as a ref: the camera reads positions on its own frames,
   * and must not be rebuilt every time a node repaints. */
  nodesRef: MutableRefObject<Node[]>;
  /** Live canvas edges, as a ref. The camera needs the topology to know where one
   * branch ends and the next begins, and which branch a waiting join is waiting
   * for — see `runFronts`. Read once per run, not per frame. */
  edgesRef: MutableRefObject<Edge[]>;
  /** The element the flow is drawn in — measured for its on-screen size. */
  containerRef: RefObject<HTMLElement | null>;
}

interface UseRunCameraResult {
  camera: RunCameraHandle;
  /** A run is being followed — whether or not the user has taken over. */
  isFollowing: boolean;
  /** The user moved the camera mid-run; following is paused until resumed. */
  isSuspended: boolean;
  /**
   * The camera is mid-motion right now, rather than waiting for the run.
   *
   * True from the first frame of a correction or crossing to the frame it comes
   * to rest — so it flips rarely, at the edges of a burst of motion, and is
   * cheap to render from. It exists for the parts of the canvas that should not
   * be repainting sixty times a second while the camera is (the minimap): they
   * freeze on this, and catch up when it goes quiet.
   */
  isCameraMoving: boolean;
  suspend: () => void;
  resume: () => void;
  /** For ReactFlow's `onMoveStart`. */
  onViewportInteraction: (event: MouseEvent | TouchEvent | null) => void;
}

/** Shortest wake the handoff timer will bother setting; below this the deadline
 * has effectively already passed. */
const MIN_WAKE_MS = 16;

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
 * Points the camera at the branch of the run worth watching.
 *
 * The attention set is built from the *paced* releases rather than the runner's
 * events, so the camera arrives with the light rather than ahead of it. The work
 * is split three ways: `runFronts` decides which branch is the subject and when it
 * has handed the camera back, `utils/runCamera` is the physical model that gets
 * the camera there, and what is here is the frame loop, the event bookkeeping, and
 * the rule that the user always wins:
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
 * frames at all; the one decision that has no event to prompt it, handing off from
 * a branch that has gone quiet, gets a timer instead of a spin.
 */
export default function useRunCamera({
  instanceRef,
  nodesRef,
  edgesRef,
  containerRef,
}: UseRunCameraParams): UseRunCameraResult {
  const [isFollowing, setIsFollowing] = useState(false);
  const [isSuspended, setIsSuspended] = useState(false);
  const [isCameraMoving, setIsCameraMoving] = useState(false);

  // The same two facts as refs. Every decision below is made inside a frame or
  // an event handler, where the state values would be a render behind.
  const followingRef = useRef(false);
  const suspendedRef = useRef(false);
  /** The run is over; finish the move in flight and then let go. */
  const endingRef = useRef(false);
  /** Mirror of `isCameraMoving`, read and written on the camera's own frames. */
  const movingRef = useRef(false);

  /**
   * Which branch each node belongs to, which branch is being followed, and every
   * node the camera has been shown lately.
   *
   * Finished nodes stay in here and fade. That is deliberate and it is most of
   * why the motion is smooth: if a node were removed the moment it completed,
   * the aim would change discontinuously in that one frame, and no amount of
   * smoothing downstream recovers from a target that teleports.
   */
  const frontsRef = useRef<RunFrontsState | null>(null);
  /** The subject as of the last frame, so a change of branch can be recognised —
   * that, and only that, is what plans a crane move. */
  const subjectRef = useRef<number | null>(null);

  const motionRef = useRef<CameraMotion | null>(null);
  /** Set when the camera should recentre even though the focus is technically
   * close enough — the opening move, and the user asking to be taken back. */
  const engageRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const wakeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFrameAtRef = useRef(0);
  /** The loop, so the handoff timer can restart it without the two of them having
   * to be defined in terms of each other. */
  const stepRef = useRef<() => void>(() => {});
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
    if (wakeRef.current !== null) {
      clearTimeout(wakeRef.current);
      wakeRef.current = null;
    }
  }, []);

  /**
   * What the camera is attending to on the subject branch, newest first.
   *
   * Only the subject's nodes. That restriction is the fix for the defect this
   * replaced: with every branch in here, any weighting scheme re-picked a winner
   * whenever a different branch reported, and the aim jumped between them at the
   * event rate. Live work outranks finished work, and within each the most recent
   * news comes first, so `points[0]` is where the branch is now.
   */
  const collectPoints = useCallback(
    (subject: number | null, now: number): AttentionPoint[] => {
      const fronts = frontsRef.current;
      const front = fronts ? liveFront(fronts, subject) : null;
      if (!fronts || !front) return [];

      const byId = new Map(nodesRef.current.map((node) => [node.id, node]));
      const ordered = front.nodeIds
        .map((nodeId) => ({ nodeId, record: fronts.nodes.get(nodeId) }))
        .filter(
          (entry): entry is { nodeId: string; record: SeenRunNode } =>
            entry.record !== undefined,
        )
        .sort((a, b) => {
          if (a.record.running !== b.record.running) {
            return a.record.running ? -1 : 1;
          }
          return b.record.seq - a.record.seq;
        });

      const points: AttentionPoint[] = [];
      for (const { nodeId, record } of ordered) {
        if (points.length >= ATTENTION_POINTS_MAX) break;

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

  const release = useCallback(() => {
    cancelFrame();
    followingRef.current = false;
    suspendedRef.current = false;
    endingRef.current = false;
    engageRef.current = false;
    motionRef.current = null;
    writtenRef.current = [];
    frontsRef.current = null;
    subjectRef.current = null;
    movingRef.current = false;
    setIsFollowing(false);
    setIsSuspended(false);
    setIsCameraMoving(false);
  }, [cancelFrame]);

  const suspend = useCallback(() => {
    if (!followingRef.current || suspendedRef.current) return;

    cancelFrame();
    suspendedRef.current = true;
    setIsSuspended(true);
    // The camera stops where it is, mid-glide or not: whatever froze for the
    // motion can thaw, because the viewport is the user's again.
    movingRef.current = false;
    setIsCameraMoving(false);
  }, [cancelFrame]);

  const step = useCallback(() => {
    frameRef.current = null;
    if (!followingRef.current || suspendedRef.current) return;

    const instance = instanceRef.current;
    const box = readViewportBox(containerRef.current);
    const fronts = frontsRef.current;
    const now = Date.now();

    // Mid-mount, or a canvas with no size yet: come back next frame rather than
    // giving up on the run.
    if (!instance || !box || !fronts) {
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

    const subject = chooseSubject(fronts, now);
    const focus = attentionFocus(
      collectPoints(subject, now),
      now,
      attentionRadius(box, motion.zoom),
      lookingAt(motion, box),
    );

    // The branch changed — either a handoff, or the opening move of a run, which
    // is the same problem: the camera is here and the thing to watch is there. A
    // short trip stays a pan; a long one becomes a crane move.
    if (subject !== subjectRef.current) {
      subjectRef.current = subject;
      motion = planCrossing(motion, focus, box);
    }

    motion = stepCamera(motion, focus, box, elapsed, prefersReducedMotion());
    motionRef.current = motion;

    // Moving, as a fact the canvas can render from: true for the whole of a
    // burst of motion, false while the camera waits. Flipped here, on the
    // camera's own frames, so it changes at the edges of motion rather than
    // sixty times a second.
    const moving = !isAtRest(motion);
    if (movingRef.current !== moving) {
      movingRef.current = moving;
      setIsCameraMoving(moving);
    }

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
      : isAtRest(motion) && frontsSettled(fronts, now, ATTENTION_WINDOW_MS);

    if (done) {
      if (endingRef.current) {
        release();
        return;
      }

      // Still following, but there is nothing to integrate. One decision has no
      // event coming to prompt it — leaving a branch that is working but has gone
      // quiet — so it gets a timer, and everything else waits for the run.
      const wakeAt = nextHandoffAt(fronts, now);
      if (wakeAt !== null) {
        wakeRef.current = setTimeout(
          () => {
            wakeRef.current = null;
            if (!followingRef.current || suspendedRef.current) return;
            if (frameRef.current !== null) return;
            lastFrameAtRef.current = 0;
            frameRef.current = requestAnimationFrame(() => stepRef.current());
          },
          Math.max(MIN_WAKE_MS, wakeAt - now),
        );
      }
      return;
    }

    frameRef.current = requestAnimationFrame(step);
  }, [collectPoints, containerRef, instanceRef, release, suspend]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  /** Ask for a frame if one is not already coming. */
  const schedule = useCallback(() => {
    if (!followingRef.current || suspendedRef.current) return;
    if (frameRef.current !== null) return;
    if (wakeRef.current !== null) {
      clearTimeout(wakeRef.current);
      wakeRef.current = null;
    }

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
    // taken back is a request to be recentred whether or not the deadzone agrees
    // — and, if the run has moved on somewhere else entirely while they were
    // looking around, to be flown there rather than dropped there.
    motionRef.current = null;
    writtenRef.current = [];
    subjectRef.current = null;
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
        // Topology is snapshotted per run, like the choreography's: the graph
        // cannot change under a run, and reading it per frame would cost the same
        // answer sixty times a second.
        const fronts = createFronts(edgesRef.current);
        frontsRef.current = fronts;
        subjectRef.current = null;

        // Entry points are the opening target but are never shown working: they
        // are released as `success`, so they are something to look at rather than
        // something to watch, and they fade like any other result.
        for (const nodeId of entryNodeIds) {
          noteNode(fronts, nodeId, false, Date.now());
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
        const fronts = frontsRef.current;
        if (!followingRef.current || endingRef.current || !fronts) return;

        // A node that lit up does not age at all until it finishes; a result
        // starts fading from the moment it appears.
        noteNode(fronts, nodeId, !isTerminalStatus(status), Date.now());

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
  }, [edgesRef, release, schedule]);

  useEffect(() => cancelFrame, [cancelFrame]);

  return {
    camera,
    isFollowing,
    isSuspended,
    isCameraMoving,
    suspend,
    resume,
    onViewportInteraction,
  };
}
