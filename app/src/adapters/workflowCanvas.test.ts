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
      config: { duration: 250, jitter: { minMs: 100, maxMs: 500 }, continueOnFail: false },
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
    {
      nodeId: "note-1",
      type: "note",
      label: "Retry context",
      position: { x: 660, y: 160 },
      config: { content: "Retries start after the first failure." },
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
  it("hydrates canonical nodes and handles without inventing edge appearance", () => {
    const canvas = workflowToCanvas(workflow);

    expect(canvas.nodes.map((node) => [node.id, node.type])).toEqual([
      ["start-1", "start"],
      ["request-1", "http-request"],
      ["assertion-1", "assertion"],
      ["delay-1", "delay"],
      ["merge-1", "merge"],
      ["end-1", "end"],
      ["note-1", "note"],
    ]);
    expect(canvas.nodes[1]?.data).toEqual({
      label: "Create order",
      config: workflow.nodes[1]?.config,
    });
    expect(canvas.edges[2]).toMatchObject({
      id: "edge-assertion-delay",
      sourceHandle: "pass",
      targetHandle: null,
      label: "Pass",
    });
    // Hydration hands the canvas plumbing, never appearance. Both properties
    // this used to set claimed something about a workflow nobody had run:
    // `animated` marched the edge forever, and `style.stroke` painted the pass
    // branch in the success token — the same green a *traversed* edge uses, so
    // reopening a workflow showed branches already lit. `CustomEdge` derives
    // both from live run status.
    expect(canvas.edges[2]?.animated).toBeUndefined();
    expect(canvas.edges[2]?.style).toBeUndefined();
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


  // #4: a frame is a persisted node whose geometry lives in `config`, and
  // `parentId` is the only reason a node's `position` is not a canvas
  // coordinate. Both have to survive the boundary in both directions.
  it("round-trips a group frame and its members", () => {
    const framed: Workflow = {
      ...workflow,
      nodes: [
        ...workflow.nodes.map((node) =>
          node.nodeId === "request-1"
            ? { ...node, parentId: "group-1", position: { x: 28, y: 28 } }
            : node,
        ),
        {
          nodeId: "group-1",
          type: "group",
          label: "Checkout",
          position: { x: 180, y: 0 },
          config: { width: 420, height: 260, color: "blue" },
        },
      ],
    };

    const canvas = workflowToCanvas(framed);
    const frame = canvas.nodes[0];
    const member = canvas.nodes.find((node) => node.id === "request-1");

    // The frame is hoisted to the front: ReactFlow needs a parent before its
    // children, and array order is what puts the frame behind them.
    expect(frame?.id).toBe("group-1");
    expect(frame?.width).toBe(420);
    expect(frame?.height).toBe(260);
    expect(member).toMatchObject({ parentId: "group-1", extent: "parent" });

    const result = canvasToWorkflow(canvas, framed);
    const persistedFrame = result.nodes.find((node) => node.nodeId === "group-1");

    expect(persistedFrame).toEqual({
      nodeId: "group-1",
      type: "group",
      label: "Checkout",
      position: { x: 180, y: 0 },
      config: { width: 420, height: 260, color: "blue" },
    });
    expect(
      result.nodes.find((node) => node.nodeId === "request-1"),
    ).toMatchObject({ parentId: "group-1", position: { x: 28, y: 28 } });
  });

  it("drops a parentId the cloud merge left dangling", () => {
    const orphaned: Workflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.nodeId === "request-1" ? { ...node, parentId: "group-gone" } : node,
      ),
    };

    const canvas = workflowToCanvas(orphaned);

    expect(canvas.nodes.find((node) => node.id === "request-1")).not.toHaveProperty(
      "parentId",
    );
  });

  it("rejects legacy renderer discriminators at the persistence boundary", () => {
    const canvas = workflowToCanvas(workflow);
    const request = canvas.nodes[1];
    if (!request) throw new Error("representative graph is incomplete");
    request.type = "httpRequest";

    expect(() => canvasToWorkflow(canvas, workflow)).toThrow();
  });
});
