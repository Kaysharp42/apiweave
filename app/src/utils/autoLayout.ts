import type { Node, Edge } from "@xyflow/react";
import { dagreLayoutPositions, NODE_FALLBACK_WIDTH, NODE_FALLBACK_HEIGHT } from "@shared/layout/dagreLayout";

export { NODE_FALLBACK_WIDTH, NODE_FALLBACK_HEIGHT };

/**
 * Repositions nodes into a clean layered layout based on their edge connections.
 * `LR` = left-to-right (default, best for request chains); `TB` = top-to-bottom.
 * Measured node sizes are used when available so spacing fits real node footprints.
 *
 * Measured size lives on `node.measured` since React Flow v12; `node.width` is
 * now only what the caller set explicitly, and is undefined for every node the
 * app creates. Reading it alone would lay the whole graph out at
 * NODE_FALLBACK_WIDTH and overlap every real node.
 */
export function autoLayout<N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  direction: "LR" | "TB" = "LR",
): N[] {
  const positions = dagreLayoutPositions(
    nodes.map((n) => ({
      id: n.id,
      width: n.measured?.width ?? n.width ?? undefined,
      height: n.measured?.height ?? n.height ?? undefined,
    })),
    edges.map((e) => ({ source: e.source, target: e.target })),
    direction,
  );
  return nodes.map((n) => ({ ...n, position: positions.get(n.id)! }));
}

/**
 * Auto-layout, minus the frames.
 *
 * dagre lays out a flat graph; a frame is fixed geometry whose children live in
 * its coordinate space. Handing both to dagre scatters a user's groups and
 * gives framed nodes absolute coordinates inside a relative space — so frames
 * and their members keep their positions, and only root nodes are re-laid.
 *
 * ponytail: the richer alternative is a layout pass per frame followed by a
 * placement pass for the frames themselves. Worth it if anyone reaches for
 * Auto-layout on a framed graph often enough to complain that the frames
 * stayed put.
 */
export function autoLayoutRootNodes<N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  direction: "LR" | "TB" = "LR",
): N[] {
  const movable = nodes.filter(
    (node) => node.parentId === undefined && node.type !== "group",
  );
  if (movable.length === nodes.length) return autoLayout(nodes, edges, direction);

  const movableIds = new Set(movable.map((node) => node.id));
  const laidOut = autoLayout(
    movable,
    // An edge into a frame's member would make dagre invent the node it cannot
    // see, and lay the graph out around a phantom.
    edges.filter((e) => movableIds.has(e.source) && movableIds.has(e.target)),
    direction,
  );
  const positions = new Map<string, N["position"]>();
  for (const node of laidOut) positions.set(node.id, node.position);
  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position === undefined ? node : { ...node, position };
  });
}
