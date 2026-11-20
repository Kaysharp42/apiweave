import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation";
import type { NodeModalNode } from "../types/NodeModalNode";

const acceptSnapshot = vi
  .fn()
  .mockResolvedValue({ accepted: true, updatedAt: "2026-11-17T00:00:00.000Z" });
vi.mock("../utils/apiweaveClient", () => ({ apiweave: { runs: { acceptSnapshot } } }));
vi.mock("../stores/SidebarStore", () => ({
  default: (select: (state: { activeWorkspaceId: string | null }) => unknown) =>
    select({ activeWorkspaceId: "ws-1" }),
}));

const WorkflowContext = (await import("../contexts/WorkflowContext")).default;
const { NodeModal } = await import("./NodeModal");

afterEach(() => {
  acceptSnapshot.mockClear();
});

const rule = (overrides: Partial<AssertionEvaluation>): AssertionEvaluation => ({
  ruleIndex: 0,
  source: "prev",
  path: "response.body.stock",
  operator: "matchesSnapshot",
  sourceNodeId: "http-1",
  expectedState: "not-required",
  expectedType: null,
  actualState: "present",
  actualType: "number",
  outcome: "fail",
  reasonCode: "comparison-failed",
  schemaErrors: [{ path: "$.stock", message: "expected 4, got 5" }],
  ...overrides,
});

/** The result the HTTP node produced: what its snapshot rule read. */
const HTTP_RESULT = {
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: { stock: 5 },
  duration: 12,
};

const assertionNode = (assertions: readonly AssertionEvaluation[]): NodeModalNode => ({
  id: "check_stock",
  type: "assertion",
  position: { x: 0, y: 0 },
  data: {
    label: "Check stock",
    config: {
      assertions: [
        {
          sourceNodeId: "http-1",
          source: "prev",
          path: "response.body.stock",
          operator: "matchesSnapshot",
        },
      ],
    },
    executionResult: { assertions },
    executionStatus: "success",
  },
});

function renderModal(node: NodeModalNode, outputs: Readonly<Record<string, unknown>>) {
  const getNodeOutput = vi.fn((nodeId: string) => outputs[nodeId]);
  render(
    <WorkflowContext.Provider value={{ workflowId: "wf-1" } as never}>
      <NodeModal
        open
        node={node}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveWorkflow={vi.fn()}
        steps={{ previous: [], next: [], arrivedBy: null, onStep: vi.fn() }}
        workspaceId="ws-1"
        currentWorkflowId="wf-1"
        getNodeOutput={getNodeOutput}
      />
    </WorkflowContext.Provider>,
  );
  return getNodeOutput;
}

describe("NodeModal shows an Assertion node's snapshot review", () => {
  it("offers Accept for a failed snapshot rule and lists what differs", () => {
    renderModal(assertionNode([rule({})]), { "http-1": HTTP_RESULT });

    expect(screen.getByRole("button", { name: "Accept snapshot #1" })).toBeEnabled();
    expect(screen.getByRole("list", { name: "Snapshot differences" })).toHaveTextContent(
      "$.stock expected 4, got 5",
    );
  });

  it("accepts the snapshot under the assertion node's id, with the value its rule inspected", async () => {
    const user = userEvent.setup();
    const getNodeOutput = renderModal(
      assertionNode([
        // A rule the panel has nothing to accept for must not shift the index.
        rule({ ruleIndex: 0, operator: "equals", outcome: "pass", schemaErrors: undefined }),
        rule({ ruleIndex: 1 }),
      ]),
      { "http-1": HTTP_RESULT },
    );

    expect(screen.getByRole("button", { name: "Accept snapshot #2" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Accept snapshot #2" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Snapshot accepted" })).toBeInTheDocument(),
    );
    expect(getNodeOutput).toHaveBeenCalledWith("http-1");
    expect(acceptSnapshot).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workflowId: "wf-1",
      nodeId: "check_stock",
      ruleIndex: 1,
      value: 5,
    });
  });

  it("disables Accept when the rule's source is no node result", () => {
    renderModal(assertionNode([rule({ sourceNodeId: null })]), { "http-1": HTTP_RESULT });

    expect(screen.getByRole("button", { name: "Accept snapshot #1" })).toBeDisabled();
  });

  it("shows no review on a node type that does not own assertion rules", () => {
    const delay: NodeModalNode = {
      id: "wait-1",
      type: "delay",
      position: { x: 0, y: 0 },
      data: {
        label: "Wait",
        config: { duration: 1000 },
        executionResult: { assertions: [rule({})] },
        executionStatus: "success",
      },
    };
    renderModal(delay, { "http-1": HTTP_RESULT });

    expect(screen.queryByRole("button", { name: "Accept snapshot #1" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Snapshot differences" })).toBeNull();
  });
});
