import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation";

const acceptSnapshot = vi.fn().mockResolvedValue({ accepted: true, updatedAt: "2026-11-17T00:00:00.000Z" });
vi.mock("../../utils/apiweaveClient", () => ({ apiweave: { runs: { acceptSnapshot } } }));
vi.mock("../../stores/SidebarStore", () => ({
  default: (select: (state: { activeWorkspaceId: string | null }) => unknown) => select({ activeWorkspaceId: "ws-1" }),
}));

const WorkflowContext = (await import("../../contexts/WorkflowContext")).default;
const { SnapshotReview } = await import("./SnapshotReview");

const rule = (overrides: Partial<AssertionEvaluation>): AssertionEvaluation => ({
  ruleIndex: 0,
  source: "prev",
  path: "response.body",
  operator: "matchesSnapshot",
  sourceNodeId: "detail",
  expectedState: "not-required",
  expectedType: null,
  actualState: "present",
  actualType: "object",
  outcome: "fail",
  reasonCode: "comparison-failed",
  schemaErrors: [{ path: "$.description", message: "changed" }],
  ...overrides,
});

function renderReview(assertions: AssertionEvaluation[], readActual: (rule: AssertionEvaluation) => unknown) {
  return render(
    <WorkflowContext.Provider value={{ workflowId: "wf-1" } as never}>
      <SnapshotReview nodeId="check_snapshot" assertions={assertions} readActual={readActual} showDifferences />
    </WorkflowContext.Provider>,
  );
}

describe("SnapshotReview", () => {
  it("accepts an Assertion node's snapshot under its own id, with the value the inspected node returned", async () => {
    const user = userEvent.setup();
    renderReview(
      [rule({ ruleIndex: 0, operator: "equals", source: "status" }), rule({ ruleIndex: 1 })],
      () => ({ description: "new copy" }),
    );

    expect(screen.getByRole("list", { name: "Snapshot differences" })).toHaveTextContent("$.description changed");
    expect(screen.queryByRole("button", { name: "Accept snapshot #1" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Accept snapshot #2" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Snapshot accepted" })).toBeInTheDocument());
    expect(acceptSnapshot).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workflowId: "wf-1",
      nodeId: "check_snapshot",
      ruleIndex: 1,
      value: { description: "new copy" },
    });
  });

  it("offers no accept when the compared value cannot be read, and renders nothing without snapshot rules", () => {
    const { container, rerender } = renderReview([rule({})], () => undefined);
    expect(screen.getByRole("button", { name: "Accept snapshot #1" })).toBeDisabled();

    rerender(
      <WorkflowContext.Provider value={{ workflowId: "wf-1" } as never}>
        <SnapshotReview nodeId="n" assertions={[rule({ operator: "equals" })]} readActual={() => 1} />
      </WorkflowContext.Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
