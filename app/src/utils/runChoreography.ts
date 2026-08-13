/**
 * Paces run progress onto the canvas so the picture reads as one story.
 *
 * The runner reports what happened the moment it happens. A node that answers in
 * 200ms goes running→done inside a single frame, and the edge leading into it
 * spends the next half second still travelling towards a node that has already
 * finished — three or four of those overlap and the canvas shows four unrelated
 * animations at four unrelated positions. That is the desync: not one animation
 * being wrong, but every element on its own clock.
 *
 * So the canvas does not mirror the run, it *plays it back*. Events queue in the
 * order the runner emitted them and are released against two rules:
 *
 *   - a node cannot light up until the traversal into it has landed, which takes
 *     one fill duration measured from the moment its last predecessor finished
 *     **on screen** — not from when it really finished;
 *   - a node that lit up stays lit for at least `NODE_DWELL_MS`, so the working
 *     state is something you can see rather than something you can only infer.
 *
 * The playback therefore trails the run. That lag is the point — it is what buys
 * the traversal room to exist — but it must not grow without bound on a long
 * graph, so the tempo compresses as the backlog builds (`fillDurationFor`). The
 * fill duration is published to CSS, so the edge animation and this scheduler
 * always mean the same number.
 *
 * This module is pure: no timers, no DOM. `drain` says what to release now and
 * when to come back. `useRunChoreography` owns the clock.
 */

import type { PacedEvent } from "../types/PacedEvent";
import type { ChoreographyState } from "../types/ChoreographyState";
import type { DrainResult } from "../types/DrainResult";

export type { PacedEvent, ChoreographyState, DrainResult };

/**
 * The custom property the current tempo is published on.
 *
 * It is a CSS variable rather than state because `CustomEdge` is the reader and
 * neither side should re-render just because the tempo changed.
 */
export const EDGE_FILL_CSS_VAR = "--aw-dur-edge-fill";

/** Full-tempo traversal, and the default of `--aw-dur-edge-fill`. */
export const EDGE_FILL_BASE_MS = 700;

/**
 * Floor for the compressed tempo. Below roughly this, a traversal stops reading
 * as travel and goes back to being the instant flip it replaced — so a deep
 * graph is allowed to hurry, never to skip.
 */
export const EDGE_FILL_MIN_MS = 240;

/** Shortest time a node is shown working before its result replaces it. */
export const NODE_DWELL_MS = 180;

/** Statuses that end a node's participation in the run. */
const TERMINAL = new Set(["success", "error", "warning", "skipped"]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/**
 * Tempo as a function of how far the playback has fallen behind.
 *
 * `backlog` is how many events are already waiting behind the one being
 * released. A steady run releases at full duration; a run whose nodes answer
 * faster than the canvas can narrate them tightens up rather than accumulating
 * seconds of trailing animation after the run is over.
 */
export function fillDurationFor(backlog: number): number {
  const pressure = Math.max(0, backlog);
  const scaled = Math.round((EDGE_FILL_BASE_MS * 3) / (3 + pressure));
  return Math.min(EDGE_FILL_BASE_MS, Math.max(EDGE_FILL_MIN_MS, scaled));
}

export function createChoreographyState(
  edges: readonly { source: string; target: string }[],
): ChoreographyState {
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = predecessors.get(edge.target);
    if (sources) sources.push(edge.source);
    else predecessors.set(edge.target, [edge.source]);
  }
  return {
    predecessors,
    queue: [],
    shownWorkingAt: new Map(),
    shownFinishedAt: new Map(),
    fillAfter: new Map(),
  };
}

/**
 * When control finishes crossing into `nodeId`.
 *
 * Only predecessors that have *already been released* count. A branch that never
 * ran, or whose events the runner never emitted, cannot hold the playback up —
 * head-of-line blocking on a queue is only safe while every gate is a finite
 * time computed from something that has already happened.
 */
function arrivesAt(
  state: ChoreographyState,
  nodeId: string,
  now: number,
): number {
  let arrival = 0;
  for (const source of state.predecessors.get(nodeId) ?? []) {
    const departed = state.shownFinishedAt.get(source);
    if (departed === undefined) continue;
    const landed = departed + (state.fillAfter.get(source) ?? EDGE_FILL_BASE_MS);
    if (landed > arrival) arrival = landed;
  }
  // Nothing upstream has been drawn yet: this is an entry point (or a resume),
  // and there is no edge to wait on.
  return arrival === 0 ? now : arrival;
}

/** The earliest this event may be shown. */
export function readyAt(
  state: ChoreographyState,
  event: PacedEvent,
  now: number,
): number {
  if (isTerminalStatus(event.status)) {
    const working = state.shownWorkingAt.get(event.nodeId);
    // A result that arrives without the node ever having been shown working —
    // `skipped`, or a run reloaded mid-flight — still waits for its traversal,
    // but has no working state to dwell on.
    if (working === undefined) return arrivesAt(state, event.nodeId, now);
    return working + NODE_DWELL_MS;
  }
  return arrivesAt(state, event.nodeId, now);
}

/**
 * Release everything whose gate has opened, in the order the runner emitted it.
 *
 * Strict FIFO with head-of-line blocking is deliberate: the runner's ordering is
 * the truth about the run, and evaluating a later event first would let a node
 * light up before the one that triggered it.
 */
export function drain(state: ChoreographyState, now: number): DrainResult {
  const released: PacedEvent[] = [];
  // Falls back to the tempo the queue would use if it released right now, so a
  // drain that releases nothing still reports a usable number.
  let fillMs = fillDurationFor(Math.max(0, state.queue.length - 1));

  for (let head = state.queue[0]; head !== undefined; head = state.queue[0]) {
    const at = readyAt(state, head, now);
    if (at > now) return { released, nextAt: at, fillMs };

    const tempo = fillDurationFor(state.queue.length - 1);
    state.queue.shift();
    // Recorded as `now`, not as the gate time: this is when the change actually
    // reaches the screen, and it is what the next gate has to measure from.
    if (isTerminalStatus(head.status)) {
      state.shownFinishedAt.set(head.nodeId, now);
      state.fillAfter.set(head.nodeId, tempo);
      // Only a finish starts a traversal, so only a finish sets the tempo the
      // caller has to publish.
      fillMs = tempo;
    } else {
      state.shownWorkingAt.set(head.nodeId, now);
    }
    released.push(head);
  }

  return { released, nextAt: null, fillMs };
}

export function enqueue(state: ChoreographyState, event: PacedEvent): void {
  state.queue.push(event);
}

/**
 * Release everything still queued, immediately, gates ignored.
 *
 * This is "skip to the end", not a reset: the events are applied, so the canvas
 * lands on the same picture the playback was working towards. Used when the
 * viewer asks for the rest now — there is nothing left to narrate that they have
 * not already decided they do not want to watch.
 */
export function flush(state: ChoreographyState, now: number): PacedEvent[] {
  const released = state.queue.splice(0, state.queue.length);

  for (const event of released) {
    if (isTerminalStatus(event.status)) {
      state.shownFinishedAt.set(event.nodeId, now);
      state.fillAfter.set(event.nodeId, EDGE_FILL_MIN_MS);
    } else {
      state.shownWorkingAt.set(event.nodeId, now);
    }
  }

  return released;
}

/** Back to quiet: a new run starts from an empty canvas, not a half-told one. */
export function resetChoreography(state: ChoreographyState): void {
  state.queue.length = 0;
  state.shownWorkingAt.clear();
  state.shownFinishedAt.clear();
  state.fillAfter.clear();
}
