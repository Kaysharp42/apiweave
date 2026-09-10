import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import CallWorkflowNode from "./CallWorkflowNode";
import useSidebarStore from "../../stores/SidebarStore";
import { apiweave } from "../../utils/apiweaveClient";

vi.mock("../../utils/apiweaveClient", () => ({
  apiweave: { workflows: { get: vi.fn() } },
}));

describe("CallWorkflowNode", () => {
  beforeEach(() => {
    useSidebarStore.setState({ activeWorkspaceId: "workspace-1" });
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
