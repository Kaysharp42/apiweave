import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import {
  createChoreographyState,
  drain,
  enqueue as enqueueEvent,
  flush as flushQueue,
  resetChoreography,
  EDGE_FILL_CSS_VAR,
  type ChoreographyState,
  type PacedEvent,
} from "../utils/runChoreography";

/** The token `CustomEdge`'s reveal and its travelling head both animate over. */
const FILL_VAR = EDGE_FILL_CSS_VAR;

/** Cancel a pending pump timer, if one is scheduled. Shared by every place
 * that pre-empts the schedule: enqueuing more work, resetting, and flushing. */
function clearPumpTimer(
  timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
): void {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

/** Run and clear every `whenSettled` callback. Shared by `pump` (the queue
 * drained naturally) and `flush` (the queue was emptied early) — both are
 * "nothing left to wait for" and owe the same callbacks the same thing. */
function drainSettled(settledRef: MutableRefObject<(() => void)[]>): void {
  const callbacks = settledRef.current;
  settledRef.current = [];
  for (const callback of callbacks) callback();
}

/** Published as a CSS custom property, not component state: `CustomEdge`
 * reads it for its own animation duration, and neither side should re-render
 * just because the tempo changed. Free functions, not hooks — they close over
 * nothing React-owned, so there is nothing for `useCallback` to stabilise. */
function setTempo(fillMs: number): void {
  document.documentElement.style.setProperty(FILL_VAR, `${fillMs}ms`);
}

function clearTempo(): void {
  document.documentElement.style.removeProperty(FILL_VAR);
}

interface UseRunChoreographyParams {
  edges: readonly { source: string; target: string }[];
  /** Paint one node. Called in run order, on the playback's schedule. */
  release: (event: PacedEvent) => void;
}

interface UseRunChoreographyResult {
  enqueue: (event: PacedEvent) => void;
  reset: () => void;
  /**
   * Skip to the end — apply everything still queued at once. Unlike `reset`,
   * the canvas lands on the picture the playback was working towards.
   */
  flush: () => void;
  /**
   * Run `callback` once the playback has caught up with everything queued —
   * immediately if it already has. Used to hold back the end-of-run hydration,
   * which repaints every node at once and would otherwise overtake the story
   * still being told.
   */
  whenSettled: (callback: () => void) => void;
}

/**
 * Owns the clock for `runChoreography`.
 *
 * The scheduler decides *what* and *when*; this decides nothing, it just holds
 * the timer, publishes the current tempo to CSS so the edges animate over the
 * interval it is about to wait, and hands released events to `release`.
 */
export default function useRunChoreography({
  edges,
  release,
}: UseRunChoreographyParams): UseRunChoreographyResult {
  /**
   * Topology only — recomputed when the shape of the graph changes, not when a
   * node repaints. Without this the state would be rebuilt on every status
   * update and the playback would forget what it had already shown.
   */
  const topologySignature = useMemo(
    () => edges.map((edge) => `${edge.source}>${edge.target}`).join("|"),
    [edges],
  );

  // Held in a ref, not a dep: `edges` gets a new array identity on every canvas
  // render, and rebuilding the playback that often would be pure churn. Only a
  // change to the wiring itself matters here.
  const topologyRef = useRef(edges);
  topologyRef.current = edges;

  const stateRef = useRef<ChoreographyState>(createChoreographyState(edges));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledRef = useRef<(() => void)[]>([]);
  const releaseRef = useRef(release);
  releaseRef.current = release;

  useEffect(() => {
    // Keep whatever has already been shown; only the wiring changed.
    const previous = stateRef.current;
    const next = createChoreographyState(topologyRef.current);
    next.queue = previous.queue;
    next.shownWorkingAt = previous.shownWorkingAt;
    next.shownFinishedAt = previous.shownFinishedAt;
    next.fillAfter = previous.fillAfter;
    stateRef.current = next;
  }, [topologySignature]);

  const pump = useCallback(() => {
    clearPumpTimer(timerRef);

    const state = stateRef.current;
    const now = Date.now();
    const { released, nextAt, fillMs } = drain(state, now);

    // Before painting, not after: the edges leaving a node that is about to be
    // marked finished start their reveal on this commit, and they have to read
    // the same duration the timer below is about to wait.
    if (released.length > 0) setTempo(fillMs);
    for (const event of released) releaseRef.current(event);

    if (nextAt !== null) {
      timerRef.current = setTimeout(pump, Math.max(0, nextAt - now));
      return;
    }

    drainSettled(settledRef);
  }, []);

  const enqueue = useCallback(
    (event: PacedEvent) => {
      enqueueEvent(stateRef.current, event);
      pump();
    },
    [pump],
  );

  const reset = useCallback(() => {
    clearPumpTimer(timerRef);
    resetChoreography(stateRef.current);
    settledRef.current = [];
    clearTempo();
  }, []);

  /** Skip to the end: apply what is left at once, then settle. */
  const flush = useCallback(() => {
    clearPumpTimer(timerRef);

    for (const event of flushQueue(stateRef.current, Date.now())) {
      releaseRef.current(event);
    }
    clearTempo();

    drainSettled(settledRef);
  }, []);

  const whenSettled = useCallback((callback: () => void) => {
    if (stateRef.current.queue.length === 0) {
      callback();
      return;
    }
    settledRef.current.push(callback);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      document.documentElement.style.removeProperty(FILL_VAR);
    },
    [],
  );

  // Stable, so the callers that keep this in a dependency array (and hand the
  // resulting handler to a live IPC subscription) are not rebuilt per render.
  return useMemo(
    () => ({ enqueue, reset, flush, whenSettled }),
    [enqueue, reset, flush, whenSettled],
  );
}
