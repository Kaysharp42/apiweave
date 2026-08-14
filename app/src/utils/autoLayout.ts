import dagre from "dagre";
import type { Node, Edge } from "reactflow";

// ponytail: dagre's Sugiyama layered layout IS the "logical flow + minimal edge
// crossings" engine — it's React Flow's canonical auto-layout. Merge/assert/wait
// are ordinary DAG nodes here; rank assignment converges their multi-inputs and
// fans out branches naturally, so no special per-type handling is needed.
// Swap to elkjs only if this measurably falls short on a real workflow.
/**
 * What a node is assumed to measure before ReactFlow has measured it. Exported
 * because the run camera has to frame nodes it may be seeing for the first time
 * and needs the same guess this layout makes, not a second opinion.
 */
export const NODE_FALLBACK_WIDTH = 280;
export const NODE_FALLBACK_HEIGHT = 120;

const NODE_W = NODE_FALLBACK_WIDTH;
const NODE_H = NODE_FALLBACK_HEIGHT;

/**
 * Repositions nodes into a clean layered layout based on their edge connections.
 * `LR` = left-to-right (default, best for request chains); `TB` = top-to-bottom.
 * Measured node sizes are used when available so spacing fits real node footprints.
 */
export function autoLayout<N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  direction: "LR" | "TB" = "LR",
): N[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 140 });

  nodes.forEach((n) =>
    g.setNode(n.id, { width: n.width ?? NODE_W, height: n.height ?? NODE_H }),
  );
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    const w = n.width ?? NODE_W;
    const h = n.height ?? NODE_H;
    // dagre returns node centers; React Flow positions are top-left corners.
    return { ...n, position: { x: x - w / 2, y: y - h / 2 } };
  });
}
