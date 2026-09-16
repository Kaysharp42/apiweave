import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import CallWorkflowNode from "./CallWorkflowNode";
import useSidebarStore from "../../stores/SidebarStore";
import useCanvasStore from "../../stores/CanvasStore";
import useTabStore from "../../stores/TabStore";
import { apiweave } from "../../utils/apiweaveClient";

vi.mock("../../utils/apiweaveClient", () => ({
  apiweave: { workflows: { get: vi.fn() } },
}));

describe("CallWorkflowNode", () => {
  beforeEach(() => {
    useSidebarStore.setState({ activeWorkspaceId: "workspace-1" });
    useCanvasStore.setState({ pendingHistory: null });
    useTabStore.setState({ tabs: [], activeTabIdByWorkspace: {} });
  });

  it("shows a configured target workflow name instead of its internal reference", () => {
    render(
      <ReactFlowProvider>
        <CallWorkflowNode
          id="call-1"
          data={{
            label: "Call login",
            config: {
              targetWorkflowId: "01MY_TARGET_WORKFLOW",
              targetWorkflowName: "Log in",
            },
          }}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByText("calls")).toBeTruthy();
    expect(screen.getByText("Log in")).toBeTruthy();
    expect(screen.queryByText("01MY_TARGET_WORKFLOW")).toBeNull();
  });

  it("jumps to the target workflow and asks it to open History on the call's own run", async () => {
    vi.mocked(apiweave.workflows.get).mockResolvedValue({
      workflowId: "01MY_TARGET_WORKFLOW",
      workspaceId: "workspace-1",
      name: "Log in",
    } as Awaited<ReturnType<typeof apiweave.workflows.get>>);

    render(
      <ReactFlowProvider>
        <CallWorkflowNode
          id="call-1"
          data={{
            config: {
              targetWorkflowId: "01MY_TARGET_WORKFLOW",
              targetWorkflowName: "Log in",
            },
            executionStatus: "error",
            executionResult: {
              message: "Sub-workflow Log in failed in 1 node(s)",
              subWorkflow: {
                workflowId: "01MY_TARGET_WORKFLOW",
                runId: "01CHILD_RUN",
                status: "failed",
                nodeCount: 2,
                failedNodeCount: 1,
                outputVariableNames: [],
              },
            },
          }}
        />
      </ReactFlowProvider>,
    );

    fireEvent.click(screen.getByTitle("Expand"));
    fireEvent.click(screen.getByText("Open this run in the target workflow"));

    // The request is parked before the tab opens — the target canvas reads it
    // on mount, which happens only once its tab is active.
    expect(useCanvasStore.getState().pendingHistory).toEqual({
      workflowId: "01MY_TARGET_WORKFLOW",
      runId: "01CHILD_RUN",
    });
    await waitFor(() =>
      expect(
        useTabStore.getState().tabs.map((tab) => tab.workflowId),
      ).toEqual(["01MY_TARGET_WORKFLOW"]),
    );
  });

  it("offers no jump for a call that produced no run of its own", () => {
    render(
      <ReactFlowProvider>
        <CallWorkflowNode
          id="call-1"
          data={{
            config: {
              targetWorkflowId: "01MY_TARGET_WORKFLOW",
              targetWorkflowName: "Log in",
            },
            executionResult: {
              message: "Sub-workflow Log in completed",
              subWorkflow: {
                workflowId: "01MY_TARGET_WORKFLOW",
                status: "passed",
                nodeCount: 2,
                failedNodeCount: 0,
                outputVariableNames: [],
              },
            },
          }}
        />
      </ReactFlowProvider>,
    );

    fireEvent.click(screen.getByTitle("Expand"));
    expect(screen.queryByText("Open this run in the target workflow")).toBeNull();
  });

  it("resolves a missing target name without exposing the target reference", async () => {
    vi.mocked(apiweave.workflows.get).mockResolvedValueOnce({
      name: "Log in",
    } as Awaited<ReturnType<typeof apiweave.workflows.get>>);

    render(
      <ReactFlowProvider>
        <CallWorkflowNode
          id="call-1"
          data={{
            config: { targetWorkflowId: "01MY_TARGET_WORKFLOW" },
          }}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByText("loading target workflow")).toBeTruthy();
    expect(await screen.findByText("Log in")).toBeTruthy();
    expect(screen.queryByText("01MY_TARGET_WORKFLOW")).toBeNull();
  });
});
