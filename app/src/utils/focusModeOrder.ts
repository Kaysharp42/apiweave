import type { Edge, Node } from "@xyflow/react";
import type { FocusModeDirection } from "../types/FocusModeDirection";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

type FocusableNode = Node<WorkflowCanvasNodeData>;

/**
 * Whether a node has a details editor at all.
 *
 * Frames and notes are canvas objects, not steps: they are edited in place on
 * the canvas. Start and end carry nothing to edit. Focus mode and the
 * double-click editor share this one definition so a node cannot be reachable
 * through one and not the other.
 */
export function isEditableNode(node: FocusableNode): boolean {
  return node.type !== "group" && node.type !== "note" && node.type !== "start" && node.type !== "end";
}

function topologicalNodeOrder(
  nodes: readonly FocusableNode[],
  edges: readonly Edge[],
): string[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const downstream = new Map<string, string[]>();
  const incoming = new Map<string, number>();

  for (const node of nodes) {
    downstream.set(node.id, []);
    incoming.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    downstream.get(edge.source)?.push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const pending = nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id);
  const ordered: string[] = [];
  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (nodeId === undefined) continue;
    ordered.push(nodeId);
    for (const targetId of downstream.get(nodeId) ?? []) {
      const count = (incoming.get(targetId) ?? 1) - 1;
      incoming.set(targetId, count);
      if (count === 0) pending.push(targetId);
    }
  }

  // A malformed workflow can have a cycle. Keep it navigable rather than
  // making the focus controls disappear while the user fixes that graph.
  for (const node of nodes) {
    if (!ordered.includes(node.id)) ordered.push(node.id);
  }
  return ordered;
}

/**
 * Prefer the order the latest run actually produced. Before a run exists, use
 * graph topology so a branch and merge remain predictable to walk.
 */
export function focusModeOrder(
  nodes: readonly FocusableNode[],
  edges: readonly Edge[],
): string[] {
  const focusableNodes = nodes.filter(isEditableNode);
  const topologicalOrder = topologicalNodeOrder(focusableNodes, edges);
  const executedIds = focusableNodes
    .filter((node) => typeof node.data.executionTimestamp === "number")
    .sort(
      (a, b) =>
        (a.data.executionTimestamp ?? Number.POSITIVE_INFINITY) -
        (b.data.executionTimestamp ?? Number.POSITIVE_INFINITY),
    )
    .map((node) => node.id);

  if (executedIds.length === 0) return topologicalOrder;
  return [...executedIds, ...topologicalOrder.filter((id) => !executedIds.includes(id))];
}

export function adjacentFocusModeNode(
  nodes: readonly FocusableNode[],
  edges: readonly Edge[],
  currentNodeId: string,
  direction: FocusModeDirection,
): string | null {
  const order = focusModeOrder(nodes, edges);
  const index = order.indexOf(currentNodeId);
  if (index === -1) return null;
  const adjacentIndex = direction === "next" ? index + 1 : index - 1;
  return order[adjacentIndex] ?? null;
}
