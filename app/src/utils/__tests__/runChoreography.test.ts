import { describe, it, expect } from "vitest";
import {
  createChoreographyState,
  drain,
  enqueue,
  fillDurationFor,
  flush,
  isTerminalStatus,
  readyAt,
  resetChoreography,
  EDGE_FILL_BASE_MS,
  EDGE_FILL_MIN_MS,
  NODE_DWELL_MS,
  type ChoreographyState,
  type PacedEvent,
} from "../runChoreography";

/**
 * The defect this schedules around: a run whose nodes answer in ~200ms emits
 * running and done for the same node inside one frame, so an edge that takes
 * 700ms to traverse is still mid-flight when its target has already finished —
 * and with several of those overlapping, every element on the canvas is
 * animating on its own clock.
 *
 * These tests are about *ordering and gaps*, not about any single duration.
 */

const CHAIN = [
  { source: "start", target: "login" },
  { source: "login", target: "cart" },
];

/** Drain at `now`, returning just the node ids released. */
function releasedAt(state: ChoreographyState, now: number): string[] {
  return drain(state, now).released.map((event) => event.nodeId);
}

function push(state: ChoreographyState, nodeId: string, status: string): void {
  enqueue(state, { nodeId, status } satisfies PacedEvent);
}

describe("run choreography", () => {
  it("shows an entry point the moment the runner reports it", () => {
    const state = createChoreographyState(CHAIN);
    push(state, "start", "running");

    // Nothing upstream, so nothing to travel across and nothing to wait for.
    expect(releasedAt(state, 1000)).toEqual(["start"]);
  });

  it("holds a node's result until it has been visibly working", () => {
    const state = createChoreographyState(CHAIN);
    push(state, "start", "running");
    push(state, "start", "success");

    // Both arrive in the same frame, which is exactly what a fast node does.
    expect(releasedAt(state, 1000)).toEqual(["start"]);
    expect(releasedAt(state, 1000 + NODE_DWELL_MS - 1)).toEqual([]);
    expect(releasedAt(state, 1000 + NODE_DWELL_MS)).toEqual(["start"]);
  });

  it("does not light a node until the traversal into it has landed", () => {
    const state = createChoreographyState(CHAIN);
    push(state, "start", "success");
    push(state, "login", "running");

    const first = drain(state, 1000);
    expect(first.released.map((e) => e.nodeId)).toEqual(["start"]);

    // `login` is gated on the edge, not on when the runner said so.
    expect(releasedAt(state, 1000 + first.fillMs - 1)).toEqual([]);
    expect(releasedAt(state, 1000 + first.fillMs)).toEqual(["login"]);
  });

  it("reports the tempo it is pacing to, so CSS animates over the same gap", () => {
    const state = createChoreographyState(CHAIN);
    push(state, "start", "success");
    push(state, "login", "running");

    const first = drain(state, 1000);
    expect(first.released).toHaveLength(1);
    // The gate it set for `login` is exactly one fill after the release.
    expect(first.nextAt).toBe(1000 + first.fillMs);
  });

  it("lights parallel branches together", () => {
    const state = createChoreographyState([
      { source: "start", target: "cats" },
      { source: "start", target: "pets" },
    ]);
    push(state, "start", "success");
    push(state, "cats", "running");
    push(state, "pets", "running");

    const first = drain(state, 1000);
    expect(first.released.map((e) => e.nodeId)).toEqual(["start"]);

    // Same predecessor, same edge duration — they are one event, visually.
    expect(releasedAt(state, first.nextAt ?? 0)).toEqual(["cats", "pets"]);
  });

  it("measures the traversal from when the source was drawn, not when it ran", () => {
    const state = createChoreographyState(CHAIN);
    push(state, "start", "running");
    push(state, "start", "success");
    push(state, "login", "running");

    drain(state, 1000); // start → running
    const settle = drain(state, 1000 + NODE_DWELL_MS); // start → success
    expect(settle.released.map((e) => e.nodeId)).toEqual(["start"]);

    // Gated off the success *release*, which is late, not off the enqueue.
    expect(settle.nextAt).toBe(1000 + NODE_DWELL_MS + settle.fillMs);
  });

  it("compresses the tempo as the playback falls behind, down to a floor", () => {
    expect(fillDurationFor(0)).toBe(EDGE_FILL_BASE_MS);
    expect(fillDurationFor(2)).toBeLessThan(EDGE_FILL_BASE_MS);
    expect(fillDurationFor(2)).toBeGreaterThan(fillDurationFor(5));
    // A deep graph is allowed to hurry, never to skip: below roughly this a
    // traversal stops reading as travel and is the instant flip again.
    expect(fillDurationFor(500)).toBe(EDGE_FILL_MIN_MS);
    expect(fillDurationFor(-3)).toBe(EDGE_FILL_BASE_MS);
  });

  it("never blocks on a predecessor that the run skipped entirely", () => {
    // `merge` waits on two branches; only one of them ever reports.
    const state = createChoreographyState([
      { source: "a", target: "merge" },
      { source: "dead", target: "merge" },
    ]);
    push(state, "a", "success");
    push(state, "merge", "running");

    const first = drain(state, 1000);
    expect(first.released.map((e) => e.nodeId)).toEqual(["a"]);

    // Head-of-line blocking is only safe while every gate is a finite time
    // derived from something already shown. `dead` never released, so it
    // cannot hold the queue.
    expect(first.nextAt).toBe(1000 + first.fillMs);
    expect(releasedAt(state, first.nextAt ?? 0)).toEqual(["merge"]);
  });

  it("still paces a result that arrives without a working state", () => {
    const state = createChoreographyState(CHAIN);
    push(state, "start", "success");
    push(state, "login", "success");

    const first = drain(state, 1000);
    expect(first.released.map((e) => e.nodeId)).toEqual(["start"]);
    // No `running` to dwell on, but the edge still has to be crossed.
    expect(first.nextAt).toBe(1000 + first.fillMs);
  });

  it("preserves the runner's order across the whole queue", () => {
    const state = createChoreographyState(CHAIN);
    for (const [nodeId, status] of [
      ["start", "running"],
      ["start", "success"],
      ["login", "running"],
      ["login", "success"],
      ["cart", "running"],
      ["cart", "success"],
    ] as const) {
      push(state, nodeId, status);
    }

    const seen: string[] = [];
    let now = 1000;
    for (let step = 0; step < 20; step += 1) {
      const result = drain(state, now);
      for (const event of result.released) {
        seen.push(`${event.nodeId}:${event.status}`);
      }
      if (result.nextAt === null) break;
      now = result.nextAt;
    }

    expect(seen).toEqual([
      "start:running",
      "start:success",
      "login:running",
      "login:success",
      "cart:running",
      "cart:success",
    ]);
    // And the whole thing is over — a queue that stalls would leave events here.
    expect(state.queue).toHaveLength(0);
  });

  it("skips to the end on flush, applying what is left rather than dropping it", () => {
    const state = createChoreographyState(CHAIN);
    push(state, "start", "success");
    push(state, "login", "running");
    push(state, "login", "success");
    drain(state, 1000);

    // Two events are still gated behind the traversal and the dwell.
    expect(state.queue).toHaveLength(2);

    const released = flush(state, 1400).map((event) => event.nodeId);

    // Applied, not discarded: the canvas lands on the picture the playback was
    // working towards, which is the difference between skipping and resetting.
    expect(released).toEqual(["login", "login"]);
    expect(state.queue).toHaveLength(0);
    expect(state.shownFinishedAt.get("login")).toBe(1400);
  });

  it("drops an unfinished playback on reset", () => {
    const state = createChoreographyState(CHAIN);
    push(state, "start", "success");
    push(state, "login", "running");
    drain(state, 1000);

    resetChoreography(state);

    expect(state.queue).toHaveLength(0);
    // The previous run's timings are not context for the next one: `login`
    // is an entry point again as far as the playback is concerned.
    expect(readyAt(state, { nodeId: "login", status: "running" }, 5000)).toBe(5000);
  });

  it("classifies every status the canvas can render", () => {
    for (const status of ["success", "error", "warning", "skipped"]) {
      expect(isTerminalStatus(status)).toBe(true);
    }
    expect(isTerminalStatus("running")).toBe(false);
  });
});
