import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Node } from "@xyflow/react";
import type { RunStartedEvent } from "@shared/types/RunStartedEvent";
import useWorkflowPolling from "./useWorkflowPolling";

const onRunStartedMock = vi.hoisted(() => vi.fn());
const onRunProgressMock = vi.hoisted(() => vi.fn());
const getLatestMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/apiweaveClient", () => ({
  apiweave: {
    runs: {
      getLatest: getLatestMock,
      getLatestFailed: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({ runId: "r", results: [] }),
      create: vi.fn(),
    },
  },
  onRunProgress: onRunProgressMock,
  onRunStarted: onRunStartedMock,
  IpcError: class IpcError extends Error {},
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}));

type Listener = (event: RunStartedEvent) => void;

/** Capture the run-started listener the hook registers, so a test can fire it. */
function captureRunStarted(): () => Listener {
  let listener: Listener | null = null;
  onRunStartedMock.mockImplementation((callback: Listener) => {
    listener = callback;
    return () => {
      listener = null;
    };
  });
  return () => {
    if (listener === null) throw new Error("no run-started listener registered");
    return listener;
  };
}

const NODES: Node[] = [
  { id: "start-1", type: "start", position: { x: 0, y: 0 }, data: {} },
  { id: "http-1", type: "http-request", position: { x: 200, y: 0 }, data: {} },
];

function setup() {
  const camera = {
    onRunStart: vi.fn(),
    onNodeShown: vi.fn(),
    onRunSettled: vi.fn(),
  };
  const view = renderHook(() =>
    useWorkflowPolling({
      workspaceId: "ws1",
      workflowId: "wf1",
      nodes: NODES,
      edges: [],
      setNodes: vi.fn(),
      selectedEnvironment: null,
      reactFlowInstanceRef: { current: null },
      camera,
    }),
  );
  return { camera, ...view };
}

describe("useWorkflowPolling — adopting a run it did not start", () => {
  beforeEach(() => {
    onRunStartedMock.mockReset();
    onRunProgressMock.mockReset();
    onRunProgressMock.mockReturnValue(() => undefined);
    getLatestMock.mockReset();
    getLatestMock.mockResolvedValue(undefined);
  });

  it("streams and follows a run started elsewhere for the open workflow", async () => {
    const listener = captureRunStarted();
    const { camera, result } = setup();

    await act(async () => {
      listener()({ runId: "run-agent", workspaceId: "ws1", workflowId: "wf1" });
    });

    expect(onRunProgressMock).toHaveBeenCalledWith(
      "run-agent",
      expect.any(Function),
    );
    expect(result.current.currentRunId).toBe("run-agent");
    expect(result.current.isRunning).toBe(true);
    // The camera is engaged on the entry points, exactly as for a local run —
    // this is the "camera follows an agent's run" guarantee.
    expect(camera.onRunStart).toHaveBeenCalledWith(["start-1"]);
  });

  it("ignores a run belonging to another workflow or workspace", async () => {
    const listener = captureRunStarted();
    const { result } = setup();

    await act(async () => {
      listener()({ runId: "other-wf", workspaceId: "ws1", workflowId: "wf2" });
      listener()({ runId: "other-ws", workspaceId: "ws2", workflowId: "wf1" });
    });

    expect(onRunProgressMock).not.toHaveBeenCalled();
    expect(result.current.currentRunId).toBeNull();
  });

  it("does not hijack a run it is already streaming", async () => {
    const listener = captureRunStarted();
    const { result } = setup();

    await act(async () => {
      listener()({ runId: "run-first", workspaceId: "ws1", workflowId: "wf1" });
    });
    await act(async () => {
      listener()({ runId: "run-second", workspaceId: "ws1", workflowId: "wf1" });
    });

    expect(result.current.currentRunId).toBe("run-first");
    expect(onRunProgressMock).toHaveBeenCalledTimes(1);
  });

  it("picks up a run already in flight when the canvas mounts", async () => {
    captureRunStarted();
    getLatestMock.mockResolvedValue({ runId: "run-inflight", status: "running" });
    const { camera, result } = setup();

    await waitFor(() => expect(result.current.currentRunId).toBe("run-inflight"));
    expect(onRunProgressMock).toHaveBeenCalledWith(
      "run-inflight",
      expect.any(Function),
    );
    expect(camera.onRunStart).toHaveBeenCalledWith(["start-1"]);
  });

  it("leaves the canvas alone when the latest run has already finished", async () => {
    captureRunStarted();
    getLatestMock.mockResolvedValue({ runId: "run-done", status: "completed" });
    const { result } = setup();

    await waitFor(() => expect(getLatestMock).toHaveBeenCalled());
    expect(result.current.currentRunId).toBeNull();
    expect(onRunProgressMock).not.toHaveBeenCalled();
  });
});
