import { describe, expect, it } from "vitest"
import { RunSchema } from "../../zod-schemas/RunSchema"
import { WorkflowSchema } from "../../zod-schemas/WorkflowSchema"
import type { Workflow } from "../../types/Workflow"
import { analyzeVariableProvenance, analyzeWorkflowGraph } from "../workflow_graph_analyzer"

const timestamp = "2026-07-27T12:00:00.000Z"

function healthyWorkflow() {
  return WorkflowSchema.parse({
    workflowId: "workflow-1",
    workspaceId: "workspace-1",
    name: "Login flow",
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
      {
        nodeId: "login",
        type: "http-request",
        label: "Login",
        position: { x: 100, y: 0 },
        config: {
          method: "POST",
          url: "https://example.test/login",
          extractors: { token: "response.body.token" },
        },
      },
      {
        nodeId: "assert-login",
        type: "assertion",
        position: { x: 200, y: 0 },
        config: {
          assertions: [{ source: "prev", path: "body.ok", operator: "equals", expectedValue: true }],
        },
      },
      {
        nodeId: "profile",
        type: "http-request",
        label: "Profile",
        position: { x: 300, y: 0 },
        config: {
          method: "GET",
          url: "https://example.test/profile",
          headers: [{ key: "Authorization", value: "Bearer {{variables.token}}" }],
        },
      },
      { nodeId: "end", type: "end", position: { x: 400, y: 0 }, config: {} },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "login" },
      { edgeId: "e2", source: "login", target: "assert-login" },
      { edgeId: "e3", source: "assert-login", target: "profile", sourceHandle: "pass" },
      { edgeId: "e4", source: "profile", target: "end" },
    ],
    variables: {},
    tags: [],
    nodeTemplates: [],
    rev: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

describe("workflow graph analyzer", () => {
  it("shares canonical producer and consumer facts with renderer adapters", () => {
    expect(analyzeVariableProvenance(healthyWorkflow().nodes)).toEqual({
      token: {
        producers: [{ nodeId: "login", nodeLabel: "Login", path: "response.body.token" }],
        consumers: [{ nodeId: "profile", nodeLabel: "Profile", fields: ["headers"] }],
      },
    })
  })

  it("returns no findings for a healthy static graph", () => {
    const diagnosis = analyzeWorkflowGraph(healthyWorkflow())
    expect(diagnosis).toEqual({
      workflowId: "workflow-1",
      summary: { errors: 0, warnings: 0, notices: 0 },
      diagnostics: [],
    })
  })

  it("detects topology, assertion, branch, extractor, and variable faults in stable order", () => {
    const workflow = healthyWorkflow()
    const broken = WorkflowSchema.parse({
      ...workflow,
      nodes: [
        ...workflow.nodes.filter((node) => node.nodeId !== "end" && node.nodeId !== "profile"),
        {
          nodeId: "orphan",
          type: "http-request",
          position: { x: 500, y: 0 },
          config: {
            url: "{{variables.missing}}",
            extractors: { token: "body.token" },
          },
        },
        {
          nodeId: "empty-assertion",
          type: "assertion",
          position: { x: 600, y: 0 },
          config: { assertions: [] },
        },
      ],
      edges: [
        { edgeId: "cycle-1", source: "start", target: "login" },
        { edgeId: "cycle-2", source: "login", target: "start" },
        { edgeId: "bad-branch", source: "empty-assertion", target: "missing-target" },
      ],
    })

    const diagnosis = analyzeWorkflowGraph(broken)
    const codes = diagnosis.diagnostics.map((item) => item.code)
    expect(codes).toEqual([...codes].sort((left, right) => {
      const severity = new Map(diagnosis.diagnostics.map((item) => [item.code, item.severity]))
      const order = { error: 0, warning: 1, notice: 2 } as const
      return order[severity.get(left)!] - order[severity.get(right)!] || left.localeCompare(right)
    }))
    expect(codes).toEqual(expect.arrayContaining([
      "assertion_branch_handle_invalid",
      "assertion_rules_missing",
      "assertion_source_missing",
      "cycle_detected",
      "dangling_edge",
      "extractor_path_invalid",
      "missing_end_node",
      "unreachable_nodes",
      "variable_producer_duplicate",
      "variable_source_missing",
    ]))
  })

  it("covers duplicate identities, ambiguous assertions, and disconnected dataflow", () => {
    const workflow = healthyWorkflow()
    const login = workflow.nodes.find((node) => node.nodeId === "login")!
    const assertion = workflow.nodes.find((node) => node.nodeId === "assert-login")!
    const expanded = WorkflowSchema.parse({
      ...workflow,
      nodes: [
        ...workflow.nodes.filter((node) => node.nodeId !== "assert-login"),
        login,
        {
          ...assertion,
          config: {
            assertions: [{ source: "prev", path: "response.body..ok", operator: "equals" }],
          },
        },
        { nodeId: "start-2", type: "start", position: { x: 0, y: 100 }, config: {} },
        { nodeId: "end-2", type: "end", position: { x: 400, y: 100 }, config: {} },
        {
          nodeId: "other-source",
          type: "http-request",
          position: { x: 100, y: 100 },
          config: { url: "https://example.test/other" },
        },
        {
          nodeId: "detached-producer",
          type: "http-request",
          position: { x: 500, y: 100 },
          config: { extractors: { detached: "response.body.id" } },
        },
        {
          nodeId: "detached-consumer",
          type: "http-request",
          position: { x: 600, y: 100 },
          config: { url: "https://example.test/{{variables.detached}}" },
        },
      ],
      edges: [
        ...workflow.edges,
        { edgeId: "e1", source: "start-2", target: "other-source" },
        { edgeId: "other-assertion", source: "other-source", target: "assert-login" },
        { edgeId: "second-pass", source: "assert-login", target: "end-2", sourceHandle: "pass" },
      ],
    })

    const codes = analyzeWorkflowGraph(expanded).diagnostics.map((item) => item.code)
    expect(codes).toEqual(expect.arrayContaining([
      "assertion_branch_duplicate",
      "assertion_expected_missing",
      "assertion_source_ambiguous",
      "assertion_source_path_invalid",
      "duplicate_edge_id",
      "duplicate_end_node",
      "duplicate_node_id",
      "duplicate_start_node",
      "variable_producer_not_upstream",
    ]))
  })

  it("rejects same-node producers and diagnoses malformed persisted assertion enums", () => {
    const workflow = healthyWorkflow()
    const assertionNode = workflow.nodes.find((node) => node.nodeId === "assert-login")!
    const malformed = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === assertionNode.nodeId
        ? {
            ...node,
            config: {
              assertions: [{ source: "mystery", path: "body.ok", operator: "unsupported", expectedValue: true }],
            },
          }
        : node).map((node) => node.nodeId === "profile"
          ? {
              ...node,
              config: {
                ...node.config,
                url: "https://example.test/{{variables.selfToken}}",
                extractors: { selfToken: "response.body.token" },
              },
            }
          : node),
    } as unknown as Workflow

    const codes = analyzeWorkflowGraph(malformed).diagnostics.map((item) => item.code)
    expect(codes).toEqual(expect.arrayContaining([
      "assertion_operator_unknown",
      "assertion_source_unknown",
      "variable_producer_not_upstream",
    ]))
  })

  it("flags a continueOnFail http-request paired with a downstream status-pinning assertion, recommending expectedStatus", () => {
    const workflow = healthyWorkflow()
    const migratable = {
      ...workflow,
      nodes: workflow.nodes.map((node) => {
        if (node.nodeId === "login") return { ...node, config: { ...node.config, continueOnFail: true } }
        if (node.nodeId === "assert-login") {
          return { ...node, config: { assertions: [{ source: "status", path: "", operator: "equals", expectedValue: 409 }] } }
        }
        return node
      }),
    } as unknown as Workflow

    const diagnosis = analyzeWorkflowGraph(migratable)
    expect(diagnosis.diagnostics.find((item) => item.code === "continue_on_fail_status_check_migratable")).toMatchObject({
      severity: "notice",
      nodeIds: ["assert-login", "login"],
      evidence: { httpNodeId: "login", assertionNodeId: "assert-login", expectedStatusCode: 409 },
    })
  })

  it("does not flag the continueOnFail migration hint once expectedStatus is already set", () => {
    const workflow = healthyWorkflow()
    const migrated = {
      ...workflow,
      nodes: workflow.nodes.map((node) => {
        if (node.nodeId === "login") return { ...node, config: { ...node.config, continueOnFail: true, expectedStatus: 409 } }
        if (node.nodeId === "assert-login") {
          return { ...node, config: { assertions: [{ source: "status", path: "", operator: "equals", expectedValue: 409 }] } }
        }
        return node
      }),
    } as unknown as Workflow

    const codes = analyzeWorkflowGraph(migrated).diagnostics.map((item) => item.code)
    expect(codes).not.toContain("continue_on_fail_status_check_migratable")
  })

  it("correlates stored failures without copying response, assertion, or secret values", () => {
    const sentinel = "secret-value-that-must-not-appear"
    const workflow = healthyWorkflow()
    const run = RunSchema.parse({
      runId: "run-1",
      workspaceId: workflow.workspaceId,
      workflowId: workflow.workflowId,
      status: "failed",
      trigger: "manual",
      variables: { token: sentinel },
      results: [
        {
          nodeId: "login",
          status: "failed",
          duration: 12,
          request: { url: `https://example.test/?token=${sentinel}` },
          response: {
            statusCode: 401,
            truncated: true,
            headers: { authorization: sentinel },
            body: { token: sentinel },
          },
          error: sentinel,
          extractorOutcomes: [{
            producerNodeId: "login",
            variableName: "token",
            path: "response.body.token",
            matched: false,
            observedType: null,
          }, {
            producerNodeId: "login",
            variableName: "firstItem",
            path: "response.body.items[0]",
            matched: false,
            observedType: null,
            failureReason: "type-mismatch",
          }],
        },
        {
          nodeId: "assert-login",
          status: "failed",
          duration: 1,
          assertions: [{
            ruleIndex: 0,
            source: "prev",
            path: "response.body.ok",
            operator: "equals",
            sourceNodeId: "login",
            expectedState: "literal",
            expectedType: "string",
            actualState: "missing",
            actualType: null,
            outcome: "fail",
            reasonCode: "comparison-failed",
          }, {
            ruleIndex: 1,
            source: "prev",
            path: "body.ok",
            operator: "equals",
            sourceNodeId: "profile",
            expectedState: "literal",
            expectedType: "boolean",
            actualState: "present",
            actualType: "boolean",
            outcome: "pass",
            reasonCode: "passed",
          }],
        },
      ],
      nodeStatuses: {},
      failedNodes: ["login", "assert-login"],
      failureMessage: sentinel,
      error: sentinel,
      resolvedSecrets: [{ name: "LOGIN_TOKEN", resolved: false, scopeType: "workspace" }],
      rev: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const diagnosis = analyzeWorkflowGraph(workflow, run)
    const serialized = JSON.stringify(diagnosis)
    expect(diagnosis.runId).toBe("run-1")
    expect(diagnosis.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "assertion_failed",
      "assertion_source_mismatch",
      "extractor_path_missing",
      "extractor_type_mismatch",
      "http_request_failed",
      "nodes_not_executed",
      "response_body_truncated",
      "secret_reference_unresolved",
    ]))
    expect(serialized).not.toContain(sentinel)
    expect(serialized).not.toContain("authorization")
    expect(serialized).not.toContain("failureMessage")
  })
})
