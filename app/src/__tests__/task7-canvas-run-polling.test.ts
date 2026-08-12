/**
 * Task 20 — Run progress streams over IPC events (SSE/polling removed).
 *
 * Verifies the run lifecycle in useWorkflowPolling:
 * (a) A run is triggered via the typed IPC client (runs.create), then the hook
 *     subscribes to the per-run progress topic — no setInterval, no EventSource.
 * (b) Each node.completed event repaints exactly one node's executionStatus.
 * (c) The terminal run.finished event stops the stream and clears isRunning.
 * (d) Cancel routes through runs.cancel.
 * (e) Static guards: the hook contains no polling/SSE machinery.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderHook, act } from "@testing-library/react";
import type { Node } from "reactflow";
import type { RunProgressEvent } from "@shared/types/RunProgressEvent";
import useWorkflowPolling from "../hooks/useWorkflowPolling";

const SRC_DIR = path.resolve(__dirname, "..");

type ContractResult =
  | { ok: true; data: unknown }
  | { ok: false; error: unknown };

// ─── Behavioural: run lifecycle over IPC events ─────────────────────────────

describe("Task 20: run progress streams over IPC events", () => {
  let invoke: Mock;
  let unsubscribe: Mock;
  let captured: { cb: ((e: RunProgressEvent) => void) | null };
  let nodesBox: { nodes: Node[] };
  let originalIpc: unknown;

  const setNodes = (updater: (nds: Node[]) => Node[]): void => {
    nodesBox.nodes = updater(nodesBox.nodes);
  };

  const runResult = {
    runId: "run-1",
    workspaceId: "ws-1",
    workflowId: "wf-1",
    status: "completed",
    results: [
      {
        nodeId: "http_1",
        status: "passed",
        response: { statusCode: 200, body: { ok: true } },
      },
    ],
    failedNodes: [],
  };

  beforeEach(() => {
    captured = { cb: null };
    unsubscribe = vi.fn();
    nodesBox = {
      nodes: [
        {
          id: "http_1",
          type: "http-request",
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
    };

    invoke = vi.fn(
      async (_domain: string, action: string): Promise<ContractResult> => {
        if (action === "create")
          return { ok: true, data: { ...runResult, status: "pending" } };
        if (action === "get") return { ok: true, data: runResult };
        if (action === "getLatestFailed") return { ok: true, data: null };
        if (action === "cancel") return { ok: true, data: runResult };
        return { ok: true, data: {} };
      },
    );

    originalIpc = (window as unknown as Record<string, unknown>)
      .__APIWEAVE_IPC__;
    (window as unknown as Record<string, unknown>).__APIWEAVE_IPC__ = {
      invoke,
      onRunProgress: (_runId: string, cb: (e: RunProgressEvent) => void) => {
        captured.cb = cb;
        return unsubscribe;
      },
    };
  });

  afterEach(() => {
    (window as unknown as Record<string, unknown>).__APIWEAVE_IPC__ =
      originalIpc;
    vi.clearAllMocks();
  });

  function mount(
    edges: ReadonlyArray<{
      source: string;
      target: string;
      id?: string;
      sourceHandle?: string | null;
    }> = [],
  ) {
    return renderHook(() =>
      useWorkflowPolling({
        workspaceId: "ws-1",
        workflowId: "wf-1",
        nodes: nodesBox.nodes,
        edges,
        setNodes,
        selectedEnvironment: null,
        reactFlowInstanceRef: null,
      }),
    );
  }

  it("(a) triggers runs.create and subscribes to the per-run topic", async () => {
    const { result } = mount();

    await act(async () => {
      await result.current.runWorkflow();
    });

    const created = invoke.mock.calls.find((c) => c[1] === "create");
    expect(created).toBeDefined();
    expect(created?.[0]).toBe("runs");
    expect(result.current.isRunning).toBe(true);
    expect(result.current.currentRunId).toBe("run-1");
    expect(captured.cb).toBeTypeOf("function");
  });

  it("(a2) flushes the canvas save before creating the run (no stale graph)", async () => {
    const order: string[] = [];
    const saveWorkflowRef = {
      current: vi.fn(async () => {
        order.push("save");
      }),
    };
    invoke = vi.fn(
      async (_domain: string, action: string): Promise<ContractResult> => {
        if (action === "create") {
          order.push("create");
          return { ok: true, data: { ...runResult, status: "pending" } };
        }
        if (action === "getLatestFailed") return { ok: true, data: null };
        return { ok: true, data: {} };
      },
    );
    (window as unknown as Record<string, unknown>).__APIWEAVE_IPC__ = {
      invoke,
      onRunProgress: (_runId: string, cb: (e: RunProgressEvent) => void) => {
        captured.cb = cb;
        return unsubscribe;
      },
    };

    const { result } = renderHook(() =>
      useWorkflowPolling({
        workspaceId: "ws-1",
        workflowId: "wf-1",
        nodes: nodesBox.nodes,
        edges: [],
        setNodes,
        selectedEnvironment: null,
        reactFlowInstanceRef: null,
        saveWorkflowRef,
      }),
    );

    await act(async () => {
      await result.current.runWorkflow();
    });

    expect(saveWorkflowRef.current).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["save", "create"]);
  });

  it("(b) a node.status event repaints that node's executionStatus", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.runWorkflow();
    });

    act(() => {
      captured.cb?.({
        kind: "node.status",
        runId: "run-1",
        nodeId: "http_1",
        status: "running",
        variables: {},
        seq: 1,
        ts: "2026-07-27T00:00:00.000Z",
      });
    });

    const node = nodesBox.nodes.find((n) => n.id === "http_1");
    expect(node?.data?.["executionStatus"]).toBe("running");
  });

  it("(b2) a failed node.status event paints the error detail", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.runWorkflow();
    });

    act(() => {
      captured.cb?.({
        kind: "node.status",
        runId: "run-1",
        nodeId: "http_1",
        status: "failed",
        variables: {},
        error: "URL is required for HTTP request",
        seq: 1,
        ts: "2026-07-27T00:00:00.000Z",
      });
    });

    const node = nodesBox.nodes.find((n) => n.id === "http_1");
    expect(node?.data?.["executionStatus"]).toBe("error");
    expect(node?.data?.["executionResult"]).toEqual({
      error: "URL is required for HTTP request",
    });
  });

  /**
   * The entry point's result is the one event this subscription can never
   * receive: the progress channel is keyed by runId, so it cannot be opened
   * until `runs.create` has replied — and the runner, which starts the run
   * inside that same call, has already stamped the start node as passed by then.
   * Its status used to arrive only with the end-of-run hydration, which left
   * every edge out of Start grey for the whole run while the rest of the canvas
   * lit up. A run beginning *is* the entry point passing, and this side knows
   * the moment it began.
   */
  it("(b3) paints the entry point when the run starts, not when it ends", async () => {
    nodesBox.nodes = [
      { id: "start_1", type: "start", position: { x: 0, y: 0 }, data: {} },
      ...nodesBox.nodes,
    ];

    const { result } = mount([{ source: "start_1", target: "http_1" }]);
    await act(async () => {
      await result.current.runWorkflow();
    });

    // Nothing has come down the stream — `captured.cb` has not been called.
    const start = nodesBox.nodes.find((n) => n.id === "start_1");
    expect(start?.data?.["executionStatus"]).toBe("success");
  });

  /**
   * `results` only covers nodes that produced one, and `start`/`end` execute
   * nothing — so reading a run through `results` alone left the terminal nodes
   * grey on a run that plainly reached them. `nodeStatuses` is the wider record
   * and covers both.
   */
  it("(b4) a historical run paints the terminal nodes it reached", async () => {
    nodesBox.nodes = [
      ...nodesBox.nodes,
      { id: "end_1", type: "end", position: { x: 0, y: 0 }, data: {} },
    ];
    invoke = vi.fn(
      async (_domain: string, action: string): Promise<ContractResult> => {
        if (action === "get")
          return {
            ok: true,
            data: { ...runResult, nodeStatuses: { end_1: "passed" } },
          };
        if (action === "getLatestFailed") return { ok: true, data: null };
        return { ok: true, data: {} };
      },
    );
    (window as unknown as Record<string, unknown>).__APIWEAVE_IPC__ = {
      invoke,
      onRunProgress: (_runId: string, cb: (e: RunProgressEvent) => void) => {
        captured.cb = cb;
        return unsubscribe;
      },
    };

    const { result } = mount();
    await act(async () => {
      await result.current.loadHistoricalRun({ runId: "run-1" });
    });

    const end = nodesBox.nodes.find((n) => n.id === "end_1");
    expect(end?.data?.["executionStatus"]).toBe("success");
    // The detail path still wins where there is detail to paint.
    const http = nodesBox.nodes.find((n) => n.id === "http_1");
    expect(http?.data?.["executionResult"]).toMatchObject({ statusCode: 200 });
  });

  it("(c) the terminal run.finished event stops the stream and clears isRunning", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.runWorkflow();
    });

    await act(async () => {
      captured.cb?.({
        kind: "run.finished",
        runId: "run-1",
        status: "completed",
        seq: 2,
        ts: "2026-07-27T00:00:00.000Z",
      });
      // let the hydrate/refresh microtasks settle
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isRunning).toBe(false);
    expect(unsubscribe).toHaveBeenCalled();
    // hydrateRunResults pulled the finished run and painted the node result
    const node = nodesBox.nodes.find((n) => n.id === "http_1");
    expect(node?.data?.["executionStatus"]).toBe("success"); // passed → success
    expect(node?.data?.["executionResult"]).toMatchObject({
      statusCode: 200,
      body: { ok: true },
    });
  });

  /**
   * The canvas plays a run back rather than mirroring it, so it is still
   * narrating for a beat after the runner is done. `video/apiweave 4.mp4` shows
   * the cost of not accounting for that: the toolbar flips back to "Run" at
   * t=12.5s while nodes are still lighting up until t=15.5s.
   */
  it("(c2) keeps isRunning true while the playback is still catching up", async () => {
    const { result } = mount([{ source: "start", target: "http_1" }]);
    await act(async () => {
      await result.current.runWorkflow();
    });

    await act(async () => {
      // `http_1` is gated behind the traversal out of `start`, so it is still
      // queued when the runner reports the run over.
      captured.cb?.({
        kind: "node.status",
        runId: "run-1",
        nodeId: "start",
        status: "passed",
        variables: {},
        seq: 1,
        ts: "2026-07-27T00:00:00.000Z",
      });
      captured.cb?.({
        kind: "node.status",
        runId: "run-1",
        nodeId: "http_1",
        status: "running",
        variables: {},
        seq: 2,
        ts: "2026-07-27T00:00:00.000Z",
      });
      captured.cb?.({
        kind: "run.finished",
        runId: "run-1",
        status: "completed",
        seq: 3,
        ts: "2026-07-27T00:00:00.000Z",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stream is closed — but the story is not finished being told.
    expect(unsubscribe).toHaveBeenCalled();
    expect(result.current.isRunning).toBe(true);

    // Cancel now means "skip the rest": there is no run left to stop, and
    // asking the scheduler to cancel a finished one only earns an error toast.
    await act(async () => {
      await result.current.cancelRun();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invoke.mock.calls.find((c) => c[1] === "cancel")).toBeUndefined();
    expect(result.current.isRunning).toBe(false);
    // Skipped, not dropped: the queued state landed on the canvas.
    const node = nodesBox.nodes.find((n) => n.id === "http_1");
    expect(node?.data?.["executionStatus"]).toBeDefined();
  });

  it("(d) cancelRun routes through runs.cancel", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.runWorkflow();
    });

    await act(async () => {
      await result.current.cancelRun();
    });

    const cancelled = invoke.mock.calls.find((c) => c[1] === "cancel");
    expect(cancelled).toBeDefined();
    expect(cancelled?.[0]).toBe("runs");
    expect(cancelled?.[2]).toMatchObject({
      workspaceId: "ws-1",
      runId: "run-1",
    });
  });

  // Regression: the canvas run gate used a truthiness check on `expectedValue`,
  // so `false`, `0` and `""` blocked the run while `assertion_validate`
  // accepted them. The gate now shares `analyzeWorkflowGraph`, which uses a
  // presence check — so falsy-but-present `expectedValue` sails through.
  it("(d2) does not block the run on a falsy-but-present assertion expectedValue (false/0/empty-string)", async () => {
    nodesBox.nodes = [
      { id: "start_1", type: "start", position: { x: 0, y: 0 }, data: {} },
      {
        id: "http_1",
        type: "http-request",
        position: { x: 100, y: 0 },
        data: { config: { method: "GET", url: "https://example.test" } },
      },
      {
        id: "assert_1",
        type: "assertion",
        position: { x: 200, y: 0 },
        data: {
          config: {
            assertions: [
              { source: "prev", path: "body.blacklisted", operator: "equals", expectedValue: false },
              { source: "prev", path: "body.count", operator: "equals", expectedValue: 0 },
              { source: "prev", path: "body.error", operator: "equals", expectedValue: "" },
              { source: "prev", path: "body.flag", operator: "notEquals", expectedValue: true },
            ],
          },
        },
      },
      { id: "end_1", type: "end", position: { x: 300, y: 0 }, data: {} },
    ];

    const { result } = mount([
      { id: "e1", source: "start_1", target: "http_1" },
      { id: "e2", source: "http_1", target: "assert_1" },
      { id: "e3", source: "assert_1", target: "end_1", sourceHandle: "pass" },
    ]);

    await act(async () => {
      await result.current.runWorkflow();
    });

    expect(invoke.mock.calls.find((c) => c[1] === "create")).toBeDefined();
  });
});

// ─── (e) Static guards: no polling / no SSE ─────────────────────────────────

describe("Task 20: useWorkflowPolling carries no polling or SSE machinery", () => {
  const source = fs.readFileSync(
    path.join(SRC_DIR, "hooks", "useWorkflowPolling.ts"),
    "utf-8",
  );

  it("does not use setInterval", () => {
    expect(source).not.toMatch(/setInterval\s*\(/);
  });

  it("does not use EventSource", () => {
    expect(source).not.toMatch(/EventSource/);
  });

  it("does not call authenticatedFetch or import legacy run URLs", () => {
    expect(source).not.toContain("authenticatedFetch");
    expect(source).not.toContain("/api/workflows/");
    expect(source).not.toContain("workflowRunStatusUrl");
  });

  it("subscribes via onRunProgress", () => {
    expect(source).toContain("onRunProgress");
  });
});
