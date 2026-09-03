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
