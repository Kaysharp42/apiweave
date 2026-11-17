import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep";
import { useBrowserRecordingStore } from "../stores/BrowserRecordingStore";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasNode } from "../types/CanvasNode";
import type { UseBrowserRecordingParams } from "../types/UseBrowserRecordingParams";
import { browser } from "../utils/apiweaveClient";
import { useBrowserRecording } from "./useBrowserRecording";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("../utils/apiweaveClient", () => ({
  browser: { startRecording: vi.fn(), stopRecording: vi.fn(), recordingStatus: vi.fn(), onRecording: vi.fn() },
}));

const recordingId = "recording-1";
const frameId = `frame-${recordingId}`;
const startNode: CanvasNode = { id: "start-1", type: "start", position: { x: 0, y: 0 }, data: { label: "Start", config: {} } };

const step = (stepId: string, url: string): RecordedBrowserStep => ({ stepId, config: { action: "navigate", url } });

/** One recorded step already on the canvas, as a user may have edited it since. */
function recordedNode(stepId: string, url: string): CanvasNode {
  return {
    id: stepId,
    type: "browser",
    position: { x: 0, y: 0 },
    parentId: frameId,
    extent: "parent",
    data: { label: "Navigate", config: { action: "navigate", url } },
  };
}

/**
 * A canvas to mount the hook over: the props it takes, and the graph it holds.
 * `setNodes` writes back into the refs the way the real canvas does, so a
 * remount starts from what the previous one left behind.
 */
function createCanvas(nodes: CanvasNode[], edges: CanvasEdge[] = []): {
  params: UseBrowserRecordingParams;
  nodes: () => CanvasNode[];
  edges: () => CanvasEdge[];
  setNodes: ReturnType<typeof vi.fn>;
  setEdges: ReturnType<typeof vi.fn>;
} {
  const graph: { nodes: CanvasNode[]; edges: CanvasEdge[] } = { nodes, edges };
  const nodesRef: MutableRefObject<CanvasNode[]> = { current: graph.nodes };
  const edgesRef: MutableRefObject<CanvasEdge[]> = { current: graph.edges };
  const setNodes = vi.fn((next: CanvasNode[]) => {
    graph.nodes = next;
    nodesRef.current = next;
  });
  const setEdges = vi.fn((next: CanvasEdge[]) => {
    graph.edges = next;
    edgesRef.current = next;
  });
  return {
    params: { workflowId: "wf", workspaceId: "ws", environmentId: null, isHydrated: true, isRunning: false, nodesRef, edgesRef, setNodes, setEdges },
    nodes: () => graph.nodes,
    edges: () => graph.edges,
    setNodes,
    setEdges,
  };
}

function mountRecording(canvas: ReturnType<typeof createCanvas>) {
  return renderHook(() => useBrowserRecording(canvas.params));
}

describe("useBrowserRecording placement", () => {
  beforeEach(() => {
    vi.mocked(browser.recordingStatus).mockResolvedValue(null);
    vi.mocked(browser.onRecording).mockReturnValue(() => undefined);
    useBrowserRecordingStore.setState({
      phase: "idle",
      operation: "record",
      nodeId: null,
      workflowId: "wf",
      recordingId,
      anchorId: "start-1",
      frameLabel: "Recording",
      steps: [],
      placedSteps: [],
    });
  });

  it("never re-places a step a previous canvas mounted, so the user's edits survive", () => {
    const recorded = step("browser-recording-1-1", "https://dev.test/login");
    useBrowserRecordingStore.setState({ steps: [recorded], placedSteps: [recorded] });
    // The user fixed the locator since the step was recorded.
    const edited = recordedNode(recorded.stepId, "https://prod.test/login");
    const canvas = createCanvas([startNode, edited]);

    const first = mountRecording(canvas);
    expect(canvas.setNodes).not.toHaveBeenCalled();
    expect(canvas.setEdges).not.toHaveBeenCalled();
    expect(canvas.nodes().find((node) => node.id === recorded.stepId)?.data.config).toEqual({ action: "navigate", url: "https://prod.test/login" });

    // Switching tabs and coming back mounts a fresh canvas, as does reopening the workflow.
    first.unmount();
    mountRecording(canvas);
    expect(canvas.setNodes).not.toHaveBeenCalled();
    expect(canvas.setEdges).not.toHaveBeenCalled();
    expect(canvas.nodes().find((node) => node.id === recorded.stepId)?.data.config).toEqual({ action: "navigate", url: "https://prod.test/login" });
  });

  it("places a step that arrived while no canvas was open, exactly once", () => {
    const recorded = step("browser-recording-1-1", "https://dev.test/login");
    useBrowserRecordingStore.setState({ steps: [recorded] });
    const canvas = createCanvas([startNode]);

    const first = mountRecording(canvas);
    expect(canvas.setNodes).toHaveBeenCalledTimes(1);
    expect(canvas.setEdges).toHaveBeenCalledTimes(1);
    expect(canvas.nodes().find((node) => node.id === recorded.stepId)?.data.config).toEqual({ action: "navigate", url: "https://dev.test/login" });
    expect(useBrowserRecordingStore.getState().placedSteps).toEqual([recorded]);

    first.unmount();
    mountRecording(canvas);
    expect(canvas.setNodes).toHaveBeenCalledTimes(1);
  });

  it("applies a step's latest config while mounted, then leaves it alone on the next mount", () => {
    const first = step("browser-recording-1-1", "https://dev.test/");
    useBrowserRecordingStore.setState({ steps: [first] });
    const canvas = createCanvas([startNode]);
    const hook = mountRecording(canvas);
    expect(canvas.setNodes).toHaveBeenCalledTimes(1);

    // A fill is sent again as the user types: the store replaces the step's object.
    const latest = step(first.stepId, "https://dev.test/login");
    act(() => useBrowserRecordingStore.setState({ steps: [latest] }));
    expect(canvas.setNodes).toHaveBeenCalledTimes(2);
    expect(canvas.nodes().find((node) => node.id === first.stepId)?.data.config).toEqual({ action: "navigate", url: "https://dev.test/login" });
    expect(useBrowserRecordingStore.getState().placedSteps).toEqual([latest]);

    hook.unmount();
    mountRecording(canvas);
    expect(canvas.setNodes).toHaveBeenCalledTimes(2);
    expect(canvas.nodes().find((node) => node.id === first.stepId)?.data.config).toEqual({ action: "navigate", url: "https://dev.test/login" });
  });

  it("puts a re-record's steps in place of the step and the browser steps after it, in one edit", () => {
    const inOldFrame = (id: string, action: string): CanvasNode => ({
      id,
      type: "browser",
      position: { x: 0, y: 0 },
      parentId: "frame-old",
      extent: "parent",
      data: { label: id, config: action === "navigate" ? { action, url: "https://dev.test/" } : { action, locator: { kind: "css", value: `#${id}` } } },
    });
    const frame: CanvasNode = { id: "frame-old", type: "group", position: { x: 0, y: 0 }, data: { label: "Recording", config: {} } };
    const end: CanvasNode = { id: "end-1", type: "end", position: { x: 0, y: 0 }, data: { label: "End", config: {} } };
    const edge = (source: string, target: string): CanvasEdge => ({ id: `${source}-${target}`, source, target });
    const canvas = createCanvas(
      [frame, startNode, inOldFrame("open", "navigate"), inOldFrame("delete", "click"), inOldFrame("confirm", "click"), end],
      [edge("start-1", "open"), edge("open", "delete"), edge("delete", "confirm"), edge("confirm", "end-1")],
    );
    const recorded = { stepId: "browser-recording-1-1", config: { action: "click" as const, locator: { kind: "css" as const, value: "#remove" } } };
    useBrowserRecordingStore.setState({ operation: "rerecord", nodeId: "delete", anchorId: null, steps: [recorded] });

    mountRecording(canvas);

    expect(canvas.setNodes).toHaveBeenCalledTimes(1);
    expect(canvas.nodes().map((node) => node.id).sort()).toEqual([frameId, "browser-recording-1-1", "end-1", "frame-old", "open", "start-1"].sort());
    expect(canvas.edges().map((e) => [e.source, e.target])).toEqual(
      expect.arrayContaining([["start-1", "open"], ["open", "browser-recording-1-1"], ["browser-recording-1-1", "end-1"]]),
    );
    expect(canvas.edges()).toHaveLength(3);
    expect(useBrowserRecordingStore.getState().anchorId).toBe("open");
  });

  it("leaves another workflow's canvas alone", () => {
    const recorded = step("browser-recording-1-1", "https://dev.test/");
    useBrowserRecordingStore.setState({ steps: [recorded] });
    const canvas = createCanvas([startNode]);
    renderHook(() =>
      useBrowserRecording({ ...canvas.params, workflowId: "other" }),
    );
    expect(canvas.setNodes).not.toHaveBeenCalled();
    expect(useBrowserRecordingStore.getState().placedSteps).toEqual([]);
  });
});

describe("useBrowserRecording control", () => {
  beforeEach(() => {
    vi.mocked(browser.recordingStatus).mockResolvedValue(null);
    vi.mocked(browser.onRecording).mockReturnValue(() => undefined);
    useBrowserRecordingStore.setState({ phase: "idle", stopping: false, operation: "record", nodeId: null, workflowId: "wf", recordingId, anchorId: "start-1", steps: [], placedSteps: [], picked: null });
  });

  it("tells the toolbar that Stop is cancelling a replay, not ending a recording", () => {
    const canvas = createCanvas([startNode]);
    const { result } = mountRecording(canvas);
    act(() => useBrowserRecordingStore.setState({ phase: "replaying", operation: "rerecord", stopping: false }));
    expect(result.current.control).toMatchObject({ state: "replaying", stopping: false });

    act(() => useBrowserRecordingStore.setState({ stopping: true }));
    // The phase stays, so the toolbar still knows nothing was recorded.
    expect(result.current.control).toMatchObject({ state: "replaying", stopping: true, stepCount: 0 });
  });

  it("reads another workflow's recording as elsewhere, with none of its steps", () => {
    const canvas = createCanvas([startNode]);
    useBrowserRecordingStore.setState({ phase: "recording", workflowId: "other", steps: [step("browser-recording-1-1", "https://dev.test/")] });

    const { result } = mountRecording(canvas);

    expect(result.current.control).toMatchObject({ state: "elsewhere", stopping: false, stepCount: 0, disabled: false });
    // The other workflow's canvas places its steps, not this one.
    expect(canvas.setNodes).not.toHaveBeenCalled();
  });

  it("is disabled while a run is in progress or the canvas has no workflow yet", () => {
    const canvas = createCanvas([startNode]);
    const running = renderHook(() => useBrowserRecording({ ...canvas.params, isRunning: true }));
    expect(running.result.current.control.disabled).toBe(true);

    const unwired = renderHook(() => useBrowserRecording({ ...canvas.params, workflowId: undefined }));
    expect(unwired.result.current.control.disabled).toBe(true);
  });
});
