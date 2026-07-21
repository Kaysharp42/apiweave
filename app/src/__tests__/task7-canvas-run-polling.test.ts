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

  function mount() {
    return renderHook(() =>
      useWorkflowPolling({
        workspaceId: "ws-1",
        workflowId: "wf-1",
        nodes: nodesBox.nodes,
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

  it("(b) a node.completed event repaints that node's executionStatus", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.runWorkflow();
    });

    act(() => {
      captured.cb?.({
        kind: "node.completed",
        runId: "run-1",
        nodeId: "http_1",
        status: "running",
        variables: {},
      });
    });

    const node = nodesBox.nodes.find((n) => n.id === "http_1");
    expect(node?.data?.["executionStatus"]).toBe("running");
  });

  it("(b2) a failed node.completed event paints the error detail", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.runWorkflow();
    });

    act(() => {
      captured.cb?.({
        kind: "node.completed",
        runId: "run-1",
        nodeId: "http_1",
        status: "failed",
        variables: {},
        error: "URL is required for HTTP request",
      });
    });

    const node = nodesBox.nodes.find((n) => n.id === "http_1");
    expect(node?.data?.["executionStatus"]).toBe("error");
    expect(node?.data?.["executionResult"]).toEqual({
      error: "URL is required for HTTP request",
    });
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
