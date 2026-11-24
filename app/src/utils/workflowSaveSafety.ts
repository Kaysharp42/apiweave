import type { Node } from "@xyflow/react";
import { initialWorkflowGraph } from "@shared/graph/initial_workflow_graph";
import type { HydratedBaseline } from "../types/HydratedBaseline";

const blankGraph = initialWorkflowGraph();

/**
 * Whether the canvas still shows the graph it was created with, before any
 * workflow was hydrated onto it.
 *
 * The graph's *shape* cannot tell: every blank workflow is Start → End, and a
 * user can delete their way back to exactly that. What cannot be reproduced by
 * editing is the object identity of what the canvas started with. Hydration
 * and every edit that rebuilds a node give it a fresh `data` object, while
 * React Flow's own measuring and the user dragging a node only copy the node
 * and keep `data`. So a canvas whose nodes all still carry the initial `data`
 * objects has never been hydrated.
 */
export function isUntouchedInitialCanvas(
  canvasNodes: readonly Node[],
  initialNodes: readonly Node[],
): boolean {
  if (canvasNodes.length === 0) return false;
  const initialData = new Set(initialNodes.map((node) => node.data));
  return canvasNodes.every((node) => initialData.has(node.data));
}

/**
 * An autosave must never replace a workflow the canvas has not caught up with.
 * Hydration records its baseline the moment it queues the workflow, but the
 * canvas's own state — which the save reads — lags a render behind. In that
 * window the save would write the blank initial graph over the real one.
 */
export function shouldBlockDestructiveAutosave(
  canvasIsUntouchedInitial: boolean,
  baseline: HydratedBaseline | null,
): boolean {
  if (!baseline || !canvasIsUntouchedInitial) return false;

  return (
    baseline.nodeCount > blankGraph.nodes.length ||
    baseline.edgeCount > blankGraph.edges.length
  );
}
