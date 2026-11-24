import { BrowserNodeDataSchema } from "@shared/zod-schemas/BrowserNodeDataSchema";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasGraph } from "../types/CanvasGraph";
import type { CanvasNode } from "../types/CanvasNode";
import { FRAME_NODE_TYPE } from "./canvasGroups";
import { isRecordingFrame } from "./recordedSteps";

const isBrowser = (node: CanvasNode | undefined): boolean => node?.type === "browser";

/** A plain connection: from a node's single output, not one of a branching node's handles. */
const isPlain = (edge: CanvasEdge): boolean => edge.sourceHandle == null;

/** Every node `from` leads to (forwards) or that leads to it (backwards), `from` excluded. */
function reachable(graph: CanvasGraph, from: string, direction: "forwards" | "backwards"): Set<string> {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of graph.edges) {
      const [here, there] = direction === "forwards" ? [edge.source, edge.target] : [edge.target, edge.source];
      if (here !== current || there === from || seen.has(there)) continue;
      seen.add(there);
      queue.push(there);
    }
  }
  return seen;
}

/**
 * The nodes a run passes on its way from Start to `nodeId`: those Start leads
 * to that lead to it. Null when Start does not lead to it: a run never gets
 * there, so a replay would never stop there.
 */
function pathFromStart(graph: CanvasGraph, nodeId: string): CanvasNode[] | null {
  const start = graph.nodes.find((node) => node.type === "start");
  if (start === undefined) return null;
  const afterStart = reachable(graph, start.id, "forwards");
  if (!afterStart.has(nodeId)) return null;
  const before = reachable(graph, nodeId, "backwards");
  return graph.nodes.filter((node) => afterStart.has(node.id) && before.has(node.id));
}

/**
 * Whether a run reaches `nodeId` after some browser step. Without one, the
 * replay opens no page to carry on from.
 */
function hasBrowserStepBefore(graph: CanvasGraph, nodeId: string): boolean {
  return pathFromStart(graph, nodeId)?.some(isBrowser) ?? false;
}

/** **Re-pick element**: a browser step that acts on an element, after a step that opens a page. */
export function canRepick(graph: CanvasGraph, nodeId: string): boolean {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const config = node?.data.config;
  if (!isBrowser(node) || config === undefined) return false;
  // Main refuses a re-pick unless the whole step parses and names an element, so
  // the menu must not offer one that would be refused.
  if (!BrowserNodeDataSchema.safeParse(config).success || !("locator" in config)) return false;
  return hasBrowserStepBefore(graph, nodeId);
}

/** The one plain way into `nodeId` from a node that leads nowhere else, or undefined. */
function soleEntry(graph: CanvasGraph, nodeId: string): CanvasEdge | undefined {
  const incoming = graph.edges.filter((edge) => edge.target === nodeId);
  const entry = incoming[0];
  if (incoming.length !== 1 || entry === undefined || !isPlain(entry)) return undefined;
  return graph.edges.filter((edge) => edge.source === entry.source).length === 1 ? entry : undefined;
}

/** The one plain way out of `nodeId`, or undefined when it has none or branches. */
function soleExit(graph: CanvasGraph, nodeId: string): CanvasEdge | undefined {
  const outgoing = graph.edges.filter((edge) => edge.source === nodeId);
  const exit = outgoing[0];
  return outgoing.length === 1 && exit !== undefined && isPlain(exit) ? exit : undefined;
}

/**
 * **Re-record from here**: a browser step after a step that opens a page, with
 * one plain way in from a node that leads only to it — so the new steps take
 * its place in the chain — and at most one way out.
 */
export function canRerecordFrom(graph: CanvasGraph, nodeId: string): boolean {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!isBrowser(node) || soleEntry(graph, nodeId) === undefined) return false;
  if (graph.edges.filter((edge) => edge.source === nodeId).length > 1) return false;
  return hasBrowserStepBefore(graph, nodeId);
}

/**
 * **Record after this step**: a node a run reaches from Start and stops after
 * — not Start, End or a frame — once a browser step up to it, itself
 * included, has opened a page.
 * It has no way out, or one plain one that the recorded steps are spliced
 * into (`placeRecordedStep`): a second way out would make them a parallel
 * branch, whose steps a run interleaves with the other branch's on its one page.
 */
export function canRecordAfter(graph: CanvasGraph, nodeId: string): boolean {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined || node.type === "start" || node.type === "end" || node.type === FRAME_NODE_TYPE) return false;
  const outgoing = graph.edges.filter((edge) => edge.source === nodeId);
  if (outgoing.length > 0 && soleExit(graph, nodeId) === undefined) return false;
  const path = pathFromStart(graph, nodeId);
  return path !== null && (isBrowser(node) || path.some(isBrowser));
}

/**
 * The steps a re-record from `nodeId` replaces: it, and each browser step it
 * leads on to in a straight line — one plain connection out, one way in —
 * stopping at the first step of another kind, a branch or a merge. Then what
 * follows them, if anything.
 */
function chainFrom(graph: CanvasGraph, nodeId: string): { chain: string[]; next: string | undefined } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const chain = [nodeId];
  let exit = soleExit(graph, nodeId);
  while (exit !== undefined) {
    const target = exit.target;
    const straight = isBrowser(byId.get(target)) && !chain.includes(target) && graph.edges.filter((edge) => edge.target === target).length === 1;
    const onward = graph.edges.filter((edge) => edge.source === target);
    if (!straight || onward.length > 1) break;
    chain.push(target);
    exit = soleExit(graph, target);
  }
  return { chain, next: exit?.target };
}

/**
 * Take out the steps a re-record from `nodeId` replaces, and join the step
 * before them to what followed them, so the recorded steps can be spliced in
 * between (`placeRecordedStep` with the returned anchor).
 *
 * `frameId` is the frame `nodeId` was in when the recorder made it, which the
 * recorded steps go back into: it stays even when this leaves it empty, because
 * they refill it in the same edit. A frame the user made (a Group) is never
 * returned, so it goes like any other frame the replaced steps leave empty,
 * and stays while it holds other nodes. Null `frameId` when there is no such
 * frame; the whole result is null when `nodeId` cannot be re-recorded from.
 */
export function removeStepsFrom(
  graph: CanvasGraph,
  nodeId: string,
): { graph: CanvasGraph; anchorId: string; frameId: string | null } | null {
  const entry = soleEntry(graph, nodeId);
  if (entry === undefined || !canRerecordFrom(graph, nodeId)) return null;
  const { chain, next } = chainFrom(graph, nodeId);
  const removed = new Set(chain);
  const originFrame = graph.nodes.find((node) => node.id === nodeId)?.parentId;
  const frameId = graph.nodes.some((node) => node.id === originFrame && isRecordingFrame(node)) ? (originFrame ?? null) : null;
  const frames = new Set(graph.nodes.filter((node) => removed.has(node.id) && node.parentId != null).map((node) => node.parentId as string));
  const remaining = graph.nodes.filter((node) => !removed.has(node.id));
  const emptied = new Set(
    [...frames].filter((id) => id !== frameId && !remaining.some((node) => node.parentId === id)),
  );
  const nodes = remaining.filter((node) => !(node.type === FRAME_NODE_TYPE && emptied.has(node.id)));
  const edges = graph.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target));
  // The way in now leads to what followed: the recorded steps are spliced into that connection.
  if (next !== undefined) edges.push({ ...entry, target: next });
  return { graph: { nodes, edges }, anchorId: entry.source, frameId };
}
