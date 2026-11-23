import { describe, expect, it } from "vitest"
import { analyzeWorkflowGraph } from "../../analysis/workflow_graph_analyzer"
import { WorkflowEdgeSchema } from "../../zod-schemas/WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "../../zod-schemas/WorkflowNodeSchema"
import { initialWorkflowGraph } from "../initial_workflow_graph"

describe("initialWorkflowGraph", () => {
  it("is Start → End, valid as stored", () => {
    const graph = initialWorkflowGraph()
    expect(graph.nodes.map((node) => node.type)).toEqual(["start", "end"])
    expect(graph.edges).toEqual([expect.objectContaining({ source: graph.nodes[0]?.nodeId, target: graph.nodes[1]?.nodeId })])
    for (const node of graph.nodes) expect(WorkflowNodeSchema.safeParse(node).success).toBe(true)
    for (const edge of graph.edges) expect(WorkflowEdgeSchema.safeParse(edge).success).toBe(true)
  })

  it("leaves the analyzer nothing to report", () => {
    expect(analyzeWorkflowGraph(initialWorkflowGraph()).diagnostics).toEqual([])
  })

  it("returns a fresh graph each time, so a caller can change one safely", () => {
    expect(initialWorkflowGraph()).not.toBe(initialWorkflowGraph())
    expect(initialWorkflowGraph().nodes[0]).not.toBe(initialWorkflowGraph().nodes[0])
  })
})
