import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { preserveCanvasRuntimeState, useHydration } from "./useHydration";
import type { Workflow } from "@shared/types/Workflow";
import type { Node } from "@xyflow/react";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    workflowId: "wf1",
    workspaceId: "ws1",
    name: "wf",
    nodes: [
      { nodeId: "n1", type: "http-request", position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [],
    variables: {},
    tags: [],
    nodeTemplates: [],
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Workflow;
}

/** A `setNodes` that behaves like the real one: applies updater functions to
 * the nodes currently on the canvas, so what hydration hands back is testable. */
function makeNodesState(initial: Node<WorkflowCanvasNodeData>[]) {
  const state = { nodes: initial };
  const setNodes = vi.fn((next: unknown) => {
    state.nodes =
      typeof next === "function"
        ? (
            next as (
              previous: Node<WorkflowCanvasNodeData>[],
            ) => Node<WorkflowCanvasNodeData>[]
          )(state.nodes)
        : (next as Node<WorkflowCanvasNodeData>[]);
  });
  return { state, setNodes };
}

describe("useHydration", () => {
  it("re-hydrates on content change but not on rev-only echoes", () => {
    const setNodes = vi.fn();
    const setEdges = vi.fn();
    const { rerender } = renderHook(
      ({ workflow }) => useHydration({ workflow, setNodes, setEdges }),
      { initialProps: { workflow: makeWorkflow() } },
    );

    // initial hydration
    expect(setNodes).toHaveBeenCalledTimes(1);

    // save echo: only rev/updatedAt bumped, new object identity -> no re-hydrate
    rerender({
      workflow: makeWorkflow({ rev: 2, updatedAt: "2026-01-02T00:00:00.000Z" }),
    });
    expect(setNodes).toHaveBeenCalledTimes(1);

    // genuine content change -> re-hydrate
    rerender({
      workflow: makeWorkflow({
        rev: 3,
        nodes: [
          { nodeId: "n1", type: "http-request", position: { x: 5, y: 5 }, config: {} },
        ],
      }),
    });
    expect(setNodes).toHaveBeenCalledTimes(2);
  });

  it("keeps the displayed run on nodes that survive a re-hydration", () => {
    const { state, setNodes } = makeNodesState([]);
    const setEdges = vi.fn();
    const { rerender } = renderHook(
      ({ workflow }) => useHydration({ workflow, setNodes, setEdges }),
      { initialProps: { workflow: makeWorkflow() } },
    );

    // The run paints its result onto the hydrated node.
    state.nodes = state.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        executionStatus: "success",
        executionResult: { statusCode: 200 },
        executionTimestamp: 1234,
      },
    }));

    rerender({
      workflow: makeWorkflow({
        rev: 2,
        nodes: [
          {
            nodeId: "n1",
            type: "http-request",
            position: { x: 5, y: 5 },
            config: { url: "https://example.test" },
          },
        ],
      }),
    });

    const node = state.nodes[0];
    expect(node?.position).toEqual({ x: 5, y: 5 });
    expect(node?.data.config).toEqual({ url: "https://example.test" });
    expect(node?.data.executionStatus).toBe("success");
    expect(node?.data.executionResult).toEqual({ statusCode: 200 });
    expect(node?.data.executionTimestamp).toBe(1234);
  });

  it("does not re-hydrate from the echo of a save it made itself", () => {
    const setNodes = vi.fn();
    const setEdges = vi.fn();
    const saved = makeWorkflow({
      rev: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
      variables: { actorId: "actor-1" },
    });

    const { result, rerender } = renderHook(
      ({ workflow }) => useHydration({ workflow, setNodes, setEdges }),
      { initialProps: { workflow: makeWorkflow() } },
    );
    expect(setNodes).toHaveBeenCalledTimes(1);

    // The canvas saved its own edit; the echo carries a real content change.
    act(() => result.current.noteSavedWorkflow(saved));
    rerender({ workflow: saved });

    expect(setNodes).toHaveBeenCalledTimes(1);
  });
});

describe("preserveCanvasRuntimeState", () => {
  it("carries canvas-only data across and lets persisted fields win", () => {
    const loaded = [
      {
        id: "n1",
        type: "http-request",
        position: { x: 1, y: 1 },
        data: { label: "Renamed", config: { url: "b" } },
      },
    ] as Node<WorkflowCanvasNodeData>[];
    const previous = [
      {
        id: "n1",
        type: "http-request",
        position: { x: 0, y: 0 },
        data: {
          label: "Old",
          config: { url: "a" },
          executionStatus: "error",
          branchCount: 3,
        },
      },
    ] as Node<WorkflowCanvasNodeData>[];

    const merged = preserveCanvasRuntimeState(loaded, previous);

    expect(merged[0]?.data).toEqual({
      label: "Renamed",
      config: { url: "b" },
      executionStatus: "error",
      branchCount: 3,
    });
  });

  it("leaves nodes the reload introduced untouched", () => {
    const loaded = [
      {
        id: "n2",
        type: "http-request",
        position: { x: 0, y: 0 },
        data: { config: {} },
      },
    ] as Node<WorkflowCanvasNodeData>[];
    const previous = [
      {
        id: "n1",
        type: "http-request",
        position: { x: 0, y: 0 },
        data: { config: {}, executionStatus: "success" },
      },
    ] as Node<WorkflowCanvasNodeData>[];

    const merged = preserveCanvasRuntimeState(loaded, previous);

    expect(merged[0]).toBe(loaded[0]);
  });
});
