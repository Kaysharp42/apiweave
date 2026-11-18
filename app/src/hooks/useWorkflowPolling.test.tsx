import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Node } from "@xyflow/react";
import type { RunStartedEvent } from "@shared/types/RunStartedEvent";
import useWorkflowPolling from "./useWorkflowPolling";
import useRunStatusStore from "../stores/RunStatusStore";

const onRunStartedMock = vi.hoisted(() => vi.fn());
const onRunProgressMock = vi.hoisted(() => vi.fn());
const getLatestMock = vi.hoisted(() => vi.fn());
const createIterationsMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());
const getLatestFailedMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/apiweaveClient", () => ({
  apiweave: {
    runs: {
      getLatest: getLatestMock,
      getLatestFailed: getLatestFailedMock,
      get: vi.fn().mockResolvedValue({ runId: "r", results: [] }),
      create: createMock,
      createIterations: createIterationsMock,
    },
  },
  onRunProgress: onRunProgressMock,
  onRunStarted: onRunStartedMock,
  IpcError: class IpcError extends Error {},
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, info: vi.fn(), success: vi.fn() },
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
  { id: "http-1", type: "http-request", position: { x: 200, y: 0 }, data: { label: "Get user" } },
];

type EdgeInput = {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};

type SetNodes = (updater: (nds: Node[]) => Node[]) => void;

function setup(
  options: {
    nodes?: Node[];
    edges?: EdgeInput[];
    setNodes?: SetNodes;
  } = {},
) {
  const camera = {
    onRunStart: vi.fn(),
    onNodeShown: vi.fn(),
    onRunSettled: vi.fn(),
  };
  const view = renderHook(() =>
    useWorkflowPolling({
      workspaceId: "ws1",
      workflowId: "wf1",
      nodes: options.nodes ?? NODES,
      edges: options.edges ?? [],
      setNodes: options.setNodes ?? vi.fn(),
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
    useRunStatusStore.setState({ byWorkflow: {} });
  });

  it("streams and follows a run started elsewhere for the open workflow", async () => {
    const listener = captureRunStarted();
    const { camera, result } = setup();

    await act(async () => {
      listener()({ runId: "run-agent", workspaceId: "ws1", workflowId: "wf1", iteration: null });
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
      listener()({ runId: "other-wf", workspaceId: "ws1", workflowId: "wf2", iteration: null });
      listener()({ runId: "other-ws", workspaceId: "ws2", workflowId: "wf1", iteration: null });
    });

    expect(onRunProgressMock).not.toHaveBeenCalled();
    expect(result.current.currentRunId).toBeNull();
  });

  it("publishes its run to the footer's status store", async () => {
    const listener = captureRunStarted();
    const { result } = setup();

    await act(async () => {
      listener()({ runId: "run-footer", workspaceId: "ws1", workflowId: "wf1", iteration: null });
    });

    expect(useRunStatusStore.getState().byWorkflow["wf1"]).toMatchObject({
      runId: "run-footer",
      phase: "running",
    });

    const progress = onRunProgressMock.mock.calls[0]![1] as (event: {
      kind: string;
      runId: string;
      status: string;
    }) => void;
    await act(async () => {
      progress({ kind: "run.finished", runId: "run-footer", status: "failed" });
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(useRunStatusStore.getState().byWorkflow["wf1"]).toMatchObject({
      runId: "run-footer",
      phase: "failed",
    });
  });

  it("does not hijack a run it is already streaming", async () => {
    const listener = captureRunStarted();
    const { result } = setup();

    await act(async () => {
      listener()({ runId: "run-first", workspaceId: "ws1", workflowId: "wf1", iteration: null });
    });
    await act(async () => {
      listener()({ runId: "run-second", workspaceId: "ws1", workflowId: "wf1", iteration: null });
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

describe("useWorkflowPolling — running with data", () => {
  const iteration = (index: number) => ({ groupId: "grp", index, count: 2 });
  // jsdom's File has no text(); Chromium's does.
  const dataFile = (content: string, name: string): File =>
    Object.assign(new File([content], name), { text: async () => content });

  beforeEach(() => {
    onRunStartedMock.mockReset();
    onRunProgressMock.mockReset();
    onRunProgressMock.mockReturnValue(() => undefined);
    getLatestMock.mockReset();
    getLatestMock.mockResolvedValue(undefined);
    createIterationsMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("runs once per row of a CSV file and shows which iteration is on screen", async () => {
    const listener = captureRunStarted();
    createIterationsMock.mockResolvedValue({ runId: "run-1", iteration: iteration(1) });
    const { result } = setup();

    await act(async () => {
      await result.current.runWorkflowWithData(dataFile("user\r\nann\r\nbob\r\n", "users.csv"));
    });

    expect(createIterationsMock).toHaveBeenCalledWith({
      workspaceId: "ws1",
      workflowId: "wf1",
      rows: [{ user: "ann" }, { user: "bob" }],
    });
    expect(result.current.currentRunId).toBe("run-1");
    expect(result.current.currentIteration).toEqual(iteration(1));

    // Iteration 1 ends; the main process starts iteration 2 and the canvas adopts it.
    const progress = onRunProgressMock.mock.calls[0]![1] as (event: { kind: string; runId: string; status: string }) => void;
    await act(async () => {
      progress({ kind: "run.finished", runId: "run-1", status: "completed" });
      listener()({ runId: "run-2", workspaceId: "ws1", workflowId: "wf1", iteration: iteration(2) });
    });
    expect(result.current.currentRunId).toBe("run-2");
    expect(result.current.currentIteration).toEqual(iteration(2));
  });

  it("refuses a data file it cannot read as rows, without starting a run", async () => {
    captureRunStarted();
    const { result } = setup();

    await act(async () => {
      await result.current.runWorkflowWithData(dataFile('{"not":"an array"}', "rows.json"));
    });

    expect(createIterationsMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("array of objects"));
  });
});

describe("useWorkflowPolling — the run gate refuses a branch that could never run", () => {
  beforeEach(() => {
    captureRunStarted();
    onRunProgressMock.mockReset();
    onRunProgressMock.mockReturnValue(() => undefined);
    getLatestMock.mockReset();
    getLatestMock.mockResolvedValue(undefined);
    createMock.mockReset();
    createMock.mockResolvedValue({ runId: "run-1", iteration: null });
    toastErrorMock.mockReset();
  });

  function canvas(nodes: Node[], edges: EdgeInput[]) {
    const box = { nodes };
    const setNodes: SetNodes = (updater) => {
      box.nodes = updater(box.nodes);
    };
    return { box, view: setup({ nodes, edges, setNodes }) };
  }

  const start = (): Node => ({ id: "start-1", type: "start", position: { x: 0, y: 0 }, data: {} });
  const end = (): Node => ({ id: "a-end", type: "end", position: { x: 400, y: 0 }, data: {} });

  it("refuses a server-streaming edge with no handle and marks its source node", async () => {
    const nodes: Node[] = [
      start(),
      {
        id: "z-grpc",
        type: "grpc",
        position: { x: 200, y: 0 },
        data: {
          config: {
            callType: "server-streaming",
            target: "localhost:50051",
            service: "a.B",
            method: "Watch",
          },
        },
      },
      end(),
    ];
    const { box, view } = canvas(nodes, [
      { id: "e1", source: "start-1", target: "z-grpc" },
      // The edge the bug left behind: drawn against `ready`, never followed.
      { id: "e2", source: "z-grpc", target: "a-end" },
    ]);

    await act(async () => {
      await view.result.current.runWorkflow();
    });

    expect(createMock).not.toHaveBeenCalled();
    // `nodeIds` is sorted, so `a-end` comes first; the edge's source is what
    // the user has to fix.
    expect(box.nodes.find((node) => node.id === "z-grpc")?.data["invalid"]).toBe(true);
    expect(box.nodes.find((node) => node.id === "a-end")?.data["invalid"]).toBeUndefined();

    const message = toastErrorMock.mock.calls[0]?.[0] as string;
    expect(message).toContain("Run blocked: invalid workflow");
    expect(message).toContain("z-grpc: An edge from a grpc stream node sets no sourceHandle");
  });

  it("refuses an assertion edge without a pass or fail handle and marks the assertion", async () => {
    const nodes: Node[] = [
      start(),
      {
        id: "http-1",
        type: "http-request",
        position: { x: 200, y: 0 },
        data: { config: { method: "GET", url: "https://example.test" } },
      },
      {
        id: "z-assert",
        type: "assertion",
        position: { x: 300, y: 0 },
        data: {
          config: {
            assertions: [{ source: "prev", path: "body.id", operator: "exists" }],
          },
        },
      },
      end(),
    ];
    const { box, view } = canvas(nodes, [
      { id: "e1", source: "start-1", target: "http-1" },
      { id: "e2", source: "http-1", target: "z-assert" },
      // No handle: the assertion's branch stops silently at run time.
      { id: "e3", source: "z-assert", target: "a-end" },
    ]);

    await act(async () => {
      await view.result.current.runWorkflow();
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(box.nodes.find((node) => node.id === "z-assert")?.data["invalid"]).toBe(true);
    expect(box.nodes.find((node) => node.id === "a-end")?.data["invalid"]).toBeUndefined();

    const message = toastErrorMock.mock.calls[0]?.[0] as string;
    expect(message).toContain("z-assert: An assertion edge must use the pass or fail source handle.");
  });

  it("still starts a run when the only error is a missing end node", async () => {
    const nodes: Node[] = [
      start(),
      {
        id: "http-1",
        type: "http-request",
        position: { x: 200, y: 0 },
        data: { config: { method: "GET", url: "https://example.test" } },
      },
    ];
    const { view } = canvas(nodes, [{ id: "e1", source: "start-1", target: "http-1" }]);

    await act(async () => {
      await view.result.current.runWorkflow();
    });

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("still starts a run for an assertion with no upstream response source", async () => {
    const nodes: Node[] = [
      start(),
      {
        id: "z-assert",
        type: "assertion",
        position: { x: 200, y: 0 },
        data: {
          config: {
            assertions: [{ source: "prev", path: "body.id", operator: "exists" }],
          },
        },
      },
      end(),
    ];
    const { view } = canvas(nodes, [
      { id: "e1", source: "start-1", target: "z-assert" },
      { id: "e2", source: "z-assert", target: "a-end", sourceHandle: "pass" },
    ]);

    await act(async () => {
      await view.result.current.runWorkflow();
    });

    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe("useWorkflowPolling — rerunning part of a workflow", () => {
  beforeEach(() => {
    captureRunStarted();
    onRunProgressMock.mockReset();
    onRunProgressMock.mockReturnValue(() => undefined);
    getLatestMock.mockReset();
    getLatestMock.mockResolvedValue(undefined);
    createMock.mockReset();
    createMock.mockResolvedValue({ runId: "rerun-1", iteration: null });
    getLatestFailedMock.mockReset();
    getLatestFailedMock.mockResolvedValue({ runId: "failed-1", failedNodes: ["http-1"] });
  });

  it("runs from a node, reusing the latest run unless told which", async () => {
    const { result } = setup();

    await act(async () => {
      result.current.runFromNode("http-1");
    });
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ workspaceId: "ws1", workflowId: "wf1", resume: { nodeId: "http-1" } }),
    );
    expect(result.current.currentRunId).toBe("rerun-1");
  });

  it("offers the latest failed run's failed steps by label and reruns them from that run", async () => {
    const { result } = setup();
    await waitFor(() =>
      expect(result.current.resumeOptions).toEqual([{ nodeId: "http-1", label: "Get user", type: "http-request" }]),
    );

    await act(async () => {
      result.current.rerunFailed();
    });
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ workspaceId: "ws1", workflowId: "wf1", resume: { fromRunId: "failed-1" } }),
    );
  });
});
