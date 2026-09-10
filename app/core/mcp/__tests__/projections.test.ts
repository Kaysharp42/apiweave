import { describe, expect, it } from "vitest"
import { projectMcpError } from "../error-projection"
import { encodeMcpResult } from "../result-encoding"
import { compactWorkflowDiagnosis, projectWorkflowWrite, unavailableWorkflowDiagnosis } from "../projections/workflow-write"

describe("MCP compact write projections", () => {
  it("bounds touched IDs independently of graph size", () => {
    const nodeIds = Array.from({ length: 25 }, (_, index) => `node-${index}`)
    const projected = projectWorkflowWrite(
      { domain: "workflows", action: "patch", intent: "write", description: "test" },
      {
        upsertNodes: nodeIds.map((nodeId) => ({ nodeId })),
        removeEdgeIds: nodeIds,
      },
      {
        workflowId: "wf-1",
        workspaceId: "ws-1",
        rev: 2,
        nodes: Array.from({ length: 500 }, (_, index) => ({ nodeId: `stored-${index}` })),
        edges: Array.from({ length: 500 }, (_, index) => ({ edgeId: `stored-edge-${index}` })),
      } as never,
    )

    expect(projected).toMatchObject({
      workflowId: "wf-1",
      nodeCount: 500,
      edgeCount: 500,
      touchedNodeIdsTotal: 25,
      touchedEdgeIdsTotal: 25,
    })
    expect(projected?.touchedNodeIds).toHaveLength(20)
    expect(projected?.touchedEdgeIds).toHaveLength(20)
  })

  it("orders and bounds diagnosis details, while retaining total severity counts", () => {
    const diagnosis = compactWorkflowDiagnosis({
      workflowId: "wf-1",
      summary: { errors: 1, warnings: 20, notices: 1 },
      diagnostics: [
        diagnostic("notice", "notice"),
        diagnostic("warning", "warning"),
        diagnostic("error", "error"),
        ...Array.from({ length: 19 }, (_, index) => diagnostic(`warning-${index}`, "warning")),
      ],
    })

    expect(diagnosis).toMatchObject({ status: "complete", summary: { errors: 1, warnings: 20, notices: 1 } })
    if (diagnosis.status !== "complete") throw new Error("expected complete diagnosis")
    expect(diagnosis.items[0]?.severity).toBe("error")
    expect(diagnosis.items).toHaveLength(20)
    expect(diagnosis.omittedItemCount).toBe(2)
  })

  it("never represents an unavailable diagnosis as clean", () => {
    expect(unavailableWorkflowDiagnosis()).toEqual({
      status: "unavailable",
      message: "Static analysis was unavailable after the workflow was saved.",
    })
  })

  it("uses compact JSON and preserves only actionable router error details", () => {
    expect(encodeMcpResult({ result: { id: "wf-1" } })).toBe('{"result":{"id":"wf-1"}}')
    expect(projectMcpError("conflict", "workflow revision is stale", {
      expectedRevision: 4,
      currentRevision: 5,
      secret: "must-not-leak",
    })).toEqual({
      code: "conflict",
      message: "workflow revision is stale",
      writeCommitted: false,
      details: { expectedRevision: 4, currentRevision: 5 },
    })
    expect(projectMcpError("validation", "request validation failed", [{
      code: "invalid_type",
      path: ["upsertNodes", 0, "config"],
      expected: "object",
      input: { token: "must-not-leak" },
      message: "Expected object",
    }])).toEqual({
      code: "validation",
      message: "request validation failed",
      writeCommitted: false,
      details: {
        issues: [{
          code: "invalid_type",
          path: ["upsertNodes", 0, "config"],
          expected: "object",
          message: "Expected object",
        }],
      },
    })
  })

  it("omits conflict details that carry no revision an agent can act on", () => {
    const stale = { code: "conflict" as const, message: "workflow revision is stale", writeCommitted: false }
    // An array is not a revision record: it must not project as an empty details key.
    expect(projectMcpError("conflict", stale.message, [{ expectedRevision: 4, currentRevision: 5 }])).toEqual(stale)
    expect(projectMcpError("conflict", stale.message, { secret: "must-not-leak" })).toEqual(stale)
    // ...and an array is never a record, even when it carries revision-shaped properties.
    expect(projectMcpError("conflict", stale.message, Object.assign([], { expectedRevision: 4 }))).toEqual(stale)
  })

  it("projects each validation issue exactly once", () => {
    let messageReads = 0
    const issue = {
      code: "invalid_type",
      get message() {
        messageReads += 1
        return "Expected object"
      },
    }

    const error = projectMcpError("validation", "request validation failed", [issue])

    expect(error.details?.issues).toEqual([{ code: "invalid_type", message: "Expected object" }])
    // One projection pass reads message twice (type guard, then copy). Projecting
    // each issue twice would double every read for identical output.
    expect(messageReads).toBe(2)
  })
})

function diagnostic(code: string, severity: "error" | "warning" | "notice") {
  return {
    code,
    severity,
    category: "topology" as const,
    nodeIds: [],
    message: `${code} message`,
    evidence: {},
    remediation: null,
    confidence: "high" as const,
  }
}
