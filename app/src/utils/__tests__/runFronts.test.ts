import { describe, it, expect } from "vitest";
import {
  ADVANCE_GRACE_MS,
  causalFront,
  chooseSubject,
  createFronts,
  frontOutlook,
  frontsSettled,
  liveFront,
  nextHandoffAt,
  noteNode,
  resolveFrontId,
  SUBJECT_MIN_MS,
  SUBJECT_PATIENCE_MS,
} from "../runFronts";
import type { RunFrontsState } from "../../types/RunFrontsState";

/** A clock late enough that every event in these fixtures has already happened,
 * but early enough that nothing has aged out. Where the exact moment matters a
 * test passes its own. */
const NOW = 100;

function edge(source: string, target: string) {
  return { source, target };
}

/** Canvas positions for a fixture, as `{ id: [x, y] }`. Tests that say nothing
 * about layout pass none, which makes every distance zero. */
function laidOut(spots: Record<string, readonly [number, number]>) {
  return Object.entries(spots).map(([id, [x, y]]) => ({
    id,
    position: { x, y },
  }));
}

/**
 * The shape of the workflow that broke the previous camera: one start, three long
 * rows that run concurrently, one join at the end.
 */
function threeRows(length: number) {
  const edges = [edge("start", "a0"), edge("start", "b0"), edge("start", "c0")];
  for (const row of ["a", "b", "c"]) {
    for (let step = 1; step < length; step += 1) {
      edges.push(edge(`${row}${step - 1}`, `${row}${step}`));
    }
    edges.push(edge(`${row}${length - 1}`, "join"));
  }
  return edges;
}

/** Light a node up and finish it, the way the choreography releases one. */
function ran(state: RunFrontsState, nodeId: string, at: number): void {
  noteNode(state, nodeId, true, at);
  noteNode(state, nodeId, false, at);
}

function frontOf(state: RunFrontsState, nodeId: string): number {
  const record = state.nodes.get(nodeId);
  if (!record) throw new Error(`${nodeId} was never shown`);
  return resolveFrontId(state, record.frontId);
}

describe("branch identity", () => {
  it("opens a front at an entry point", () => {
    const state = createFronts([edge("start", "a")]);
    ran(state, "start", 0);

    expect(state.fronts.size).toBe(1);
    expect(frontOf(state, "start")).toBe(1);
  });

  it("keeps a straight chain on one front", () => {
    const state = createFronts([edge("a", "b"), edge("b", "c")]);
    ran(state, "a", 0);
    ran(state, "b", 100);
    ran(state, "c", 200);

    expect(state.fronts.size).toBe(1);
    expect(frontOf(state, "c")).toBe(frontOf(state, "a"));
  });

  it("opens a front per extra child of a fan-out", () => {
    // The whole reason fronts exist: from here on these are three things
    // happening at once, and a camera can watch one of them.
    const state = createFronts(threeRows(3));
    ran(state, "start", 0);
    noteNode(state, "a0", true, 10);
    noteNode(state, "b0", true, 20);
    noteNode(state, "c0", true, 30);

    const fronts = new Set(["a0", "b0", "c0"].map((id) => frontOf(state, id)));
    expect(fronts.size).toBe(3);
    // One of them continues the start node's front rather than all three
    // abandoning it — the run did not stop and start, it split.
    expect(fronts.has(frontOf(state, "start"))).toBe(true);
  });

  it("folds fronts back into one at a join", () => {
    const state = createFronts(threeRows(2));
    ran(state, "start", 0);
    for (const row of ["a", "b", "c"]) {
      ran(state, `${row}0`, 100);
      ran(state, `${row}1`, 200);
    }
    const before = ["a1", "b1", "c1"].map((id) => frontOf(state, id));
    expect(new Set(before).size).toBe(3);

    ran(state, "join", 300);

    // Every branch's id now resolves to the same place, so a camera following any
    // of them simply carries on through the merge.
    const after = new Set(before.map((id) => resolveFrontId(state, id)));
    expect(after.size).toBe(1);
    expect(after.has(frontOf(state, "join"))).toBe(true);
  });

  it("carries the absorbed branches' nodes into the survivor", () => {
    const state = createFronts(threeRows(2));
    ran(state, "start", 0);
    for (const row of ["a", "b", "c"]) {
      ran(state, `${row}0`, 100);
      ran(state, `${row}1`, 200);
    }
    ran(state, "join", 300);

    const front = liveFront(state, frontOf(state, "join"))!;
    expect(front.nodeIds).toContain("a1");
    expect(front.nodeIds).toContain("b1");
    expect(front.nodeIds).toContain("c1");
  });

  it("never moves a node from one front to another", () => {
    const state = createFronts([edge("a", "b")]);
    noteNode(state, "a", true, 0);
    const lit = frontOf(state, "a");
    noteNode(state, "a", false, 500);
    expect(frontOf(state, "a")).toBe(lit);
  });

  it("continues the one parent it has seen, ignoring branches that never ran", () => {
    // A join whose other input was skipped entirely: nothing to wait for, and no
    // reason to treat arriving there as a new place.
    const state = createFronts([edge("a", "j"), edge("dead", "j")]);
    ran(state, "a", 0);
    noteNode(state, "j", true, 100);

    expect(frontOf(state, "j")).toBe(frontOf(state, "a"));
  });
});

describe("which branch of a fan-out the camera takes", () => {
  it("keeps the parent's front for the near branch, however late it reports", () => {
    // The reported defect: the far branch is listed first and lights up first, and
    // the camera used to set off across the graph for it while a branch a screen
    // away was about to run.
    const state = createFronts(
      [edge("start", "far"), edge("start", "near")],
      laidOut({ start: [0, 0], far: [4000, 0], near: [300, 100] }),
    );
    ran(state, "start", 0);

    noteNode(state, "far", true, 10);
    expect(frontOf(state, "far")).not.toBe(frontOf(state, "start"));

    noteNode(state, "near", true, 20);
    expect(frontOf(state, "near")).toBe(frontOf(state, "start"));
  });

  it("measures the whole branch, not just the first hop", () => {
    // `a` starts closer but immediately runs off across the canvas; `b` starts
    // further out and stays put. A first-hop rule takes `a` and then tours.
    const state = createFronts(
      [edge("s", "a0"), edge("a0", "a1"), edge("s", "b0"), edge("b0", "b1")],
      laidOut({
        s: [0, 0],
        a0: [200, 0],
        a1: [5000, 0],
        b0: [600, 0],
        b1: [700, 0],
      }),
    );
    ran(state, "s", 0);
    noteNode(state, "a0", true, 10);
    noteNode(state, "b0", true, 20);

    expect(frontOf(state, "b0")).toBe(frontOf(state, "s"));
    expect(frontOf(state, "a0")).not.toBe(frontOf(state, "s"));
  });

  it("falls back to the first-listed branch when the layout is unknown", () => {
    const state = createFronts([edge("start", "far"), edge("start", "near")]);
    ran(state, "start", 0);
    noteNode(state, "far", true, 10);

    expect(frontOf(state, "far")).toBe(frontOf(state, "start"));

    // A branch listed later opens its own front, whichever reported first.
    noteNode(state, "near", true, 20);
    expect(frontOf(state, "near")).not.toBe(frontOf(state, "start"));
  });
});

describe("frontOutlook", () => {
  it("reports work in progress", () => {
    const state = createFronts([edge("a", "b")]);
    noteNode(state, "a", true, 0);
    expect(frontOutlook(state, frontOf(state, "a"), NOW).running).toBe(1);
  });

  it("reports a step it is about to take", () => {
    const state = createFronts([edge("a", "b")]);
    ran(state, "a", 0);

    const outlook = frontOutlook(state, frontOf(state, "a"), NOW);
    expect(outlook.running).toBe(0);
    expect(outlook.advancing).toBe(true);
    expect(outlook.waitingFor).toEqual([]);
  });

  it("names what a waiting join is waiting for", () => {
    const state = createFronts(threeRows(2));
    ran(state, "start", 0);
    // Row a runs to the join; rows b and c are still on their first node.
    noteNode(state, "b0", true, 10);
    noteNode(state, "c0", true, 20);
    ran(state, "a0", 30);
    ran(state, "a1", 40);

    const outlook = frontOutlook(state, frontOf(state, "a1"), NOW);
    expect(outlook.running).toBe(0);
    expect(outlook.advancing).toBe(false);
    expect([...outlook.waitingFor].sort()).toEqual(["b1", "c1"]);
  });

  it("says nothing about future joins while it still has work", () => {
    // A front that is working is not waiting on anything, whatever its joins will
    // eventually need — reporting it would hand the camera off mid-request.
    const state = createFronts(threeRows(2));
    ran(state, "start", 0);
    ran(state, "a0", 10);
    noteNode(state, "a1", true, 20);

    const outlook = frontOutlook(state, frontOf(state, "a1"), NOW);
    expect(outlook.running).toBe(1);
    expect(outlook.waitingFor).toEqual([]);
  });

  it("has nothing left to say at the end of a branch", () => {
    const state = createFronts([edge("a", "b")]);
    ran(state, "a", 0);
    ran(state, "b", 100);

    const outlook = frontOutlook(state, frontOf(state, "b"), NOW);
    expect(outlook.running).toBe(0);
    expect(outlook.advancing).toBe(false);
    expect(outlook.waitingFor).toEqual([]);
  });

  it("stops counting as about to move once the step never comes", () => {
    // Otherwise a branch the runner abandoned — or one whose next node is on a path
    // this run did not take — reads as perpetually imminent and keeps the camera
    // parked on it for the rest of the run.
    const state = createFronts([edge("a", "b")]);
    ran(state, "a", 0);

    expect(frontOutlook(state, frontOf(state, "a"), 0).advancing).toBe(true);
    expect(
      frontOutlook(state, frontOf(state, "a"), ADVANCE_GRACE_MS - 1).advancing,
    ).toBe(true);
    expect(
      frontOutlook(state, frontOf(state, "a"), ADVANCE_GRACE_MS).advancing,
    ).toBe(false);
  });

  it("calls a stalled branch stalled rather than blocked", () => {
    // It has gone quiet with a step it could have taken, so there is nothing it is
    // waiting *for*. Naming one would send the camera chasing a cause that does not
    // exist instead of simply going where the run is.
    const state = createFronts([edge("a", "b")]);
    ran(state, "a", 0);

    const outlook = frontOutlook(state, frontOf(state, "a"), ADVANCE_GRACE_MS);
    expect(outlook.advancing).toBe(false);
    expect(outlook.waitingFor).toEqual([]);
  });
});

describe("causalFront", () => {
  it("finds the branch holding a join up, however far upstream it is", () => {
    const state = createFronts(threeRows(6));
    ran(state, "start", 0);
    noteNode(state, "b0", true, 10);
    noteNode(state, "c0", true, 20);
    for (let step = 0; step < 6; step += 1) ran(state, `a${step}`, 30 + step);

    const blocked = frontOf(state, "a5");
    const outlook = frontOutlook(state, blocked, NOW);
    const target = causalFront(state, outlook.waitingFor, blocked, NOW);

    // Five hops up from the node the join wants, and the answer is one of the
    // branches that is actually running.
    expect(target).not.toBeNull();
    expect(target).not.toBe(blocked);
    expect([frontOf(state, "b0"), frontOf(state, "c0")]).toContain(target);
  });

  it("looks past the shared ancestor of a diamond", () => {
    // Both sides of a diamond descend from the same node, so the nearest shown
    // ancestor of the missing input is usually the blocked front itself.
    const state = createFronts([
      edge("split", "left"),
      edge("split", "right"),
      edge("left", "join"),
      edge("right", "join"),
    ]);
    ran(state, "split", 0);
    ran(state, "left", 100);
    noteNode(state, "right", true, 110);

    const blocked = frontOf(state, "left");
    const outlook = frontOutlook(state, blocked, NOW);
    expect(outlook.waitingFor).toEqual(["right"]);
    expect(causalFront(state, outlook.waitingFor, blocked, NOW)).toBe(
      frontOf(state, "right"),
    );
  });

  it("has no answer when the other branch has not started yet", () => {
    // Nothing to hand off to: the camera should stay where it is rather than
    // going somewhere there is nothing to see.
    const state = createFronts([
      edge("split", "left"),
      edge("split", "right"),
      edge("left", "join"),
      edge("right", "join"),
    ]);
    ran(state, "split", 0);
    ran(state, "left", 100);

    const blocked = frontOf(state, "left");
    expect(causalFront(state, ["right"], blocked, NOW)).toBeNull();
  });
});

describe("chooseSubject", () => {
  it("opens on the entry point", () => {
    const state = createFronts(threeRows(3));
    ran(state, "start", 0);
    expect(chooseSubject(state, 0)).toBe(frontOf(state, "start"));
  });

  it("has nothing to choose before the run starts", () => {
    expect(chooseSubject(createFronts(threeRows(3)), 0)).toBeNull();
  });

  it("stays on one branch while it is working, whatever else reports", () => {
    // This is the defect this whole module exists to fix: the previous camera
    // re-picked a target every time a different branch reported an event.
    const state = createFronts(threeRows(20));
    ran(state, "start", 0);
    noteNode(state, "a0", true, 10);
    noteNode(state, "b0", true, 20);
    noteNode(state, "c0", true, 30);

    const subject = chooseSubject(state, 40);
    let now = 40;
    for (let step = 1; step < 15; step += 1) {
      for (const row of ["a", "b", "c"]) {
        now += 220;
        noteNode(state, `${row}${step - 1}`, false, now);
        noteNode(state, `${row}${step}`, true, now);
        expect(chooseSubject(state, now)).toBe(subject);
      }
    }
  });

  it("holds a branch for a minimum before it will consider another", () => {
    const state = createFronts(threeRows(2));
    ran(state, "start", 0);
    noteNode(state, "b0", true, 10);
    // Row a is immediately parked at the join, but the camera has only just
    // arrived, so it is not moving again yet.
    ran(state, "a0", 20);
    ran(state, "a1", 30);

    const subject = chooseSubject(state, 40);
    expect(chooseSubject(state, 40 + SUBJECT_MIN_MS - 1)).toBe(subject);
  });

  it("hands off to the branch a waiting join is waiting for", () => {
    const state = createFronts(threeRows(3));
    ran(state, "start", 0);
    // Row a lights up first and the camera commits to it, then the other two
    // start and row a walks into the join ahead of them.
    noteNode(state, "a0", true, 10);
    const blocked = chooseSubject(state, 20);
    expect(blocked).toBe(frontOf(state, "a0"));

    noteNode(state, "b0", true, 30);
    noteNode(state, "c0", true, 40);
    noteNode(state, "a0", false, 50);
    ran(state, "a1", 60);
    ran(state, "a2", 70);

    expect(frontOutlook(state, blocked, NOW).waitingFor).not.toEqual([]);

    const next = chooseSubject(state, 20 + SUBJECT_MIN_MS);
    expect(next).not.toBe(blocked);
    expect([frontOf(state, "b0"), frontOf(state, "c0")]).toContain(next);
  });

  it("moves on when a branch reaches its end", () => {
    const state = createFronts([
      edge("start", "a"),
      edge("start", "b"),
      edge("a", "aEnd"),
      edge("b", "bEnd"),
    ]);
    ran(state, "start", 0);
    noteNode(state, "a", true, 10);

    const first = chooseSubject(state, 20);
    expect(first).toBe(frontOf(state, "a"));

    noteNode(state, "a", false, 30);
    ran(state, "aEnd", 40);
    noteNode(state, "b", true, 50);

    expect(chooseSubject(state, 20 + SUBJECT_MIN_MS)).toBe(frontOf(state, "b"));
  });

  it("follows a branch through a join without changing subject", () => {
    // A merge is the story continuing. If this reported a new front the camera
    // would fly somewhere on every join, which is the opposite of the point.
    const state = createFronts(threeRows(2));
    ran(state, "start", 0);
    for (const row of ["a", "b", "c"]) {
      ran(state, `${row}0`, 100);
      ran(state, `${row}1`, 200);
    }

    const before = chooseSubject(state, 300);
    ran(state, "join", 400);
    const after = chooseSubject(state, 500);

    expect(resolveFrontId(state, before!)).toBe(after);
    // And the dwell carries over rather than restarting, because nothing moved.
    expect(state.subjectSince).toBeLessThanOrEqual(300);
  });

  it("waits out a slow request rather than leaving mid-flight", () => {
    // Patience is measured from the branch's last news, not from when the camera
    // arrived: a request in flight is the thing worth being there for.
    const state = createFronts(threeRows(4));
    ran(state, "start", 0);
    ran(state, "a0", 10);
    noteNode(state, "b0", true, 20);
    noteNode(state, "a1", true, 30);

    const subject = chooseSubject(state, 40);
    expect(subject).toBe(frontOf(state, "a1"));
    expect(chooseSubject(state, 30 + SUBJECT_PATIENCE_MS - 1)).toBe(subject);
  });

  it("gives up on a branch that has gone quiet for long enough", () => {
    const state = createFronts(threeRows(4));
    ran(state, "start", 0);
    ran(state, "a0", 10);
    noteNode(state, "b0", true, 20);
    noteNode(state, "a1", true, 30);

    const subject = chooseSubject(state, 40);
    expect(subject).toBe(frontOf(state, "a1"));
    expect(chooseSubject(state, 30 + SUBJECT_PATIENCE_MS)).toBe(
      frontOf(state, "b0"),
    );
  });

  it("leaves a branch that simply stopped, with no join to blame", () => {
    // No merge, no assert — row a's chain just ends. The camera should still move
    // on rather than sitting on the last thing that happened there.
    const state = createFronts([
      edge("start", "a"),
      edge("start", "b"),
      edge("b", "b2"),
    ]);
    ran(state, "start", 0);
    noteNode(state, "a", true, 10);
    const first = chooseSubject(state, 20);
    expect(first).toBe(frontOf(state, "a"));

    noteNode(state, "a", false, 30);
    noteNode(state, "b", true, 40);

    expect(chooseSubject(state, 30 + ADVANCE_GRACE_MS)).toBe(
      frontOf(state, "b"),
    );
  });

  it("stays put when there is nowhere better to be", () => {
    const state = createFronts([edge("a", "b")]);
    ran(state, "a", 0);
    ran(state, "b", 100);

    const subject = chooseSubject(state, 200);
    expect(chooseSubject(state, 200 + SUBJECT_MIN_MS * 4)).toBe(subject);
  });

  it("hands off to the nearer of two working branches, not the louder one", () => {
    // Both are running, so both are equally worth watching — and then the only
    // thing left to decide it is what the handoff costs the viewer to sit through.
    const state = createFronts(
      [edge("start", "h"), edge("start", "near"), edge("start", "far")],
      laidOut({
        start: [0, 0],
        h: [100, 0],
        near: [1000, 0],
        far: [9000, 0],
      }),
    );
    ran(state, "start", 0);
    chooseSubject(state, 0);

    // The heir runs out: nothing downstream, so the camera is handed back.
    ran(state, "h", 10);
    noteNode(state, "near", true, 30);
    noteNode(state, "far", true, 40);

    expect(chooseSubject(state, SUBJECT_MIN_MS + 100)).toBe(
      frontOf(state, "near"),
    );
  });
});

describe("nextHandoffAt", () => {
  it("owes nothing while the branch it is on is the only one with life", () => {
    const state = createFronts([edge("a", "b")]);
    noteNode(state, "a", true, 0);
    chooseSubject(state, 0);
    expect(nextHandoffAt(state, NOW)).toBeNull();
  });

  it("owes nothing when the branch it is on has stopped", () => {
    // Then the handoff is decided on the spot, not on a deadline.
    const state = createFronts(threeRows(2));
    ran(state, "start", 0);
    noteNode(state, "b0", true, 10);
    ran(state, "a0", 20);
    ran(state, "a1", 30);
    // The third row runs too, and parks at the join like the first. A row the
    // fixture never starts is a step the fan-out is forever about to take, which
    // is life the camera would owe a deadline to.
    ran(state, "c0", 32);
    ran(state, "c1", 34);
    chooseSubject(state, 40);
    expect(nextHandoffAt(state, NOW)).toBeNull();
  });

  it("schedules the moment patience runs out on a quiet branch", () => {
    const state = createFronts(threeRows(4));
    ran(state, "start", 0);
    noteNode(state, "b0", true, 10);
    ran(state, "a0", 20);
    noteNode(state, "a1", true, 30);
    chooseSubject(state, 40);

    expect(nextHandoffAt(state, NOW)).toBe(30 + SUBJECT_PATIENCE_MS);
  });
});

describe("frontsSettled", () => {
  it("is unsettled while a result is still fading", () => {
    const state = createFronts([edge("a", "b")]);
    ran(state, "a", 1000);
    expect(frontsSettled(state, 1100, 4000)).toBe(false);
  });

  it("settles once every result has faded", () => {
    const state = createFronts([edge("a", "b")]);
    ran(state, "a", 1000);
    expect(frontsSettled(state, 6000, 4000)).toBe(true);
  });

  it("counts a node still working as settled, because its claim is not moving", () => {
    const state = createFronts([edge("a", "b")]);
    noteNode(state, "a", true, 1000);
    expect(frontsSettled(state, 60000, 4000)).toBe(true);
  });
});
