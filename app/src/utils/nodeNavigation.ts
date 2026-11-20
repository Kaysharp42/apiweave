import type { Edge, Node } from "@xyflow/react";
import type { NodeModalNodeType } from "../types/NodeModalNodeType";
import type { NodeStep } from "../types/NodeStep";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import { browserStepSummary } from "./browserStep";
import { getNodeModalTypeName } from "./nodeModalMeta";

type CanvasNode = Node<WorkflowCanvasNodeData>;

/**
 * Whether a node has a details editor at all.
 *
 * Frames and notes are canvas objects, not steps: they are edited in place on
 * the canvas. Start and end carry nothing to edit. The double-click editor and
 * its previous/next steps share this one definition, so a node cannot be
 * reachable through one and not the other.
 */
export function isEditableNode(node: CanvasNode): boolean {
  return node.type !== "group" && node.type !== "note" && node.type !== "start" && node.type !== "end";
}

/**
 * The order a fork's branches are listed in, so the number that picks one is
 * the same every time: the success/first output, a plain edge, the late
 * output, then failure. Edge order (creation order) breaks ties.
 */
const HANDLE_RANK: Readonly<Record<string, number>> = {
  pass: 0,
  ready: 0,
  complete: 2,
  fail: 3,
};

function handleRank(handle: string | null): number {
  return handle === null ? 1 : (HANDLE_RANK[handle] ?? 1);
}

/**
 * The node's one-line description, as its card on the canvas shows it: a
 * browser step's action and target, otherwise the URL it calls.
 */
function nodeStepDetail(node: CanvasNode): string | null {
  const config = node.data.config;
  if (node.type === "browser") {
    const { operation, argument } = browserStepSummary(config);
    return argument ? `${operation} ${argument}` : operation;
  }
  const url = config?.["url"];
  if (typeof url !== "string" || url.trim() === "") return null;
  const method = config?.["method"];
  return typeof method === "string" ? `${method} ${url}` : url;
}

export function toNodeStep(node: CanvasNode, handle: string | null): NodeStep {
  const label = typeof node.data.label === "string" ? node.data.label.trim() : "";
  return {
    nodeId: node.id,
    label: label || getNodeModalTypeName(node.type ?? ""),
    detail: nodeStepDetail(node),
    nodeType: node.type as NodeModalNodeType,
    handle,
    ranLastRun: typeof node.data.executionTimestamp === "number",
  };
}

type EdgeDirection = "outgoing" | "incoming";

/** The end of an edge the walk starts from: its source when going downstream. */
function nearEnd(edge: Edge, direction: EdgeDirection): string {
  return direction === "outgoing" ? edge.source : edge.target;
}

/** The end of an edge the walk arrives at. */
function farEnd(edge: Edge, direction: EdgeDirection): string {
  return direction === "outgoing" ? edge.target : edge.source;
}

/** The edges leaving (or entering) a node, self-loops aside. */
function incidentEdges(edges: readonly Edge[], nodeId: string, direction: EdgeDirection): Edge[] {
  return edges.filter(
    (edge) => nearEnd(edge, direction) === nodeId && farEnd(edge, direction) !== nodeId,
  );
}

function stepsAlong(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  nodeId: string,
  direction: EdgeDirection,
): NodeStep[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const steps = new Map<string, NodeStep>();
  for (const edge of incidentEdges(edges, nodeId, direction)) {
    const node = byId.get(farEnd(edge, direction));
    if (!node || steps.has(node.id) || !isEditableNode(node)) continue;
    steps.set(node.id, toNodeStep(node, edge.sourceHandle ?? null));
  }
  // Array#sort is stable, so edges of equal rank keep their creation order.
  return [...steps.values()].sort((a, b) => handleRank(a.handle) - handleRank(b.handle));
}

/** The editable nodes one edge downstream: one per branch at a fork. */
export function nextNodeSteps(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  nodeId: string,
): NodeStep[] {
  return stepsAlong(nodes, edges, nodeId, "outgoing");
}

/** The editable nodes one edge upstream: several at a merge. */
export function previousNodeSteps(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  nodeId: string,
): NodeStep[] {
  return stepsAlong(nodes, edges, nodeId, "incoming");
}

/**
 * Previous follows the path the editor actually walked, the way Back does in a
 * browser: after taking an assertion's Fail branch it returns to that
 * assertion, not to whichever parent happens to be listed first. With no trail
 * (or a trail whose node is gone) it falls back to the incoming edges.
 */
export function previousStepsFor(
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
  nodeId: string,
  trail: readonly string[],
): NodeStep[] {
  const backId = trail.at(-1);
  const back = backId === undefined ? undefined : nodes.find((node) => node.id === backId);
  if (back && isEditableNode(back)) {
    const edge = edges.find((candidate) => candidate.source === back.id && candidate.target === nodeId);
    return [toNodeStep(back, edge?.sourceHandle ?? null)];
  }
  return previousNodeSteps(nodes, edges, nodeId);
}

/**
 * The trail after a step. Going forward pushes the node being left. Going back
 * to the trail's last node pops it; going back anywhere else (an incoming edge
 * picked with no trail to follow) starts the trail over.
 */
export function trailAfterStep(
  trail: readonly string[],
  fromId: string,
  toId: string,
  direction: "previous" | "next",
): string[] {
  if (direction === "next") return [...trail, fromId];
  return trail.at(-1) === toId ? trail.slice(0, -1) : [];
}
