import { describe, expect, it } from "vitest"
import { layoutWorkflowNodes } from "../workflowLayout"
import type { WorkflowNode } from "../../types/WorkflowNode"
import type { WorkflowEdge } from "../../types/WorkflowEdge"

function node(nodeId: string, type: WorkflowNode["type"] = "http-request"): WorkflowNode {
  return { nodeId, type, position: { x: 0, y: 0 }, config: {} } as WorkflowNode
}

describe("layoutWorkflowNodes", () => {
  it("spreads a chain of nodes stacked at the same position into distinct left-to-right columns", () => {
    const nodes = [node("start", "start"), node("a"), node("b"), node("end", "end")]
    const edges: WorkflowEdge[] = [
      { edgeId: "e1", source: "start", target: "a" },
      { edgeId: "e2", source: "a", target: "b" },
      { edgeId: "e3", source: "b", target: "end" },
    ]

    const laidOut = layoutWorkflowNodes(nodes, edges)
    const xs = laidOut.map((n) => n.position.x)
    // Every node started at x:0 — after layout each should be at a distinct,
    // increasing x (left-to-right chain), not still stacked.
    expect(new Set(xs).size).toBe(4)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it("is a pure function: does not mutate its inputs", () => {
    const nodes = [node("a"), node("b")]
    const edges: WorkflowEdge[] = [{ edgeId: "e1", source: "a", target: "b" }]
    layoutWorkflowNodes(nodes, edges)
    expect(nodes[0]!.position).toEqual({ x: 0, y: 0 })
  })

  it("leaves node identity (everything but position) untouched", () => {
    const nodes = [
      { nodeId: "a", type: "http-request", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://x" } },
    ] as WorkflowNode[]
    const laidOut = layoutWorkflowNodes(nodes, [])
    expect(laidOut[0]).toMatchObject({ nodeId: "a", type: "http-request", config: { method: "GET", url: "https://x" } })
  })
})
