import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { preserveCanvasRuntimeState, useHydration } from "./useHydration";
import type { Workflow } from "@shared/types/Workflow";
import type { Edge, Node } from "@xyflow/react";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import type { WorkflowCanvasEdgeData } from "../types/WorkflowCanvasEdgeData";
import { initialWorkflowGraph } from "@shared/graph/initial_workflow_graph";

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
      ({ workflow }) => useHydration({ workflow, nodes: [], edges: [], setNodes, setEdges }),
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
      ({ workflow }) => useHydration({ workflow, nodes: [], edges: [], setNodes, setEdges }),
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
      ({ workflow }) => useHydration({ workflow, nodes: [], edges: [], setNodes, setEdges }),
      { initialProps: { workflow: makeWorkflow() } },
    );
    expect(setNodes).toHaveBeenCalledTimes(1);

    // The canvas saved its own edit; the echo carries a real content change.
    act(() => result.current.noteSavedWorkflow(saved));
    rerender({ workflow: saved });

    expect(setNodes).toHaveBeenCalledTimes(1);
  });
});

describe("useHydration canvasMatchesBaseline", () => {
  type CanvasNodes = Node<WorkflowCanvasNodeData>[];
  type CanvasEdges = Edge<WorkflowCanvasEdgeData>[];

  /** `setNodes` is a spy that does not re-render, which is exactly the lag:
   * the canvas shows the previous graph until the test commits a new one. */
  function mount(workflow: Workflow) {
    const setNodes = vi.fn();
    const setEdges = vi.fn();
    const initial = { nodes: [] as CanvasNodes, edges: [] as CanvasEdges };
    const hook = renderHook(
      ({ workflow: wf, nodes, edges }) =>
        useHydration({ workflow: wf, nodes, edges, setNodes, setEdges }),
      { initialProps: { workflow, ...initial } },
    );
    return { ...hook, initial };
  }

  const startEnd = initialWorkflowGraph();
  const startEndWorkflow = () =>
    makeWorkflow({ nodes: startEnd.nodes, edges: startEnd.edges });

  it("is not satisfied between the baseline write and the canvas commit", () => {
    const { result, rerender, initial } = mount(startEndWorkflow());

    // Hydration queued its graph and wrote the baseline; the canvas has not
    // committed it, so a save would still read the pre-hydration state.
    expect(result.current.hydratedBaselineRef.current).toEqual({
      nodeCount: 2,
      edgeCount: 1,
    });
    expect(result.current.canvasMatchesBaseline()).toBe(false);

    // An unrelated re-render that keeps the same arrays changes nothing.
    rerender({ workflow: startEndWorkflow(), ...initial });
    expect(result.current.canvasMatchesBaseline()).toBe(false);

    // The commit carrying the hydrated graph.
    rerender({ workflow: startEndWorkflow(), nodes: [], edges: [] });
    expect(result.current.canvasMatchesBaseline()).toBe(true);
  });

  it("survives a commit of the old graph in the very render that delivers the workflow", () => {
    const hydratedFromScratch = {
      nodes: [] as CanvasNodes,
      edges: [] as CanvasEdges,
    };
    const { result, rerender } = renderHook(
      (props: {
        workflow: Workflow | null;
        nodes: CanvasNodes;
        edges: CanvasEdges;
      }) =>
        useHydration({
          ...props,
          setNodes: vi.fn(),
          setEdges: vi.fn(),
        }),
      {
        initialProps: {
          workflow: null as Workflow | null,
          ...hydratedFromScratch,
        },
      },
    );

    // The canvas re-renders with rebuilt (still pre-hydration) arrays in the
    // same commit the workflow arrives in, as useNodeBranchCounts does.
    rerender({ workflow: startEndWorkflow(), nodes: [], edges: [] });

    expect(result.current.canvasMatchesBaseline()).toBe(false);
    rerender({ workflow: startEndWorkflow(), nodes: [], edges: [] });
    expect(result.current.canvasMatchesBaseline()).toBe(true);
  });

  it("allows saves once a hydrated Start→End canvas is committed, and after the user edits back to Start→End", () => {
    const { result, rerender } = mount(startEndWorkflow());
    const workflow = startEndWorkflow();

    rerender({ workflow, nodes: [], edges: [] });
    expect(result.current.canvasMatchesBaseline()).toBe(true);

    // The user adds a node, saves, then deletes it: the baseline follows the
    // saves and the canvas commits each edit.
    result.current.hydratedBaselineRef.current = { nodeCount: 3, edgeCount: 2 };
    rerender({ workflow, nodes: [], edges: [] });
    result.current.hydratedBaselineRef.current = { nodeCount: 2, edgeCount: 1 };
    rerender({ workflow, nodes: [], edges: [] });
    expect(result.current.canvasMatchesBaseline()).toBe(true);
  });

  it("holds a save back after showWorkflow-style baseline writes until the canvas commits", () => {
    const { result, rerender } = mount(startEndWorkflow());
    rerender({ workflow: startEndWorkflow(), nodes: [], edges: [] });
    expect(result.current.canvasMatchesBaseline()).toBe(true);

    act(() => result.current.setHydratedBaseline({ nodeCount: 14, edgeCount: 13 }));
    expect(result.current.canvasMatchesBaseline()).toBe(false);

    rerender({ workflow: startEndWorkflow(), nodes: [], edges: [] });
    expect(result.current.canvasMatchesBaseline()).toBe(true);
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
