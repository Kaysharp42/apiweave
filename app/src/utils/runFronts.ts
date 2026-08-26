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
 *   - one child of a node continues its parent's front — its *heir*, the branch
 *     that costs the camera the least travel to watch, decided from the layout
 *     rather than from which child happened to report first; absent a layout,
 *     the first branch the edges list;
 *   - any other child of the same node opens a front — that is a fan-out, and from
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

/**
 * How many nodes of a branch are measured when deciding which branch of a fan-out
 * the camera takes first.
 *
 * The question is which branch is the cheaper thing to watch, and the answer is
 * settled by the part of it the camera will see soon; a branch fifty nodes long is
 * a tour whichever end you start from. Deep enough to see past a first hop that
 * lies about the branch, shallow enough that the walk is a fixed cost per fan-out.
 */
const BRANCH_PROBE_NODES = 12;

/**
 * How much nearer one branch has to be than another before distance decides a
 * handoff rather than freshness.
 *
 * Roughly a node's width: two trips that differ by less than that cost the camera
 * the same glance, and letting a few pixels outvote "this is where the news is"
 * would be precision the layout does not have.
 */
const NEARER_BY_PX = 320;

/** The canvas node this needs: an id and where it sits. Structural so the tracker
 * stays free of ReactFlow. Both position fields, and in that order, because that
 * is what the aim reads in `attentionPointFor` — the branch the chooser calls near
 * and the point the camera aims at have to be the same place. */
interface FrontsNode {
  readonly id: string;
  readonly position?: { readonly x: number; readonly y: number };
  readonly positionAbsolute?: { readonly x: number; readonly y: number };
}

export function createFronts(
  edges: readonly { source: string; target: string }[],
  nodes: readonly FrontsNode[] = [],
): RunFrontsState {
  return {
    successors: groupEdgesBy(edges, "source"),
    predecessors: groupEdgesBy(edges, "target"),
    // Copied rather than referenced: the camera reads these for the length of a
    // run and a live ReactFlow position object is not ours to trust.
    positions: new Map(
      nodes.flatMap((node) => {
        const at = node.positionAbsolute ?? node.position;
        return at ? [[node.id, { x: at.x, y: at.y }] as const] : [];
      }),
    ),
    heirs: new Map(),
    nodes: new Map(),
    fronts: new Map(),
    extended: new Set(),
    nextFrontId: 1,
    seq: 0,
    subject: null,
    subjectSince: 0,
  };
}

/** Canvas distance between two nodes, or zero when either has no position —
 * which makes every comparison a tie and every rule fall through to its
 * pre-geometry answer. */
function distance(state: RunFrontsState, from: string, to: string): number {
  const a = state.positions.get(from);
  const b = state.positions.get(to);
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
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

/**
 * What each branch out of a fan-out would cost the camera to watch: the trip out
 * to it, plus the travel along it.
 *
 * The branches are walked at once, round-robin, and a node belongs to whichever
 * walk claims it first. That is what makes this a measure of *a branch* rather
 * than of the graph downstream of it: at a join the tail beyond is charged to one
 * side only, and in a diamond the two sides come out as the two sides.
 *
 * A first hop is not enough on its own — it is exactly the number a layout can
 * lie about, a short step onto a branch that then runs off the screen — so the
 * probe walks a fixed depth in and adds up what it finds.
 */
/** Per-child walk state for {@link branchCosts}, seeded so every child stakes
 * its own claim before any walking — a child that also sits downstream of a
 * sibling still counts as a branch in its own right. */
interface BranchWalk {
  readonly costs: Map<string, number>;
  readonly owner: Map<string, string>;
  readonly frontier: Map<string, string[]>;
  readonly claimed: Map<string, number>;
}

function seedBranchWalk(
  state: RunFrontsState,
  parentId: string,
  children: readonly string[],
): BranchWalk {
  const walk: BranchWalk = {
    costs: new Map(),
    owner: new Map(),
    frontier: new Map(),
    claimed: new Map(),
  };

  for (const child of children) {
    if (walk.owner.has(child)) continue;
    walk.owner.set(child, child);
    walk.costs.set(child, distance(state, parentId, child));
    walk.frontier.set(child, [child]);
    walk.claimed.set(child, 1);
  }

  return walk;
}

/** One child's frontier advanced by a single hop: successors not already
 * claimed by another child are charged to this one and become its next
 * frontier. */
function advanceBranch(
  state: RunFrontsState,
  child: string,
  edge: readonly string[],
  walk: BranchWalk,
): string[] {
  const next: string[] = [];

  for (const nodeId of edge) {
    for (const successor of state.successors.get(nodeId) ?? []) {
      if (walk.owner.has(successor)) continue;
      walk.owner.set(successor, child);
      walk.costs.set(
        child,
        (walk.costs.get(child) ?? 0) + distance(state, nodeId, successor),
      );
      walk.claimed.set(child, (walk.claimed.get(child) ?? 0) + 1);
      next.push(successor);
    }
  }

  return next;
}

/** One depth-step of the walk across every child at once. Returns whether any
 * child's frontier actually advanced, which is what tells the caller the walk
 * has run its course. */
function stepBranchWalk(state: RunFrontsState, walk: BranchWalk): boolean {
  let moved = false;

  for (const child of walk.costs.keys()) {
    const edge = walk.frontier.get(child) ?? [];
    const atLimit = (walk.claimed.get(child) ?? 0) >= BRANCH_PROBE_NODES;
    if (edge.length === 0 || atLimit) continue;

    const next = advanceBranch(state, child, edge, walk);
    walk.frontier.set(child, next);
    if (next.length > 0) moved = true;
  }

  return moved;
}

function branchCosts(
  state: RunFrontsState,
  parentId: string,
  children: readonly string[],
): Map<string, number> {
  const walk = seedBranchWalk(state, parentId, children);

  for (let depth = 0; depth < BRANCH_PROBE_NODES; depth += 1) {
    if (!stepBranchWalk(state, walk)) break;
  }

  return walk.costs;
}

/**
 * The child that inherits a node's front.
 *
 * With one child it is that child and this is a continuation. With several it is a
 * fan-out, and the heir is the branch the camera can watch for the least travel —
 * so the run splitting into a nearby branch and a trip across the graph is not a
 * decision the camera makes by whichever one happened to report first.
 *
 * Deciding it up front, rather than when a child arrives, is what lets a non-heir
 * arriving first open its own front and leave the parent's front where it is: the
 * camera holds for the beat it takes the near branch to light up instead of
 * setting off across the canvas.
 *
 * The price of deciding up front: if the heir's branch never runs — a router
 * picks the other side — the unshown heir still reads as a ready step and holds
 * the parent's front until `ADVANCE_GRACE_MS` expires. Bounded, and cheaper than
 * setting off across the canvas on whichever side happened to report first.
 */
function heirOf(state: RunFrontsState, parentId: string): string | null {
  const cached = state.heirs.get(parentId);
  if (cached !== undefined) return cached;

  const children = state.successors.get(parentId) ?? [];
  let heir: string | null = children[0] ?? null;

  if (children.length > 1) {
    let best = Infinity;
    for (const [child, cost] of branchCosts(state, parentId, children)) {
      if (cost >= best) continue;
      best = cost;
      heir = child;
    }
  }

  state.heirs.set(parentId, heir);
  return heir;
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

  // A parent's front passes to one child only — its heir — and only if it has not
  // passed already. Anything else arriving here is a branch, not a continuation.
  const free = parents.filter(
    (parentId) =>
      !state.extended.has(parentId) && heirOf(state, parentId) === nodeId,
  );
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

/** The node a front's news is at: the last one of its own it reported. */
function newestNode(state: RunFrontsState, front: RunFront): string | null {
  let newest: string | null = null;
  let bestSeq = -1;

  for (const nodeId of front.nodeIds) {
    const record = state.nodes.get(nodeId);
    if (!record || record.seq <= bestSeq) continue;
    bestSeq = record.seq;
    newest = nodeId;
  }

  return newest;
}

/** Where the camera is, as the graph sees it: the newest node of the branch it is
 * following. Null before it has a subject, which is the opening move — there is no
 * trip to weigh when the camera has not been anywhere yet. */
function cameraAnchor(state: RunFrontsState): string | null {
  const front = liveFront(state, state.subject);
  return front === null ? null : newestNode(state, front);
}

/** How far the camera would travel to take this front up. */
function frontDistance(
  state: RunFrontsState,
  front: RunFront,
  anchor: string | null,
): number {
  if (anchor === null) return 0;
  const target = newestNode(state, front);
  return target === null ? 0 : distance(state, anchor, target);
}

interface FrontCandidate {
  readonly front: RunFront;
  readonly rank: number;
  readonly distance: number;
}

/** Something working beats something about to move; between those the one the
 * camera can reach without a trip, because a handoff nobody has to sit through is
 * a better handoff; and between two trips of much the same length, the freshest
 * news.
 *
 * A preference between two candidates, not a total order: inside the hysteresis
 * band (`NEARER_BY_PX`) freshness decides, so three fronts can compare
 * pairwise without chaining transitively. Callers scan candidates linearly in
 * insertion order, which keeps the pick deterministic and within the band. */
function outranks(candidate: FrontCandidate, best: FrontCandidate): boolean {
  if (candidate.rank !== best.rank) return candidate.rank > best.rank;
  if (Math.abs(candidate.distance - best.distance) > NEARER_BY_PX) {
    return candidate.distance < best.distance;
  }
  return candidate.front.lastEventAt > best.front.lastEventAt;
}

/** Of these fronts, the one most worth watching. */
function pickBest(
  state: RunFrontsState,
  fronts: readonly RunFront[],
  now: number,
): number | null {
  const anchor = cameraAnchor(state);
  let best: FrontCandidate | null = null;

  for (const front of fronts) {
    const rank = frontRank(state, front, now);
    if (rank === 0) continue;

    const candidate = {
      front,
      rank,
      distance: frontDistance(state, front, anchor),
    };
    if (best !== null && !outranks(candidate, best)) continue;

    best = candidate;
  }

  return best === null ? null : best.front.id;
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
