import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowNode } from "@shared/types/WorkflowNode";
import { VersionHistoryDialog } from "../VersionHistoryDialog";
import { apiweave } from "../../../utils/apiweaveClient";

vi.mock("../../../utils/apiweaveClient", () => ({
  apiweave: {
    workflows: {
      listRevisions: vi.fn(),
      getRevision: vi.fn(),
      get: vi.fn(),
    },
  },
}));

const node = (nodeId: string, duration = 1): WorkflowNode =>
  ({ nodeId, type: "delay", position: { x: 0, y: 0 }, config: { duration } }) as WorkflowNode;

const summary = {
  revisionId: "rev-1",
  workflowId: "wf-1",
  source: "agent:Claude Code",
  workflowRev: 4,
  nodeCount: 2,
  edgeCount: 0,
  createdAt: "2026-10-01T09:00:00.000Z",
};

describe("VersionHistoryDialog", () => {
  beforeEach(() => {
    vi.mocked(apiweave.workflows.listRevisions).mockResolvedValue([summary]);
    vi.mocked(apiweave.workflows.get).mockResolvedValue({ nodes: [node("a"), node("b", 9), node("c")] } as never);
    vi.mocked(apiweave.workflows.getRevision).mockResolvedValue({
      ...summary,
      snapshot: { name: "Orders", description: null, nodes: [node("a"), node("b")], edges: [], variables: {}, tags: [], nodeTemplates: [] },
    });
  });

  it("shows what restoring a version changes, and restores it once confirmed", async () => {
    const onRestore = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<VersionHistoryDialog workspaceId="ws-1" workflowId="wf-1" onClose={onClose} onRestore={onRestore} />);

    fireEvent.click(await screen.findByRole("option", { name: /Before agent Claude Code/ }));
    expect(await screen.findByText("Restoring it: 0 nodes added, 1 removed, 1 changed.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore this version" });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Restore")!);

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith("rev-1"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("says why a restore failed and stays open", async () => {
    const onRestore = vi.fn().mockRejectedValue(new Error("This workflow changed while you were looking."));
    const onClose = vi.fn();
    render(<VersionHistoryDialog workspaceId="ws-1" workflowId="wf-1" onClose={onClose} onRestore={onRestore} />);

    fireEvent.click(await screen.findByRole("option", { name: /Before agent/ }));
    await screen.findByText(/Restoring it:/);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore this version" });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Restore")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("This workflow changed while you were looking.");
    expect(onClose).not.toHaveBeenCalled();
  });
});
