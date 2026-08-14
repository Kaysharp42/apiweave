/**
 * Which branch of a run the camera is watching.
 *
 * The camera's aim used to be an average over everything the run had lit up
 * lately. On a workflow laid out as parallel rows that is not one place: three
 * branches run concurrently, tens of columns apart, and averaging them frames the
 * gap between them while any locality rule — a radius, a Gaussian, a nearest-N —
 * re-picks a winner every time a different branch reports. Measured on a 130-node
 * workflow that came out as 2.8 hard cuts per second for a whole minute. No amount
 * of smoothing downstream fixes it, because the *aim* is what teleports.
 *
 * So the camera does not average concurrent branches, it chooses between them, and
 * the graph is what tells it where one branch ends:
 *
 *   - a node with no shown predecessor opens a front (an entry point);
 *   - the first child of a node continues its parent's front;
 *   - any later child of the same node opens a front — that is a fan-out, and from
 *     there on they are two things happening at once;
 *   - a node several fronts arrive at absorbs them into one — that is a join, and
 *     it is the story continuing rather than a reason to look elsewhere, so it
 *     costs the camera no move at all.
 *
 * A front is then held until it hands the camera back, which it does by having
 * nothing left to work on and nowhere to go — it finished, it stalled, or it is
 * parked at a join waiting for a branch that has not arrived. In that last case the
 * camera knows *which* branch is holding it up, because the join says so, and goes
 * to watch that one. Which is the whole trick: the handoff happens at the moment
 * there is nothing left to see here, and it goes to the place the run is actually
 * being decided.
 *
 * Everything here is pure and mutable-by-argument, like `runChoreography`: the
 * hook owns the clock and the event stream, this owns the topology.
 */

import { groupEdgesBy } from "./edgeAdjacency";
import type { RunFront } from "../types/RunFront";
import type { RunFrontOutlook } from "../types/RunFrontOutlook";
import type { RunFrontsState } from "../types/RunFrontsState";
import type { SeenRunNode } from "../types/SeenRunNode";

/**
 * Shortest time the camera stays with a branch before it will consider another.
 *
 * Not a smoothing constant — the handoff rules are already event-driven and
 * quiet. This is the floor that makes ping-ponging unrepresentable rather than
 * merely unlikely: two branches that alternately stall cannot trade the camera
 * faster than this however they interleave, which is what bounds the number of
 * crane moves a run can contain.
 */
export const SUBJECT_MIN_MS = 900;

/**
 * How long the camera will watch a branch that is working but not progressing
 * before it goes to look at one that is.
 *
 * A request in flight has not stopped, and its result is most of why anyone is
 * watching — so a branch holding on a slow call keeps the camera. But a thirty
 * second call should not cost the viewer everything else the run did meanwhile,
 * and a node that finishes while the camera is away is still news when it lands,
 * so the camera can come back to it.
 */
export const SUBJECT_PATIENCE_MS = 4000;

/**
 * How long a branch counts as "about to take its next step" after its last news.
 *
 * `advancing` means a successor's inputs are all in and the choreography simply has
 * not released it yet, which takes at most a fill plus a dwell. Without an expiry it
 * would also mean "and never will": a branch the runner abandoned, or one whose next
 * node is on a path this run did not take, would read as perpetually about to move
 * and hold the camera for the rest of the run. Generous enough to cover the slowest
 * tempo the choreography uses, short enough that a branch which has genuinely
 * stopped is recognised within a beat.
 */
export const ADVANCE_GRACE_MS = 1500;

/** How far upstream to walk looking for the branch a join is waiting on. Any DAG
 * this misses is one where the answer would not have been useful anyway, and the
 * fallback — go where the news is — is a good answer in its own right. */
const CAUSE_WALK_LIMIT = 512;

/** Absorbing always merges a higher front id into a lower one, so the chain is
 * strictly decreasing and terminates; this only bounds the damage if that ever
 * stops being true. */
const MERGE_CHAIN_LIMIT = 64;

export function createFronts(
  edges: readonly { source: string; target: string }[],
): RunFrontsState {
  return {
    successors: groupEdgesBy(edges, "source"),
    predecessors: groupEdgesBy(edges, "target"),
    nodes: new Map(),
    fronts: new Map(),
    extended: new Set(),
    nextFrontId: 1,
    seq: 0,
    subject: null,
    subjectSince: 0,
  };
}

/** The front an id has become, following any joins it has been through. */
export function resolveFrontId(state: RunFrontsState, id: number): number {
  let current = id;
  for (let hops = 0; hops < MERGE_CHAIN_LIMIT; hops += 1) {
    const front = state.fronts.get(current);
    if (!front || front.mergedInto === null) return current;
    current = front.mergedInto;
  }
  return current;
}

/** The front an id has become, as the front itself. */
export function liveFront(
  state: RunFrontsState,
  id: number | null,
): RunFront | null {
  if (id === null) return null;
  return state.fronts.get(resolveFrontId(state, id)) ?? null;
}

function openFront(state: RunFrontsState, now: number): RunFront {
  const front: RunFront = {
    id: state.nextFrontId,
    nodeIds: [],
    running: new Set(),
    lastEventAt: now,
    mergedInto: null,
  };
  state.nextFrontId += 1;
  state.fronts.set(front.id, front);
  return front;
}

/**
 * Fold one front into another at a join.
 *
 * The absorbed front keeps its id resolving to the survivor, so a camera that was
 * following it simply carries on. Its nodes move across so the survivor's recent
 * history is complete — which matters for smoothness rather than for framing: the
 * branch the camera was just watching must not vanish out of the aim in the frame
 * the join lands. The ones too far away to belong lose their claim to the distance
 * gate in `attentionFocus`, which is a fade rather than a deletion.
 */
function absorb(
  state: RunFrontsState,
  fromId: number,
  intoId: number,
  now: number,
): void {
  if (fromId === intoId) return;

  const from = state.fronts.get(fromId);
  const into = state.fronts.get(intoId);
  if (!from || !into) return;

  from.mergedInto = intoId;
  into.nodeIds.push(...from.nodeIds);
  for (const nodeId of from.running) into.running.add(nodeId);
  from.running.clear();
  from.nodeIds.length = 0;
  into.lastEventAt = Math.max(into.lastEventAt, from.lastEventAt, now);
}

/** Which front a node first shown now belongs to — the whole branch grammar, in
 * one function. */
function adoptFront(
  state: RunFrontsState,
  nodeId: string,
  now: number,
): RunFront {
  const parents = (state.predecessors.get(nodeId) ?? []).filter((parentId) =>
    state.nodes.has(parentId),
  );

  // Nothing upstream has been shown: an entry point, or a branch whose start the
  // camera never saw. Either way it is a new place.
  if (parents.length === 0) return openFront(state, now);

  // A parent that has already handed its front on is a fan-out point, and this is
  // its second child: a branch, not a continuation.
  const free = parents.filter((parentId) => !state.extended.has(parentId));
  if (free.length === 0) return openFront(state, now);

  const arriving = [
    ...new Set(
      free.map((parentId) =>
        resolveFrontId(state, state.nodes.get(parentId)!.frontId),
      ),
    ),
  ].sort((a, b) => a - b);

  // Lowest id wins so the survivor is the oldest branch, which is also what makes
  // the merge chain strictly decreasing and therefore terminating.
  const [keepId, ...absorbed] = arriving;
  if (keepId === undefined) return openFront(state, now);

  for (const otherId of absorbed) absorb(state, otherId, keepId, now);
  for (const parentId of free) state.extended.add(parentId);

  return state.fronts.get(keepId) ?? openFront(state, now);
}

/**
 * Record that a node changed on screen.
 *
 * Called for the *paced* releases rather than the runner's events, so the fronts
 * advance in step with the light. A node is noted twice — once lighting up, once
 * with its result — and the second time only refreshes its news; a node never
 * changes front.
 */
export function noteNode(
  state: RunFrontsState,
  nodeId: string,
  running: boolean,
  now: number,
): void {
  state.seq += 1;

  const known = state.nodes.get(nodeId);
  const front = known
    ? liveFront(state, known.frontId)
    : adoptFront(state, nodeId, now);
  if (!front) return;

  if (!known) front.nodeIds.push(nodeId);
  if (running) front.running.add(nodeId);
  else front.running.delete(nodeId);
  front.lastEventAt = now;

  const record: SeenRunNode = {
    frontId: front.id,
    running,
    since: now,
    seq: state.seq,
  };
  state.nodes.set(nodeId, record);
}

/** Whether this node has been shown and has finished — the test both the join
 * gates and the frontier scan need. */
function isDone(state: RunFrontsState, nodeId: string): boolean {
  const record = state.nodes.get(nodeId);
  return record !== undefined && !record.running;
}

/**
 * What a branch is about to do.
 *
 * Scans the front's own nodes for a *frontier* — a finished node with a successor
 * the run has not shown yet — and asks of each such successor whether it could go
 * now. One that could means the front is advancing and the camera stays; one that
 * could not names the nodes it is waiting for, which is the camera's cue to leave
 * and where to go.
 */
/**
 * Whether any step out of `nodeId` could be taken now, recording into
 * `waitingFor` the nodes that hold back the ones that could not.
 */
function frontierReady(
  state: RunFrontsState,
  nodeId: string,
  waitingFor: Set<string>,
): boolean {
  let ready = false;

  for (const next of state.successors.get(nodeId) ?? []) {
    // Already shown: this is not the frontier, whichever front took it.
    if (state.nodes.has(next)) continue;

    const pending = (state.predecessors.get(next) ?? []).filter(
      (parentId) => !isDone(state, parentId),
    );
    if (pending.length === 0) ready = true;
    else for (const parentId of pending) waitingFor.add(parentId);
  }

  return ready;
}

export function frontOutlook(
  state: RunFrontsState,
  frontId: number | null,
  now: number,
): RunFrontOutlook {
  const front = liveFront(state, frontId);
  if (!front) {
    return { running: 0, advancing: false, waitingFor: [], lastEventAt: 0 };
  }

  let ready = false;
  const waitingFor = new Set<string>();

  for (const nodeId of front.nodeIds) {
    if (!isDone(state, nodeId)) continue;
    if (frontierReady(state, nodeId, waitingFor)) ready = true;
  }

  return {
    running: front.running.size,
    // A step that was ready this long ago and still has not been taken is not a
    // step that is coming.
    advancing: ready && now - front.lastEventAt < ADVANCE_GRACE_MS,
    // Only reported when the front has nothing else to offer. Note this tests
    // `ready` rather than the expiry-adjusted value: a branch that has merely gone
    // quiet is stalled, not blocked, and naming nodes it is not really waiting for
    // would send the camera chasing a cause that does not exist.
    waitingFor: front.running.size === 0 && !ready ? [...waitingFor] : [],
    lastEventAt: front.lastEventAt,
  };
}

/** A front worth handing the camera to has something to show: work in progress,
 * or a step it is about to take. */
function hasLife(state: RunFrontsState, front: RunFront, now: number): boolean {
  if (front.running.size > 0) return true;
  return frontOutlook(state, front.id, now).advancing;
}

function aliveFronts(state: RunFrontsState): RunFront[] {
  return [...state.fronts.values()].filter(
    (front) => front.mergedInto === null,
  );
}

/** How much a front is worth watching: 2 = working, 1 = about to move, 0 =
 * nothing to show. */
function frontRank(
  state: RunFrontsState,
  front: RunFront,
  now: number,
): number {
  const outlook = frontOutlook(state, front.id, now);
  if (outlook.running > 0) return 2;
  return outlook.advancing ? 1 : 0;
}

/** Higher rank wins; between equals the freshest news does. */
function outranks(
  rank: number,
  front: RunFront,
  bestRank: number,
  best: RunFront,
): boolean {
  if (rank !== bestRank) return rank > bestRank;
  return front.lastEventAt > best.lastEventAt;
}

/** Of these fronts, the one most worth watching: something working beats something
 * about to move, and between equals the freshest news wins. */
function pickBest(
  state: RunFrontsState,
  fronts: readonly RunFront[],
  now: number,
): number | null {
  let best: RunFront | null = null;
  let bestRank = 0;

  for (const front of fronts) {
    const rank = frontRank(state, front, now);
    if (rank === 0) continue;
    if (best !== null && !outranks(rank, front, bestRank, best)) continue;

    best = front;
    bestRank = rank;
  }

  return best === null ? null : best.id;
}

/**
 * The branch that is holding a join up.
 *
 * Walks upstream from the nodes the join is waiting on until it reaches something
 * the run has already shown; whatever front that node is on is the one that will
 * eventually release the join. Candidates are collected across the whole walk
 * rather than taken from the first hit, because in a diamond the nearest shown
 * ancestor is often the blocked front itself — every branch of a diamond descends
 * from the same node.
 */
/**
 * One layer of the upstream walk: a node the run has shown contributes its front
 * as a candidate, and one it has not queues its own parents for the next layer.
 */
function walkUpstream(
  state: RunFrontsState,
  edge: readonly string[],
  visited: Set<string>,
  candidates: Set<number>,
  excluded: number | null,
): string[] {
  const next: string[] = [];

  for (const nodeId of edge) {
    const record = state.nodes.get(nodeId);
    if (record) {
      const id = resolveFrontId(state, record.frontId);
      if (id !== excluded) candidates.add(id);
      // Shown, so the answer is here or nowhere: walking past it would only find
      // its ancestors, which are further from the join rather than closer.
      continue;
    }
    for (const parentId of state.predecessors.get(nodeId) ?? []) {
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      next.push(parentId);
    }
  }

  return next;
}

export function causalFront(
  state: RunFrontsState,
  waitingFor: readonly string[],
  exclude: number | null,
  now: number,
): number | null {
  const excluded = exclude === null ? null : resolveFrontId(state, exclude);
  const visited = new Set<string>(waitingFor);
  const candidates = new Set<number>();
  let edge = [...waitingFor];

  for (
    let walked = 0;
    walked < CAUSE_WALK_LIMIT && edge.length > 0;
    walked += edge.length
  ) {
    edge = walkUpstream(state, edge, visited, candidates, excluded);
  }

  return pickBest(
    state,
    [...candidates]
      .map((id) => state.fronts.get(id))
      .filter((front): front is RunFront => front !== undefined),
    now,
  );
}

/**
 * The branch to watch now, and the state update that commits to it.
 *
 * Called once a frame. It returns the same id for long stretches — that is the
 * point — and changes it only when the branch it is on has genuinely handed the
 * camera back. When it does change, the caller has a subject somewhere else
 * entirely, and plans a crane move to get there.
 */
/** Whether the branch being watched still has something to offer — and has had
 * the camera long enough for the question to even be asked. */
function holdsCamera(
  state: RunFrontsState,
  outlook: RunFrontOutlook,
  now: number,
): boolean {
  if (now - state.subjectSince < SUBJECT_MIN_MS) return true;

  const handedBack = outlook.running === 0 && !outlook.advancing;
  const outstayed =
    outlook.running > 0 && now - outlook.lastEventAt >= SUBJECT_PATIENCE_MS;

  return !handedBack && !outstayed;
}

/**
 * Where the camera goes when the branch it is on has handed it back.
 *
 * Parked at a join: the branch it is waiting for is the one worth watching, and
 * the graph says which that is. Otherwise, wherever the run is loudest.
 */
function handoffFrom(
  state: RunFrontsState,
  current: number,
  outlook: RunFrontOutlook,
  now: number,
): number | null {
  const preferred =
    outlook.waitingFor.length > 0
      ? causalFront(state, outlook.waitingFor, current, now)
      : null;

  return (
    preferred ??
    pickBest(
      state,
      aliveFronts(state).filter((front) => front.id !== current),
      now,
    )
  );
}

/** Commit to a subject, starting its dwell now. */
function commitSubject(
  state: RunFrontsState,
  next: number | null,
  now: number,
): number | null {
  if (next === null) return null;

  state.subject = next;
  state.subjectSince = now;
  return next;
}

export function chooseSubject(
  state: RunFrontsState,
  now: number,
): number | null {
  const current =
    state.subject === null ? null : resolveFrontId(state, state.subject);
  // Followed through a join. Not a handoff: the same story, so the dwell it has
  // already earned carries over rather than restarting.
  if (current !== state.subject) state.subject = current;

  if (current === null || !state.fronts.has(current)) {
    return commitSubject(state, pickBest(state, aliveFronts(state), now), now);
  }

  const outlook = frontOutlook(state, current, now);
  if (holdsCamera(state, outlook, now)) return current;

  // Nothing better on offer: stay, and rest here. Pulling back to frame a graph
  // nobody is running is not an improvement on holding where it finished.
  const next = handoffFrom(state, current, outlook, now);
  if (next === null || next === current) return current;

  return commitSubject(state, next, now);
}

/**
 * True once nothing is left to fade: every node is either working — a fixed full
 * claim, so the aim is not drifting — or old enough to have no claim at all.
 *
 * A run holding on one slow request is therefore settled, and costs no frames.
 * What it may still owe is a handoff, which is a deadline rather than a drift: see
 * `nextHandoffAt`.
 */
export function frontsSettled(
  state: RunFrontsState,
  now: number,
  windowMs: number,
): boolean {
  for (const record of state.nodes.values()) {
    if (!record.running && now - record.since <= windowMs) return false;
  }
  return true;
}

/**
 * When the camera next owes a decision that no event will arrive to prompt, or
 * null if it owes none.
 *
 * Two things can change with nothing happening: patience running out on a branch
 * that is working but has gone quiet, and a step that was about to be taken turning
 * out not to be coming. Both are deadlines, so the caller sets a timer for this and
 * otherwise sleeps. Everything else the camera does is driven by an event or by
 * motion still in flight — and a branch that is neither working nor advancing needs
 * no timer at all, because that handoff is decided on the spot.
 */
export function nextHandoffAt(
  state: RunFrontsState,
  now: number,
): number | null {
  const current =
    state.subject === null ? null : resolveFrontId(state, state.subject);
  if (current === null) return null;

  const outlook = frontOutlook(state, current, now);
  if (outlook.running === 0 && !outlook.advancing) return null;

  const elsewhere = aliveFronts(state).some(
    (front) => front.id !== current && hasLife(state, front, now),
  );
  if (!elsewhere) return null;

  const expiry =
    outlook.running > 0
      ? outlook.lastEventAt + SUBJECT_PATIENCE_MS
      : outlook.lastEventAt + ADVANCE_GRACE_MS;

  return Math.max(state.subjectSince + SUBJECT_MIN_MS, expiry);
}
