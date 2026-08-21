import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@shared/types/Workflow";
import type { WorkflowChangedEvent } from "@shared/types/WorkflowChangedEvent";
import type { Node } from "reactflow";
import { workflowToCanvas } from "../adapters/workflowCanvas";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import useWorkflowLiveUpdates from "./useWorkflowLiveUpdates";

const onWorkflowChangedMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/apiweaveClient", () => ({
  onWorkflowChanged: onWorkflowChangedMock,
}));

vi.mock("sonner", () => ({
  toast: { warning: toastWarningMock },
}));

type Listener = (event: WorkflowChangedEvent) => void;

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

function captureListener(): Listener {
  let listener: Listener | null = null;
  onWorkflowChangedMock.mockImplementation((callback: Listener) => {
    listener = callback;
    return () => {
      listener = null;
    };
  });
  return (event) => listener?.(event);
}

describe("useWorkflowLiveUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onWorkflowChangedMock.mockReset();
    toastWarningMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the newest event after the coalescing window", () => {
    const emit = captureListener();
    const onWorkflow = vi.fn();
    const onDetached = vi.fn();
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
        onDetached,
      }),
    );

    act(() => {
      emit({ kind: "upsert", workflow: makeWorkflow(2) });
      emit({ kind: "upsert", workflow: changedWorkflow });
      vi.advanceTimersByTime(49);
    });
    expect(onWorkflow).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onWorkflow).toHaveBeenCalledTimes(1);
    expect(onWorkflow).toHaveBeenCalledWith(changedWorkflow);
  });

  it("does not apply early when an unrelated rerender lands mid-window", () => {
    const emit = captureListener();
    const onWorkflow = vi.fn();
    const onDetached = vi.fn();
    const workflow = makeWorkflow();
    const nodes = workflowToCanvas(workflow).nodes;

    const { rerender } = renderHook(
      ({ nodes: currentNodes }: { nodes: Node<WorkflowCanvasNodeData>[] }) =>
        useWorkflowLiveUpdates({
          workspaceId: "ws1",
          workflowId: "wf1",
          workflow,
          nodes: currentNodes,
          edges: [],
          variables: {},
          onWorkflow,
          onDetached,
        }),
      { initialProps: { nodes } },
    );

    act(() => {
      emit({ kind: "upsert", workflow: { ...makeWorkflow(2), name: "Changed" } });
      vi.advanceTimersByTime(49);
    });
    // A canvas render between the event and the timer (run progress, hover
    // state — anything) must not spend the coalescing window.
    act(() => {
      rerender({ nodes: nodes.map((node) => ({ ...node })) });
    });
    expect(onWorkflow).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onWorkflow).toHaveBeenCalledTimes(1);
  });

  it("ignores a newer revision with identical content", () => {
    const emit = captureListener();
    const workflow = makeWorkflow();
    const onWorkflow = vi.fn();
    const onDetached = vi.fn();

    renderHook(() =>
      useWorkflowLiveUpdates({
        workspaceId: "ws1",
        workflowId: "wf1",
        workflow,
        nodes: workflowToCanvas(workflow).nodes,
        edges: [],
        variables: {},
        onWorkflow,
        onDetached,
      }),
    );

    act(() => {
      emit({ kind: "upsert", workflow: makeWorkflow(2) });
      vi.advanceTimersByTime(50);
    });

    expect(onWorkflow).not.toHaveBeenCalled();
  });

  it("does not replace a dirty canvas, then retries once it is clean", () => {
    const emit = captureListener();
    const onWorkflow = vi.fn();
    const onDetached = vi.fn();
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
          onDetached,
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
      emit({ kind: "upsert", workflow: { ...makeWorkflow(2), name: "Changed" } });
      vi.advanceTimersByTime(50);
    });
    expect(onWorkflow).not.toHaveBeenCalled();

    rerender({ nodes: cleanNodes });
    expect(onWorkflow).toHaveBeenCalledTimes(1);
  });

  it("warns when a held snapshot is discarded because a local save overtook it", () => {
    const emit = captureListener();
    const onWorkflow = vi.fn();
    const onDetached = vi.fn();
    const workflow = makeWorkflow();
    const dirtyNodes = workflowToCanvas(workflow).nodes.map((node) => ({
      ...node,
      position: { x: 10, y: 0 },
    }));
    // The tab's workflow carries a rev past the incoming snapshot, as it does
    // once a local autosave has won the race server-side.
    const overtaken = { ...workflow, rev: 5 };
    const { rerender } = renderHook(
      ({
        nodes,
        currentWorkflow,
      }: {
        nodes: Node<WorkflowCanvasNodeData>[];
        currentWorkflow: Workflow;
      }) =>
        useWorkflowLiveUpdates({
          workspaceId: "ws1",
          workflowId: "wf1",
          workflow: currentWorkflow,
          nodes,
          edges: [],
          variables: {},
          onWorkflow,
          onDetached,
        }),
      { initialProps: { nodes: dirtyNodes, currentWorkflow: workflow } },
    );

    act(() => {
      emit({ kind: "upsert", workflow: { ...makeWorkflow(2), name: "Remote" } });
      vi.advanceTimersByTime(50);
    });
    expect(onWorkflow).not.toHaveBeenCalled();

    // The local save's echo arrives: newer rev, local content still on the
    // canvas. The held remote snapshot is now unreachable — it must not go
    // quietly.
    rerender({ nodes: dirtyNodes, currentWorkflow: overtaken });

    expect(onWorkflow).not.toHaveBeenCalled();
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the overtaking write was this renderer's own save", () => {
    const emit = captureListener();
    const onWorkflow = vi.fn();
    const onDetached = vi.fn();
    const workflow = makeWorkflow();
    // What auto-save just wrote. The repository broadcasts it before the save
    // response returns, so its echo is held while the canvas still shows the
    // pre-response revision.
    const saved = { ...makeWorkflow(2), name: "Saved" };
    // The user kept typing inside the coalescing window, so the canvas matches
    // neither the tab's workflow nor the echo.
    const stillTypingNodes = workflowToCanvas(workflow).nodes.map((node) => ({
      ...node,
      position: { x: 42, y: 0 },
    }));
    const { rerender } = renderHook(
      ({ currentWorkflow }: { currentWorkflow: Workflow }) =>
        useWorkflowLiveUpdates({
          workspaceId: "ws1",
          workflowId: "wf1",
          workflow: currentWorkflow,
          nodes: stillTypingNodes,
          edges: [],
          variables: {},
          onWorkflow,
          onDetached,
        }),
      { initialProps: { currentWorkflow: workflow } },
    );

    act(() => {
      emit({ kind: "upsert", workflow: saved });
      vi.advanceTimersByTime(50);
    });
    expect(onWorkflow).not.toHaveBeenCalled();

    // The save response lands: the tab's workflow becomes the echo's content
    // and revision, so the held snapshot is now an overtaken duplicate of it.
    rerender({ currentWorkflow: saved });

    expect(onWorkflow).not.toHaveBeenCalled();
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("detaches the canvas when the open workflow is deleted", () => {
    const emit = captureListener();
    const onWorkflow = vi.fn();
    const onDetached = vi.fn();

    renderHook(() =>
      useWorkflowLiveUpdates({
        workspaceId: "ws1",
        workflowId: "wf1",
        workflow: makeWorkflow(),
        nodes: workflowToCanvas(makeWorkflow()).nodes,
        edges: [],
        variables: {},
        onWorkflow,
        onDetached,
      }),
    );

    act(() => {
      emit({ kind: "delete", workspaceId: "ws1", workflowId: "wf1" });
    });

    expect(onDetached).toHaveBeenCalledTimes(1);
    expect(onWorkflow).not.toHaveBeenCalled();
  });

  it("detaches the canvas when the workflow moves out of this workspace", () => {
    const emit = captureListener();
    const onWorkflow = vi.fn();
    const onDetached = vi.fn();

    renderHook(() =>
      useWorkflowLiveUpdates({
        workspaceId: "ws1",
        workflowId: "wf1",
        workflow: makeWorkflow(),
        nodes: workflowToCanvas(makeWorkflow()).nodes,
        edges: [],
        variables: {},
        onWorkflow,
        onDetached,
      }),
    );

    act(() => {
      emit({
        kind: "upsert",
        workflow: { ...makeWorkflow(2), workspaceId: "ws2" },
      });
    });

    expect(onDetached).toHaveBeenCalledTimes(1);
    expect(onWorkflow).not.toHaveBeenCalled();
  });

  it("ignores malformed snapshots instead of applying them", () => {
    const emit = captureListener();
    const onWorkflow = vi.fn();
    const onDetached = vi.fn();

    renderHook(() =>
      useWorkflowLiveUpdates({
        workspaceId: "ws1",
        workflowId: "wf1",
        workflow: makeWorkflow(),
        nodes: workflowToCanvas(makeWorkflow()).nodes,
        edges: [],
        variables: {},
        onWorkflow,
        onDetached,
      }),
    );

    act(() => {
      emit({
        kind: "upsert",
        workflow: { ...makeWorkflow(2), name: "" } as unknown as Workflow,
      });
      vi.advanceTimersByTime(50);
    });

    expect(onWorkflow).not.toHaveBeenCalled();
  });
});
