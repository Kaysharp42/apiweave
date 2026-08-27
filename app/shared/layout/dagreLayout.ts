import dagre from "dagre"

// ponytail: dagre's Sugiyama layered layout IS the "logical flow + minimal
// edge crossings" engine, shared verbatim between the renderer's "Tidy" action
// (`app/src/utils/autoLayout.ts`) and MCP graph writes (`app/core/mcp/bridge.ts`).
// One id/width/height + source/target shape so neither caller's node/edge type
// leaks in here. Swap to elkjs only if this measurably falls short.

/** What a node is assumed to measure before it has a real (renderer-measured)
 * size — used for every node when there is no DOM to measure, which is always
 * true on the MCP/core side. */
export const NODE_FALLBACK_WIDTH = 280
export const NODE_FALLBACK_HEIGHT = 120

export interface DagreLayoutNode {
  readonly id: string
  readonly width?: number | undefined
  readonly height?: number | undefined
}

export interface DagreLayoutEdge {
  readonly source: string
  readonly target: string
}

/**
 * Layered layout over a generic node/edge shape. Returns each node's top-left
 * `{x, y}` (dagre itself returns centers) keyed by id; callers own mapping that
 * back onto their own node type.
 */
export function dagreLayoutPositions(
  nodes: readonly DagreLayoutNode[],
  edges: readonly DagreLayoutEdge[],
  direction: "LR" | "TB" = "LR",
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 140 })

  for (const n of nodes) {
    g.setNode(n.id, { width: n.width ?? NODE_FALLBACK_WIDTH, height: n.height ?? NODE_FALLBACK_HEIGHT })
  }
  for (const e of edges) g.setEdge(e.source, e.target)

  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const { x, y } = g.node(n.id)
    const w = n.width ?? NODE_FALLBACK_WIDTH
    const h = n.height ?? NODE_FALLBACK_HEIGHT
    positions.set(n.id, { x: x - w / 2, y: y - h / 2 })
  }
  return positions
}
