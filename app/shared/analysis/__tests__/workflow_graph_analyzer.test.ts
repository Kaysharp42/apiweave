import { describe, expect, it } from "vitest"
import { RunSchema } from "../../zod-schemas/RunSchema"
import { WorkflowSchema } from "../../zod-schemas/WorkflowSchema"
import type { Run } from "../../types/Run"
import type { Workflow } from "../../types/Workflow"
import { analyzeVariableProvenance, analyzeWorkflowGraph, cycleNodeIds, findCycles, successorMap, wouldCreateCycle } from "../workflow_graph_analyzer"

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

  // A frame has no edges, so every topology rule would call it unreachable and
  // every dataflow rule would call it a step that produces nothing. It is not a
  // step at all — the analyzer drops frames before it looks.
  it("ignores group frames entirely", () => {
    const framed = healthyWorkflow()
    const withFrame = {
      ...framed,
      nodes: [
        ...framed.nodes.map((node) => (node.nodeId === "login" ? { ...node, parentId: "frame-1" } : node)),
        { nodeId: "frame-1", type: "group" as const, label: "Auth", position: { x: 60, y: -40 }, config: { width: 300, height: 200 } },
      ],
    }

    expect(analyzeWorkflowGraph(withFrame)).toEqual(analyzeWorkflowGraph(framed))
  })

  it("returns no findings for a healthy static graph", () => {
    const diagnosis = analyzeWorkflowGraph(healthyWorkflow())
    expect(diagnosis).toEqual({
      workflowId: "workflow-1",
      summary: { errors: 0, warnings: 0, notices: 0 },
      diagnostics: [],
    })
  })

  it("accepts a $-prefixed JSONPath extractor and assertion path", () => {
    const workflow = healthyWorkflow()
    const jsonPathWorkflow = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "login"
        ? {
            ...node,
            config: {
              ...node.config,
              extractors: { firstId: "$.response.body.items[*].id" },
            },
          }
        : node.nodeId === "assert-login"
          ? {
              ...node,
              config: {
                assertions: [{ source: "prev", path: "$.response.body.items[?@.id==3].name", operator: "exists" }],
              },
            }
          : node),
    })

    const codes = analyzeWorkflowGraph(jsonPathWorkflow).diagnostics.map((item) => item.code)
    expect(codes).not.toContain("extractor_path_invalid")
    expect(codes).not.toContain("assertion_source_path_invalid")
  })

  it("flags an invalid $-prefixed JSONPath as an invalid path", () => {
    const workflow = healthyWorkflow()
    const jsonPathWorkflow = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "login"
        ? {
            ...node,
            config: {
              ...node.config,
              extractors: { bad: "$.response.body[" },
            },
          }
        : node.nodeId === "assert-login"
          ? {
              ...node,
              config: {
                assertions: [{ source: "prev", path: "$.response.body[", operator: "exists" }],
              },
            }
          : node),
    })

    const codes = analyzeWorkflowGraph(jsonPathWorkflow).diagnostics.map((item) => item.code)
    expect(codes).toContain("extractor_path_invalid")
    expect(codes).toContain("assertion_source_path_invalid")
  })

  // A namespaced XPath declaration sits in a prefix block before the colon:
  // `xpath[prefix=uri;…]:<expression>`. The runtime evaluates it (see
  // `xpathQuery.ts`), so rejecting it here blocked a SOAP workflow that ran.
  const namespacedXPath =
    "xpath[s=http://schemas.xmlsoap.org/soap/envelope/;t=urn:temperature]:/s:Envelope/s:Body/t:GetTemperatureResponse/t:Reading"

  it("accepts a namespaced XPath extractor and assertion path", () => {
    const workflow = healthyWorkflow()
    const withXPath = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "login"
        ? { ...node, config: { ...node.config, extractors: { reading: namespacedXPath } } }
        : node.nodeId === "assert-login"
          ? { ...node, config: { assertions: [{ source: "prev", path: namespacedXPath, operator: "exists" }] } }
          : node),
    })

    const codes = analyzeWorkflowGraph(withXPath).diagnostics.map((item) => item.code)
    expect(codes).not.toContain("extractor_path_invalid")
    expect(codes).not.toContain("assertion_source_path_invalid")
  })

  it("still rejects a namespaced XPath whose prefix block does not parse", () => {
    const workflow = healthyWorkflow()
    const badXPath = "xpath[soap]:/soap:Envelope"
    const withBadXPath = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "login"
        ? { ...node, config: { ...node.config, extractors: { bad: badXPath } } }
        : node.nodeId === "assert-login"
          ? { ...node, config: { assertions: [{ source: "prev", path: badXPath, operator: "exists" }] } }
          : node),
    })

    const codes = analyzeWorkflowGraph(withBadXPath).diagnostics.map((item) => item.code)
    expect(codes).toContain("extractor_path_invalid")
    expect(codes).toContain("assertion_source_path_invalid")
  })

  // The executor stores a parsed SOAP fault at `response.fault`, so
  // `response.fault.code` is a real path even though `fault` is not a body root.
  it("accepts response.fault paths for a SOAP fault assertion", () => {
    const workflow = healthyWorkflow()
    const withFaultAssertions = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "assert-login"
        ? {
            ...node,
            config: {
              assertions: [
                { source: "prev", path: "response.fault.code", operator: "equals", expectedValue: "soap:Server" },
                { source: "prev", path: "response.fault.reason", operator: "contains", expectedValue: "unavailable" },
              ],
            },
          }
        : node),
    })

    expect(analyzeWorkflowGraph(withFaultAssertions).diagnostics.map((item) => item.code))
      .not.toContain("assertion_source_path_invalid")
  })

  // Bare `fault.code` reads the top-level result, which carries no fault — the
  // executor only stores it on the response object.
  it("rejects an unprefixed fault path", () => {
    const workflow = healthyWorkflow()
    const withBareFault = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "assert-login"
        ? { ...node, config: { assertions: [{ source: "prev", path: "fault.code", operator: "exists" }] } }
        : node),
    })

    expect(analyzeWorkflowGraph(withBareFault).diagnostics.map((item) => item.code))
      .toContain("assertion_source_path_invalid")
  })

  it("still rejects a path rooted at a member no result carries", () => {
    const workflow = healthyWorkflow()
    const withUnknownRoot = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "assert-login"
        ? { ...node, config: { assertions: [{ source: "prev", path: "response.faults.code", operator: "exists" }] } }
        : node),
    })

    expect(analyzeWorkflowGraph(withUnknownRoot).diagnostics.map((item) => item.code))
      .toContain("assertion_source_path_invalid")
  })

  // `matchesSnapshot` compares against the baseline its first run records, so
  // it takes no expectedValue — flagging it missing blocked a valid rule.
  it("does not flag matchesSnapshot as missing an expected value", () => {
    const workflow = healthyWorkflow()
    const withSnapshot = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "assert-login"
        ? { ...node, config: { assertions: [{ source: "prev", path: "response.body", operator: "matchesSnapshot" }] } }
        : node),
    })

    const diagnosis = analyzeWorkflowGraph(withSnapshot)
    expect(diagnosis.diagnostics.map((item) => item.code)).not.toContain("assertion_expected_missing")
    expect(diagnosis.summary.errors).toBe(0)
  })

  it("accepts an assertion immediately downstream from an SSE stream", () => {
    const workflow = healthyWorkflow()
    const streamWorkflow = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "login"
        ? {
            ...node,
            type: "sse",
            config: {
              url: "https://example.test/events",
              maxEvents: 1,
              extractors: { eventData: "response.body.events[0].data" },
            },
          }
        : node),
    })

    const codes = analyzeWorkflowGraph(streamWorkflow).diagnostics.map((item) => item.code)
    expect(codes).not.toContain("assertion_source_missing")
    expect(codes).not.toContain("assertion_source_ambiguous")
    expect(analyzeVariableProvenance(streamWorkflow.nodes)["eventData"]?.producers).toEqual([
      { nodeId: "login", nodeLabel: "Login", path: "response.body.events[0].data" },
    ])
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

  it("emits one aggregated notice when every wired fail handle lands on an end node", () => {
    const workflow = healthyWorkflow()
    const withRedundantFailEdge = {
      ...workflow,
      edges: [
        ...workflow.edges,
        { edgeId: "fail-to-end", source: "assert-login", target: "end", sourceHandle: "fail" },
      ],
    } as unknown as Workflow

    const diagnosis = analyzeWorkflowGraph(withRedundantFailEdge)
    expect(diagnosis.diagnostics.find((item) => item.code === "assertion_fail_wired_on_all")).toMatchObject({
      severity: "notice",
      nodeIds: ["assert-login", "end"],
      evidence: { edgeIds: ["fail-to-end"], endNodeIds: ["end"] },
    })
  })

  it("does not flag a fail handle wired to a distinct action before rejoining end", () => {
    const workflow = healthyWorkflow()
    const withDistinctFailPath = {
      ...workflow,
      nodes: [
        ...workflow.nodes,
        { nodeId: "notify", type: "http-request", position: { x: 200, y: 200 }, config: { url: "https://example.test/notify" } },
      ],
      edges: [
        ...workflow.edges,
        { edgeId: "fail-to-notify", source: "assert-login", target: "notify", sourceHandle: "fail" },
        { edgeId: "notify-to-end", source: "notify", target: "end" },
      ],
    } as unknown as Workflow

    const codes = analyzeWorkflowGraph(withDistinctFailPath).diagnostics.map((item) => item.code)
    expect(codes).not.toContain("assertion_fail_wired_on_all")
  })

  it("does not flood when only some wired fail handles land on an end node", () => {
    const workflow = healthyWorkflow()
    const partial = {
      ...workflow,
      nodes: [
        ...workflow.nodes,
        { nodeId: "notify", type: "http-request", position: { x: 200, y: 200 }, config: { url: "https://example.test/notify" } },
      ],
      edges: [
        ...workflow.edges,
        { edgeId: "fail-to-end", source: "assert-login", target: "end", sourceHandle: "fail" },
        { edgeId: "fail-to-notify", source: "assert-login", target: "notify", sourceHandle: "fail" },
      ],
    } as unknown as Workflow

    const diagnosis = analyzeWorkflowGraph(partial)
    const wired = diagnosis.diagnostics.filter((item) => item.code === "assertion_fail_wired_on_all")
    expect(wired).toHaveLength(0)
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

  it("does not flag the migration hint when the status assertion is non-numeric or out of range", () => {
    const workflow = healthyWorkflow()
    const migratable = {
      ...workflow,
      nodes: workflow.nodes.map((node) => {
        if (node.nodeId === "login") return { ...node, config: { ...node.config, continueOnFail: true } }
        if (node.nodeId === "assert-login") {
          return { ...node, config: { assertions: [{ source: "status", path: "", operator: "equals", expectedValue: "" }] } }
        }
        return node
      }),
    } as unknown as Workflow

    const codes = analyzeWorkflowGraph(migratable).diagnostics.map((item) => item.code)
    expect(codes).not.toContain("continue_on_fail_status_check_migratable")
  })

  it("emits one migration hint per pair even when multiple status rules pin the same status", () => {
    const workflow = healthyWorkflow()
    const migratable = {
      ...workflow,
      nodes: workflow.nodes.map((node) => {
        if (node.nodeId === "login") return { ...node, config: { ...node.config, continueOnFail: true } }
        if (node.nodeId === "assert-login") {
          return {
            ...node,
            config: {
              assertions: [
                { source: "status", path: "", operator: "equals", expectedValue: 409 },
                { source: "status", path: "", operator: "equals", expectedValue: 409 },
              ],
            },
          }
        }
        return node
      }),
    } as unknown as Workflow

    const diagnosis = analyzeWorkflowGraph(migratable)
    const hints = diagnosis.diagnostics.filter((item) => item.code === "continue_on_fail_status_check_migratable")
    expect(hints).toHaveLength(1)
  })

  it("does not emit http_request_failed when expectedStatus matches a 4xx response", () => {
    const workflow = WorkflowSchema.parse({
      workflowId: "workflow-neg",
      workspaceId: "workspace-neg",
      name: "negative test",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
        {
          nodeId: "neg",
          type: "http-request",
          label: "neg",
          position: { x: 100, y: 0 },
          config: { method: "POST", url: "https://example.test/neg", expectedStatus: 409, continueOnFail: true },
        },
        { nodeId: "end", type: "end", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { edgeId: "e2", source: "neg", target: "end" },
      ],
      variables: {},
      tags: [],
      nodeTemplates: [],
      rev: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }) as unknown as Workflow

    const run = RunSchema.parse({
      runId: "run-neg",
      workspaceId: workflow.workspaceId,
      workflowId: workflow.workflowId,
      status: "completed",
      trigger: "manual",
      variables: {},
      results: [
        { nodeId: "start", status: "passed", duration: 1 },
        {
          nodeId: "neg",
          status: "passed",
          duration: 10,
          response: { statusCode: 409, body: { error: "conflict" } },
          expectedStatus: 409,
        },
        { nodeId: "end", status: "passed", duration: 1 },
      ],
      nodeStatuses: {},
      failedNodes: [],
      rev: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const diagnosis = analyzeWorkflowGraph(workflow, run)
    expect(diagnosis.summary.errors).toBe(0)
    expect(diagnosis.diagnostics.map((item) => item.code)).not.toContain("http_request_failed")
  })

  // A real run was blocked on the canvas for `expectedValue: false` while
  // `assertion_validate` accepted it: the canvas gate used a truthiness check
  // rather than a presence check. `false`, `0` and `""` are all legitimate
  // `equals` targets — `expectedValue === undefined` is the only "missing"
  // signal, and `analyzeWorkflowGraph` is the shared validator the canvas gate
  // now uses.
  for (const expectedValue of [false, 0, ""] as const) {
    it(`accepts a falsy expectedValue (${JSON.stringify(expectedValue)}, ${typeof expectedValue}) without flagging it missing`, () => {
      const workflow = healthyWorkflow()
      const assertionNode = workflow.nodes.find((node) => node.nodeId === "assert-login")!
      const withFalsy = {
        ...workflow,
        nodes: workflow.nodes.map((node) => node.nodeId === assertionNode.nodeId
          ? {
              ...node,
              config: {
                assertions: [
                  { source: "prev", path: "body.blacklisted", operator: "equals", expectedValue },
                  { source: "status", path: "", operator: "notEquals", expectedValue: true },
                ],
              },
            }
          : node),
      } as unknown as Workflow

      const diagnosis = analyzeWorkflowGraph(withFalsy)
      expect(diagnosis.diagnostics.map((item) => item.code)).not.toContain("assertion_expected_missing")
      expect(diagnosis.summary.errors).toBe(0)
    })
  }

  it("still flags assertion_expected_missing when expectedValue is truly absent", () => {
    const workflow = healthyWorkflow()
    const assertionNode = workflow.nodes.find((node) => node.nodeId === "assert-login")!
    const withMissing = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === assertionNode.nodeId
        ? { ...node, config: { assertions: [{ source: "prev", path: "body.ok", operator: "equals" }] } }
        : node),
    } as unknown as Workflow

    expect(analyzeWorkflowGraph(withMissing).diagnostics.map((item) => item.code))
      .toContain("assertion_expected_missing")
  })

  it("flags assertion_expected_invalid for a value with the wrong shape for its operator", () => {
    const workflow = healthyWorkflow()
    const withInvalid = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.nodeId === "assert-login"
        ? {
            ...node,
            config: {
              assertions: [
                { source: "prev", path: "response.body.id", operator: "type", expectedValue: "text" },
                { source: "prev", path: "response.body.id", operator: "matches", expectedValue: "^ord_" },
              ],
            },
          }
        : node),
    } as unknown as Workflow

    const invalid = analyzeWorkflowGraph(withInvalid).diagnostics.filter((item) => item.code === "assertion_expected_invalid")
    expect(invalid).toHaveLength(1)
    expect(invalid[0]!.message).toMatch(/"type" expects one of/)
  })

  // Regression: parallel fan-out from one assertion outcome IS supported by
  // the runtime (`matching` edges branch in parallel via Promise.allSettled),
  // so routing three "pass" edges off an assertion is a legitimate shape.
  // `assertion_branch_duplicate` used to warn — a warning reads as "fix this",
  // and authors reported adding dummy delay nodes solely to silence it. It is
  // now a notice: verbose, not wrong.
  it("rates an assertion fan-out as a notice, not a warning (parallel branches run)", () => {
    const workflow = healthyWorkflow()
    const fanOut = {
      ...workflow,
      nodes: [
        ...workflow.nodes.filter((node) => node.nodeId !== "profile"),
        { nodeId: "branch-a", type: "http-request", position: { x: 300, y: -50 }, config: { method: "GET", url: "https://example.test/a" } },
        { nodeId: "branch-b", type: "http-request", position: { x: 300, y: 0 }, config: { method: "GET", url: "https://example.test/b" } },
        { nodeId: "branch-c", type: "http-request", position: { x: 300, y: 50 }, config: { method: "GET", url: "https://example.test/c" } },
      ],
      edges: [
        ...workflow.edges.filter((edge) => edge.edgeId !== "e3"),
        { edgeId: "fa", source: "assert-login", target: "branch-a", sourceHandle: "pass" },
        { edgeId: "fb", source: "assert-login", target: "branch-b", sourceHandle: "pass" },
        { edgeId: "fc", source: "assert-login", target: "branch-c", sourceHandle: "pass" },
      ],
    } as unknown as Workflow

    const dup = analyzeWorkflowGraph(fanOut).diagnostics.find((item) => item.code === "assertion_branch_duplicate")
    expect(dup).toBeDefined()
    expect(dup?.severity).toBe("notice")
    expect(dup?.evidence).toMatchObject({ sourceHandle: "pass", count: 3 })
  })

  // Regression: an author wired every assertion's `fail` handle to a single
  // `end` because the guides could be read as `fail` being mandatory. It is
  // verbose, not wrong — diagnose it as a notice (never as an error).
  it("notices (never warns) when every assertion wires its fail handle", () => {
    const workflow = healthyWorkflow()
    const bothWired = {
      ...workflow,
      edges: [
        ...workflow.edges,
        { edgeId: "fail-wired", source: "assert-login", target: "end", sourceHandle: "fail" },
      ],
    } as unknown as Workflow

    const notice = analyzeWorkflowGraph(bothWired).diagnostics.find((item) => item.code === "assertion_fail_wired_on_all")
    expect(notice).toBeDefined()
    expect(notice?.severity).toBe("notice")
    expect(notice?.nodeIds).toContain("assert-login")
  })

  it("does not raise assertion_fail_wired_on_all when at least one assertion leaves its fail unwired", () => {
    const workflow = healthyWorkflow()
    // healthyWorkflow only wires the `pass` handle from assert-login; `fail`
    // is deliberately unconnected.
    expect(analyzeWorkflowGraph(workflow).diagnostics.map((item) => item.code))
      .not.toContain("assertion_fail_wired_on_all")
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

  // The executor marks an `end` node passed without recording a result, so an
  // `end` node is always missing from `run.results`. Listing it as blocked claims a
  // terminal marker was starved by the failure.
  it("omits the end node from http_request_failed blockedNodeIds but keeps starved nodes", () => {
    const workflow = healthyWorkflow() as unknown as Workflow
    const run = RunSchema.parse({
      runId: "run-blocked",
      workspaceId: workflow.workspaceId,
      workflowId: workflow.workflowId,
      status: "failed",
      trigger: "manual",
      variables: {},
      results: [
        { nodeId: "start", status: "passed", duration: 1 },
        { nodeId: "login", status: "failed", duration: 5, response: { statusCode: 500 } },
      ],
      nodeStatuses: {},
      failedNodes: ["login"],
      rev: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const failure = analyzeWorkflowGraph(workflow, run).diagnostics
      .find((item) => item.code === "http_request_failed")
    expect(failure?.evidence["blockedNodeIds"]).toEqual(["assert-login", "profile"])
    expect(failure?.nodeIds).toContain("login")
    expect(failure?.nodeIds).not.toContain("end")
  })

  /** A caller workflow whose one step calls `wf-child`. */
  function callerWorkflow(): Workflow {
    return WorkflowSchema.parse({
      workflowId: "workflow-1",
      workspaceId: "workspace-1",
      name: "Caller",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
        { nodeId: "call", type: "workflow", position: { x: 100, y: 0 }, config: { targetWorkflowId: "wf-child" } },
        { nodeId: "end", type: "end", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "call" },
        { edgeId: "e2", source: "call", target: "end" },
      ],
      variables: {},
      tags: [],
      nodeTemplates: [],
      rev: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  function runOver(results: unknown[], failedNodes: string[]): Run {
    return RunSchema.parse({
      runId: "run-call",
      workspaceId: "workspace-1",
      workflowId: "workflow-1",
      status: "failed",
      trigger: "manual",
      variables: {},
      results,
      nodeStatuses: {},
      failedNodes,
      rev: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  it("diagnoses a failed Call Workflow node with the child run to inspect", () => {
    const run = runOver([
      { nodeId: "start", status: "passed", duration: 1 },
      {
        nodeId: "call",
        status: "failed",
        duration: 7,
        error: 'Sub-workflow Login failed at "Fill password": Status 404',
        subWorkflow: {
          workflowId: "wf-child",
          runId: "run-child-9",
          status: "failed",
          nodeCount: 3,
          failedNodeCount: 1,
          outputVariableNames: [],
        },
      },
    ], ["call"])

    const call = analyzeWorkflowGraph(callerWorkflow(), run).diagnostics
      .find((item) => item.code === "workflow_call_failed")
    expect(call).toMatchObject({ severity: "error", category: "execution", nodeIds: ["call"] })
    expect(call?.message).toContain("inside the called workflow")
    expect(call?.evidence).toEqual({
      targetWorkflowId: "wf-child",
      childRunIds: ["run-child-9"],
      childRunIdCount: 1,
      childRunIdOmittedCount: 0,
    })
    expect(call?.remediation).toMatchObject({ kind: "inspect_child_run", nodeId: "call" })
  })

  it("diagnoses a failed for-each call with each failed iteration's run id, capped and counted", () => {
    const iterations = Array.from({ length: 25 }, (_, index) => ({
      index,
      runId: `run-child-${index}`,
      status: index % 2 === 1 ? ("failed" as const) : ("passed" as const),
    }))
    const run = runOver([
      { nodeId: "start", status: "passed", duration: 1 },
      {
        nodeId: "call",
        status: "failed",
        duration: 70,
        error: "Sub-workflow Login: 12 of 25 iteration(s) failed",
        subWorkflow: {
          workflowId: "wf-child",
          status: "failed",
          nodeCount: 3,
          failedNodeCount: 0,
          outputVariableNames: [],
          forEach: { itemCount: 25, ranCount: 25, failedCount: 12, iterations },
        },
      },
    ], ["call"])

    const call = analyzeWorkflowGraph(callerWorkflow(), run).diagnostics
      .find((item) => item.code === "workflow_call_failed")
    // 12 failed children exceed the run-id cap; the first ten travel and the
    // rest are counted, not silently dropped.
    expect(call?.evidence).toMatchObject({
      targetWorkflowId: "wf-child",
      failedIterationCount: 12,
      childRunIds: ["run-child-1", "run-child-3", "run-child-5", "run-child-7", "run-child-9", "run-child-11", "run-child-13", "run-child-15", "run-child-17", "run-child-19"],
      childRunIdCount: 12,
      childRunIdOmittedCount: 2,
    })
    expect(call?.message).toContain("iteration")
  })

  it("does not diagnose a call that passed", () => {
    const run = runOver([
      { nodeId: "start", status: "passed", duration: 1 },
      {
        nodeId: "call",
        status: "passed",
        duration: 7,
        subWorkflow: { workflowId: "wf-child", runId: "run-child-9", status: "passed", nodeCount: 3, failedNodeCount: 0, outputVariableNames: [] },
      },
    ], [])

    expect(analyzeWorkflowGraph(callerWorkflow(), run).diagnostics.map((item) => item.code))
      .not.toContain("workflow_call_failed")
  })
})

describe("cycle helpers", () => {
  const chain = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ]

  it("finds each cycle in edge order and none in a DAG", () => {
    expect(findCycles(successorMap(chain))).toEqual([])
    expect(findCycles(successorMap([...chain, { source: "c", target: "b" }]))).toEqual([["b", "c"]])
    expect(findCycles(successorMap([{ source: "a", target: "a" }]))).toEqual([["a"]])
  })

  it("lists every node on a cycle, including ones the depth-first search never closes a cycle through", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" },
      { source: "a", target: "d" },
      { source: "d", target: "c" },
      { source: "c", target: "e" },
    ]
    expect(cycleNodeIds(successorMap(edges))).toEqual(["a", "b", "c", "d"])
    expect(cycleNodeIds(successorMap(chain))).toEqual([])
    expect(cycleNodeIds(successorMap([{ source: "a", target: "a" }]))).toEqual(["a"])
  })

  it("says whether a new edge would close a cycle", () => {
    expect(wouldCreateCycle(chain, "c", "a")).toBe(true)
    expect(wouldCreateCycle(chain, "b", "b")).toBe(true)
    expect(wouldCreateCycle(chain, "a", "c")).toBe(false)
    expect(wouldCreateCycle(chain, "c", "d")).toBe(false)
  })
})

describe("analyzeWorkflowGraph — gRPC node", () => {
  const grpcWorkflow = (extractors: Record<string, string>) => WorkflowSchema.parse({
    workflowId: "workflow-g",
    workspaceId: "workspace-1",
    name: "gRPC",
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
      { nodeId: "rpc", type: "grpc", position: { x: 100, y: 0 }, config: { target: "localhost:50051", service: "a.B", method: "C", extractors } },
      { nodeId: "check", type: "assertion", position: { x: 200, y: 0 }, config: { assertions: [{ source: "prev", path: "response.status", operator: "equals", expectedValue: "OK" }] } },
      { nodeId: "end", type: "end", position: { x: 300, y: 0 }, config: {} },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "rpc" },
      { edgeId: "e2", source: "rpc", target: "check" },
      { edgeId: "e3", source: "check", target: "end", sourceHandle: "pass" },
    ],
    variables: {},
    tags: [],
    nodeTemplates: [],
    rev: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const codes = (workflow: Workflow) => analyzeWorkflowGraph(workflow).diagnostics.map((item) => item.code)

  it("treats the call as the assertion's response source and accepts gRPC result paths", () => {
    const diagnostics = codes(grpcWorkflow({ id: "response.body.id", code: "response.statusCode", trailer: "response.trailers.x-id", name: "response.statusMessage", jp: "$.response.body.items[0]" }))
    expect(diagnostics).not.toContain("assertion_source_missing")
    expect(diagnostics).not.toContain("extractor_path_invalid")
  })

  it("still rejects a path that addresses nothing in the result", () => {
    expect(codes(grpcWorkflow({ x: "response.nonsense" }))).toContain("extractor_path_invalid")
  })
})

describe("browser steps", () => {
  const nav = { action: "navigate", url: "https://app.example.test/login" }
  const click = (name: string) => ({ action: "click", locator: { kind: "role", role: "button", name } })
  function browserWorkflow(
    nodes: ReadonlyArray<{ nodeId: string; type: string; config?: Record<string, unknown> }>,
    edges: ReadonlyArray<[string, string, string?]>,
  ): Workflow {
    return WorkflowSchema.parse({
      workflowId: "workflow-browser",
      workspaceId: "workspace-1",
      name: "Web",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
        ...nodes.map((node) => ({ position: { x: 0, y: 0 }, ...node })),
        { nodeId: "end", type: "end", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: edges.map(([source, target, sourceHandle], index) => ({ edgeId: `e${index}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })),
      variables: {},
      tags: [],
      nodeTemplates: [],
      rev: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }
  const diagnose = (workflow: Workflow) => analyzeWorkflowGraph(workflow).diagnostics
  /** The same check, with the Call Workflow targets the caller could read that have browser steps. */
  const diagnoseWithCalls = (workflow: Workflow, browserStepWorkflowIds: readonly string[]) =>
    analyzeWorkflowGraph({ ...workflow, browserStepWorkflowIds }).diagnostics

  it("accepts one ordered chain that opens a page first", () => {
    const workflow = browserWorkflow(
      [{ nodeId: "open", type: "browser", config: nav }, { nodeId: "save", type: "browser", config: click("Save") }],
      [["start", "open"], ["open", "save"], ["save", "end"]],
    )
    expect(diagnose(workflow).map((item) => item.code).filter((code) => code.startsWith("browser_"))).toEqual([])
  })

  it("rejects browser steps on parallel branches", () => {
    const workflow = browserWorkflow(
      [
        { nodeId: "open", type: "browser", config: nav },
        { nodeId: "left", type: "browser", config: click("A") },
        { nodeId: "right", type: "browser", config: click("B") },
      ],
      [["start", "open"], ["open", "left"], ["open", "right"], ["left", "end"], ["right", "end"]],
    )
    const parallel = diagnose(workflow).find((item) => item.code === "browser_parallel_branches")
    expect(parallel).toMatchObject({ severity: "error", nodeIds: ["left", "right"], remediation: { kind: "chain_browser_steps", nodeId: "left" } })
  })

  it("allows browser steps on the pass and fail sides of one assertion", () => {
    const workflow = browserWorkflow(
      [
        { nodeId: "api", type: "http-request", config: { method: "GET", url: "https://api.example.test/flag" } },
        { nodeId: "check", type: "assertion", config: { assertions: [{ source: "status", path: "", operator: "equals", expectedValue: 200 }] } },
        { nodeId: "on", type: "browser", config: nav },
        { nodeId: "off", type: "browser", config: nav },
      ],
      [["start", "api"], ["api", "check"], ["check", "on", "pass"], ["check", "off", "fail"], ["on", "end"], ["off", "end"]],
    )
    expect(diagnose(workflow).map((item) => item.code)).not.toContain("browser_parallel_branches")
  })

  // A Call Workflow node into a workflow with browser steps drives the same
  // page as a browser step, so the chain rule covers it too. The target ids a
  // caller can read are named by `browserStepWorkflowIds`.
  it("rejects two called workflows with browser steps on parallel branches", () => {
    const workflow = browserWorkflow(
      [
        { nodeId: "login-a", type: "workflow", config: { targetWorkflowId: "login-flow" } },
        { nodeId: "login-b", type: "workflow", config: { targetWorkflowId: "login-flow" } },
      ],
      [["start", "login-a"], ["start", "login-b"], ["login-a", "end"], ["login-b", "end"]],
    )
    const parallel = diagnoseWithCalls(workflow, ["login-flow"]).find((item) => item.code === "browser_parallel_branches")
    expect(parallel).toMatchObject({ severity: "error", nodeIds: ["login-a", "login-b"] })
  })

  it("rejects a called workflow with browser steps parallel to a browser step", () => {
    const workflow = browserWorkflow(
      [
        { nodeId: "login", type: "workflow", config: { targetWorkflowId: "login-flow" } },
        { nodeId: "open", type: "browser", config: nav },
      ],
      [["start", "login"], ["start", "open"], ["login", "end"], ["open", "end"]],
    )
    expect(diagnoseWithCalls(workflow, ["login-flow"]).find((item) => item.code === "browser_parallel_branches")).toMatchObject({
      severity: "error",
      nodeIds: ["login", "open"],
    })
  })

  it("allows a called workflow and a browser step on the pass and fail sides of one assertion", () => {
    const workflow = browserWorkflow(
      [
        { nodeId: "api", type: "http-request", config: { method: "GET", url: "https://api.example.test/flag" } },
        { nodeId: "check", type: "assertion", config: { assertions: [{ source: "status", path: "", operator: "equals", expectedValue: 200 }] } },
        { nodeId: "login", type: "workflow", config: { targetWorkflowId: "login-flow" } },
        { nodeId: "open", type: "browser", config: nav },
      ],
      [["start", "api"], ["api", "check"], ["check", "login", "pass"], ["check", "open", "fail"], ["login", "end"], ["open", "end"]],
    )
    expect(diagnoseWithCalls(workflow, ["login-flow"]).map((item) => item.code)).not.toContain("browser_parallel_branches")
  })

  it("ignores a call into a workflow without browser steps", () => {
    const workflow = browserWorkflow(
      [
        { nodeId: "login", type: "workflow", config: { targetWorkflowId: "login-flow" } },
        { nodeId: "report", type: "workflow", config: { targetWorkflowId: "report-flow" } },
      ],
      [["start", "login"], ["start", "report"], ["login", "end"], ["report", "end"]],
    )
    expect(diagnoseWithCalls(workflow, ["login-flow"]).map((item) => item.code)).not.toContain("browser_parallel_branches")
  })

  it("warns when the chain does not open a page first, unless a called workflow may have", () => {
    const bare = browserWorkflow([{ nodeId: "save", type: "browser", config: click("Save") }], [["start", "save"], ["save", "end"]])
    expect(diagnose(bare).find((item) => item.code === "browser_chain_starts_without_navigate")).toMatchObject({
      severity: "warning",
      nodeIds: ["save"],
      remediation: { kind: "add_navigate_step", nodeId: "save" },
    })

    const afterLogin = browserWorkflow(
      [{ nodeId: "login", type: "workflow", config: { targetWorkflowId: "login-flow" } }, { nodeId: "save", type: "browser", config: click("Save") }],
      [["start", "login"], ["login", "save"], ["save", "end"]],
    )
    expect(diagnose(afterLogin).map((item) => item.code)).not.toContain("browser_chain_starts_without_navigate")
  })

  it("notes a raw recorded selector, also inside a parent locator", () => {
    const workflow = browserWorkflow(
      [
        { nodeId: "open", type: "browser", config: nav },
        { nodeId: "raw", type: "browser", config: { action: "click", locator: { kind: "role", role: "button", within: { kind: "selector", value: "internal:role=row >> nth=1" } } } },
      ],
      [["start", "open"], ["open", "raw"], ["raw", "end"]],
    )
    expect(diagnose(workflow).find((item) => item.code === "browser_selector_fallback")).toMatchObject({ severity: "notice", nodeIds: ["raw"] })
  })

  it("counts an extract step as the producer of its variable", () => {
    const workflow = browserWorkflow(
      [
        { nodeId: "open", type: "browser", config: nav },
        { nodeId: "read", type: "browser", config: { action: "extract", locator: { kind: "testId", value: "order" }, from: "attribute", attribute: "data-id", variable: "orderId" } },
        { nodeId: "api", type: "http-request", config: { method: "GET", url: "https://api.example.test/orders/{{variables.orderId}}" } },
      ],
      [["start", "open"], ["open", "read"], ["read", "api"], ["api", "end"]],
    )
    expect(analyzeVariableProvenance(workflow.nodes)["orderId"]?.producers).toEqual([{ nodeId: "read", nodeLabel: "read", path: "page.attribute.data-id" }])
    expect(diagnose(workflow).map((item) => item.code)).not.toContain("variable_source_missing")
  })
})

// A Call Workflow node's `outputMapping` writes its keys into the CALLER's
// scope, so a variable used after the call has a producer even though no
// extractor in this workflow names it.
describe("Call Workflow output mapping", () => {
  const workflow = WorkflowSchema.parse({
    workflowId: "workflow-call",
    workspaceId: "workspace-1",
    name: "Caller",
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
      {
        nodeId: "auth",
        type: "workflow",
        label: "Sign in",
        position: { x: 100, y: 0 },
        config: { targetWorkflowId: "auth-flow", outputMapping: { token: "accessToken" } },
      },
      {
        nodeId: "profile",
        type: "http-request",
        label: "Profile",
        position: { x: 200, y: 0 },
        config: {
          method: "GET",
          url: "https://example.test/profile",
          headers: [{ key: "Authorization", value: "Bearer {{variables.token}}" }],
        },
      },
      { nodeId: "end", type: "end", position: { x: 300, y: 0 }, config: {} },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "auth" },
      { edgeId: "e2", source: "auth", target: "profile" },
      { edgeId: "e3", source: "profile", target: "end" },
    ],
    variables: {},
    tags: [],
    nodeTemplates: [],
    rev: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  })

  it("registers each outputMapping key as a producer for its caller variable", () => {
    expect(analyzeVariableProvenance(workflow.nodes)["token"]).toEqual({
      producers: [{ nodeId: "auth", nodeLabel: "Sign in", path: "accessToken" }],
      consumers: [{ nodeId: "profile", nodeLabel: "Profile", fields: ["headers"] }],
    })
  })

  it("does not report the mapped variable as never produced or unresolved", () => {
    const codes = analyzeWorkflowGraph(workflow).diagnostics.map((item) => item.code)
    expect(codes).not.toContain("variable_source_missing")
    expect(codes).not.toContain("variable_producer_not_upstream")
  })
})

describe("analyzeWorkflowGraph — source handles", () => {
  /**
   * `start → source → after → end`. `after` is a plain HTTP node so the only
   * thing under test is the edge leaving `source`.
   */
  function graph(source: { nodeId: string; type: string; config?: Record<string, unknown> }, sourceHandle?: string | null): Workflow {
    return WorkflowSchema.parse({
      workflowId: "workflow-handle",
      workspaceId: "workspace-1",
      name: "Handle",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
        { position: { x: 100, y: 0 }, ...source },
        { nodeId: "after", type: "http-request", position: { x: 200, y: 0 }, config: { method: "GET", url: "https://example.test/after" } },
        { nodeId: "end", type: "end", position: { x: 300, y: 0 }, config: {} },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: source.nodeId },
        { edgeId: "e2", source: source.nodeId, target: "after", ...(sourceHandle === undefined ? {} : { sourceHandle }) },
        { edgeId: "e3", source: "after", target: "end" },
      ],
      variables: {},
      tags: [],
      nodeTemplates: [],
      rev: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }
  const sse = { nodeId: "stream", type: "sse", config: { url: "https://example.test/events" } }
  const streamingGrpc = { nodeId: "stream", type: "grpc", config: { callType: "server-streaming", target: "localhost:50051", service: "a.B", method: "Watch" } }
  const unaryGrpc = { nodeId: "stream", type: "grpc", config: { target: "localhost:50051", service: "a.B", method: "Get" } }
  const http = { nodeId: "stream", type: "http-request", config: { method: "GET", url: "https://example.test/x" } }
  const codes = (workflow: Workflow) => analyzeWorkflowGraph(workflow).diagnostics.map((item) => item.code)

  it.each<[string, { nodeId: string; type: string; config: Record<string, unknown> }, string | null]>([
    ["an SSE ready edge", sse, "ready"],
    ["an SSE complete edge", sse, "complete"],
    ["a WebSocket complete edge", { nodeId: "stream", type: "websocket", config: { url: "wss://example.test" } }, "complete"],
    ["a streaming gRPC complete edge", streamingGrpc, "complete"],
    ["a unary gRPC edge with no handle", unaryGrpc, null],
    ["an HTTP edge with no handle", http, null],
  ])("accepts %s", (_case, source, handle) => {
    const found = codes(graph(source, handle))
    expect(found).not.toContain("stream_edge_handle_invalid")
    expect(found).not.toContain("edge_source_handle_ignored")
  })

  it.each<[string, { nodeId: string; type: string; config: Record<string, unknown> }, string | null]>([
    ["an SSE edge with no handle", sse, null],
    ["an SSE edge from a handle it does not have", sse, "pass"],
    ["a streaming gRPC edge with no handle", streamingGrpc, null],
  ])("rejects %s", (_case, source, handle) => {
    const diagnostic = analyzeWorkflowGraph(graph(source, handle)).diagnostics.find((item) => item.code === "stream_edge_handle_invalid")
    expect(diagnostic).toMatchObject({
      severity: "error",
      category: "branch",
      nodeIds: ["after", "stream"],
      evidence: { edgeId: "e2", sourceType: source.type, sourceHandle: handle ?? "", expectedHandles: ["ready", "complete"] },
      remediation: { kind: "set_edge_source_handle", edgeId: "e2" },
    })
    expect(diagnostic?.message).toContain('"ready" or "complete"')
  })

  it.each<[string, { nodeId: string; type: string; config: Record<string, unknown> }, string]>([
    ["a unary gRPC edge from a handle it does not have", unaryGrpc, "complete"],
    ["an HTTP edge from a handle it does not have", http, "pass"],
  ])("warns about %s, which the canvas would not draw", (_case, source, handle) => {
    const diagnostic = analyzeWorkflowGraph(graph(source, handle)).diagnostics.find((item) => item.code === "edge_source_handle_ignored")
    expect(diagnostic).toMatchObject({
      severity: "warning",
      category: "topology",
      evidence: { edgeId: "e2", sourceType: source.type, sourceHandle: handle },
      remediation: { kind: "set_edge_source_handle", edgeId: "e2" },
    })
    expect(codes(graph(source, handle))).not.toContain("stream_edge_handle_invalid")
  })
})