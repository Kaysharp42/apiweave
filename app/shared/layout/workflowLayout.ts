import type { WorkflowNode } from "../types/WorkflowNode"
import type { WorkflowEdge } from "../types/WorkflowEdge"
import { dagreLayoutPositions } from "./dagreLayout"

/**
 * Re-lay-out a workflow graph with dagre. Every node gets a fallback size
 * (there is no DOM to measure from on this side), so this always produces a
 * full re-layout — same behavior as the renderer's "Tidy" action, just
 * reachable without a canvas.
 */
export function layoutWorkflowNodes(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  direction: "LR" | "TB" = "LR",
): WorkflowNode[] {
  const positions = dagreLayoutPositions(
    nodes.map((n) => ({ id: n.nodeId })),
    edges.map((e) => ({ source: e.source, target: e.target })),
    direction,
  )
  return nodes.map((n) => {
    const position = positions.get(n.nodeId)
    return position === undefined ? n : { ...n, position }
  })
}
