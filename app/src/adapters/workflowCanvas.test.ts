import type { Workflow } from "@shared/types/Workflow";
import { describe, expect, it } from "vitest";
import { canvasToWorkflow, workflowToCanvas } from "./workflowCanvas";

const workflow: Workflow = {
  workflowId: "workflow-1",
  workspaceId: "workspace-1",
  name: "Checkout flow",
  description: "Exercises every persisted node kind",
  nodes: [
    {
      nodeId: "start-1",
      type: "start",
      label: "Start",
      position: { x: 20, y: 40 },
      config: {},
    },
    {
      nodeId: "request-1",
      type: "http-request",
      label: "Create order",
      position: { x: 220, y: 40 },
      config: {
        method: "POST",
        url: "{{env.API_URL}}/orders",
        headers: [{ key: "content-type", value: "application/json" }],
        queryParams: [{ key: "dryRun", value: "false", active: true }],
        body: '{"sku":"{{variables.sku}}"}',
        bodyType: "json",
        timeout: 30,
      },
    },
    {
      nodeId: "assertion-1",
      type: "assertion",
      label: "Order created",
      position: { x: 440, y: 40 },
      config: {
        assertions: [
          { source: "prev", path: "response.status", operator: "equals", expectedValue: 201 },
        ],
        continueOnFail: false,
      },
    },
    {
      nodeId: "delay-1",
      type: "delay",
      label: "Wait for processing",
      position: { x: 660, y: 0 },
      config: { duration: 250, continueOnFail: false },
    },
    {
      nodeId: "merge-1",
      type: "merge",
      label: "Join branches",
      position: { x: 860, y: 40 },
      config: {
        mergeStrategy: "conditional",
        conditions: [
          {
            branchIndex: 0,
            field: "response.status",
            operator: "equals",
            value: 201,
          },
        ],
        conditionLogic: "AND",
        continueOnFail: false,
      },
    },
    {
      nodeId: "end-1",
      type: "end",
      label: null,
      position: { x: 1060, y: 40 },
      config: {},
    },
  ],
  edges: [
    {
      edgeId: "edge-start-request",
      source: "start-1",
      target: "request-1",
      sourceHandle: null,
      targetHandle: null,
      label: null,
    },
    {
      edgeId: "edge-request-assertion",
      source: "request-1",
      target: "assertion-1",
      sourceHandle: null,
      targetHandle: null,
      label: "Response",
    },
    {
      edgeId: "edge-assertion-delay",
      source: "assertion-1",
      target: "delay-1",
      sourceHandle: "pass",
      targetHandle: null,
      label: "Pass",
    },
    {
      edgeId: "edge-assertion-end",
      source: "assertion-1",
      target: "end-1",
      sourceHandle: "fail",
      targetHandle: null,
      label: "Fail",
    },
    {
      edgeId: "edge-delay-merge",
      source: "delay-1",
      target: "merge-1",
      sourceHandle: null,
      targetHandle: "branch-0",
      label: "Processed",
    },
    {
      edgeId: "edge-merge-end",
      source: "merge-1",
      target: "end-1",
      sourceHandle: null,
      targetHandle: null,
      label: null,
    },
  ],
  variables: { sku: "SKU-42", retryCount: 2, enabled: true },
  tags: ["checkout", "smoke"],
  collectionId: "collection-1",
  selectedEnvironmentId: "environment-1",
  nodeTemplates: [{ label: "Create order", type: "http-request" }],
  rev: 7,
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:05:00.000Z",
};

describe("workflow canvas adapters", () => {
  it("hydrates canonical nodes, handles, and assertion edge presentation", () => {
    const canvas = workflowToCanvas(workflow);

    expect(canvas.nodes.map((node) => [node.id, node.type])).toEqual([
      ["start-1", "start"],
      ["request-1", "http-request"],
      ["assertion-1", "assertion"],
      ["delay-1", "delay"],
      ["merge-1", "merge"],
      ["end-1", "end"],
    ]);
    expect(canvas.nodes[1]?.data).toEqual({
      label: "Create order",
      config: workflow.nodes[1]?.config,
    });
    expect(canvas.edges[2]).toMatchObject({
      id: "edge-assertion-delay",
      sourceHandle: "pass",
      targetHandle: null,
      animated: true,
      style: { stroke: "var(--aw-status-success)", strokeWidth: 2 },
    });
    expect(canvas.variables).toEqual(workflow.variables);
    expect(canvas.selectedEnvironmentId).toBe("environment-1");
  });

  it("round-trips the canonical workflow without losing persisted metadata", () => {
    const result = canvasToWorkflow(workflowToCanvas(workflow), workflow);

    expect(result).toEqual(workflow);
  });

  it("keeps runtime canvas state out of persistence while applying canvas edits", () => {
    const canvas = workflowToCanvas(workflow);
    const request = canvas.nodes[1];
    const passEdge = canvas.edges[2];
    if (!request || !passEdge) throw new Error("representative graph is incomplete");

    request.position = { x: 300, y: 125 };
    request.data = {
      ...request.data,
      executionStatus: "success",
      executionResult: { status: 201 },
      executionTimestamp: 1234,
      invalid: false,
    };
    passEdge.data = { label: "Pass", runtimeOnly: "discard me" };
    passEdge.style = { stroke: "magenta", opacity: 0.5 };
    canvas.variables.orderId = "order-42";
    canvas.selectedEnvironmentId = "environment-2";

    const result = canvasToWorkflow(canvas, workflow);
    const persistedRequest = result.nodes[1];

    expect(persistedRequest?.position).toEqual({ x: 300, y: 125 });
    expect(persistedRequest).not.toHaveProperty("executionStatus");
    expect(persistedRequest).not.toHaveProperty("executionResult");
    expect(result.edges[2]).not.toHaveProperty("data");
    expect(result.edges[2]).not.toHaveProperty("style");
    expect(result.variables.orderId).toBe("order-42");
    expect(result.selectedEnvironmentId).toBe("environment-2");
    expect(result.collectionId).toBe("collection-1");
    expect(result.tags).toEqual(["checkout", "smoke"]);
    expect(result.nodeTemplates).toEqual(workflow.nodeTemplates);
    expect(result.rev).toBe(7);
  });

  it("rejects legacy renderer discriminators at the persistence boundary", () => {
    const canvas = workflowToCanvas(workflow);
    const request = canvas.nodes[1];
    if (!request) throw new Error("representative graph is incomplete");
    request.type = "httpRequest";

    expect(() => canvasToWorkflow(canvas, workflow)).toThrow();
  });
});
