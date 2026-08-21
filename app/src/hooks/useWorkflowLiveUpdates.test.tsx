import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@shared/types/Workflow";
import type { Node } from "reactflow";
import { workflowToCanvas } from "../adapters/workflowCanvas";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import useWorkflowLiveUpdates from "./useWorkflowLiveUpdates";

const onWorkflowChangedMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/apiweaveClient", () => ({
  onWorkflowChanged: onWorkflowChangedMock,
}));

function makeWorkflow(rev = 1): Workflow {
  return {
    workflowId: "wf1",
    workspaceId: "ws1",
    name: "Workflow",
    nodes: [
      {
        nodeId: "n1",
        type: "start",
        position: { x: 0, y: 0 },
        config: {},
      },
    ],
    edges: [],
    variables: {},
    selectedEnvironmentId: null,
    tags: [],
    nodeTemplates: [],
    rev,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: `2026-01-01T00:00:0${rev}.000Z`,
  } as Workflow;
}

describe("useWorkflowLiveUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onWorkflowChangedMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the newest event after the coalescing window", () => {
    let listener: ((workflow: Workflow) => void) | null = null;
    onWorkflowChangedMock.mockImplementation((callback) => {
      listener = callback;
      return () => {
        listener = null;
      };
    });
    const onWorkflow = vi.fn();
    const workflow = makeWorkflow();
    const changedWorkflow = { ...makeWorkflow(3), name: "Changed" };
    const nodes = workflowToCanvas(workflow).nodes;

    renderHook(() =>
      useWorkflowLiveUpdates({
        workspaceId: "ws1",
        workflowId: "wf1",
        workflow,
        nodes,
        edges: [],
        variables: {},
        onWorkflow,
      }),
    );

    act(() => {
      listener?.(makeWorkflow(2));
      listener?.(changedWorkflow);
      vi.advanceTimersByTime(49);
    });
    expect(onWorkflow).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onWorkflow).toHaveBeenCalledTimes(1);
    expect(onWorkflow).toHaveBeenCalledWith(changedWorkflow);
  });

  it("ignores a newer revision with identical content", () => {
    let listener: ((workflow: Workflow) => void) | null = null;
    onWorkflowChangedMock.mockImplementation((callback) => {
      listener = callback;
      return () => {
        listener = null;
      };
    });
    const workflow = makeWorkflow();
    const onWorkflow = vi.fn();

    renderHook(() =>
      useWorkflowLiveUpdates({
        workspaceId: "ws1",
        workflowId: "wf1",
        workflow,
        nodes: workflowToCanvas(workflow).nodes,
        edges: [],
        variables: {},
        onWorkflow,
      }),
    );

    act(() => {
      listener?.(makeWorkflow(2));
      vi.advanceTimersByTime(50);
    });

    expect(onWorkflow).not.toHaveBeenCalled();
  });

  it("does not replace a dirty canvas, then retries once it is clean", () => {
    let listener: ((workflow: Workflow) => void) | null = null;
    onWorkflowChangedMock.mockImplementation((callback) => {
      listener = callback;
      return () => {
        listener = null;
      };
    });
    const onWorkflow = vi.fn();
    const workflow = makeWorkflow();
    const cleanNodes = workflowToCanvas(workflow).nodes;
    const { rerender } = renderHook(
      ({ nodes }: { nodes: Node<WorkflowCanvasNodeData>[] }) =>
        useWorkflowLiveUpdates({
          workspaceId: "ws1",
          workflowId: "wf1",
          workflow,
          nodes,
          edges: [],
          variables: {},
          onWorkflow,
        }),
      {
        initialProps: {
          nodes: cleanNodes.map((node) => ({
            ...node,
            position: { x: 10, y: 0 },
          })),
        },
      },
    );

    act(() => {
      listener?.({ ...makeWorkflow(2), name: "Changed" });
      vi.advanceTimersByTime(50);
    });
    expect(onWorkflow).not.toHaveBeenCalled();

    rerender({ nodes: cleanNodes });
    expect(onWorkflow).toHaveBeenCalledTimes(1);
  });
});
