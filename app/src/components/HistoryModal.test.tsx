import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RunSummary } from "@shared/types/RunSummary";
import HistoryModal from "./HistoryModal";
import { apiweave } from "../utils/apiweaveClient";

vi.mock("../utils/apiweaveClient", () => ({
  apiweave: {
    runs: {
      history: vi.fn(),
      delete: vi.fn(),
      clearHistory: vi.fn(),
    },
  },
}));

function summary(runId: string, status: RunSummary["status"], createdAt: string): RunSummary {
  return {
    runId,
    workspaceId: "ws-1",
    workflowId: "wf-1",
    status,
    trigger: "manual",
    startedAt: null,
    completedAt: null,
    duration: null,
    failedNodes: [],
    failedNodeCount: 0,
    nodeCount: 0,
    runRev: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

const runs = [
  summary("run-newer", "completed", "2026-09-16T10:00:00.000Z"),
  summary("run-from-call", "failed", "2026-09-16T09:00:00.000Z"),
];

describe("HistoryModal", () => {
  beforeEach(() => {
    // jsdom has no layout, so it implements no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(apiweave.runs.history).mockReset();
    vi.mocked(apiweave.runs.history).mockResolvedValue({ items: runs, nextCursor: null });
    vi.mocked(apiweave.runs.delete).mockResolvedValue(null);
  });

  it("lists run summaries for the workflow", async () => {
    render(<HistoryModal workflowId="wf-1" workspaceId="ws-1" onClose={() => {}} onSelectRun={() => {}} />);

    await screen.findByText("completed");
    expect(apiweave.runs.history).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", workflowId: "wf-1" }),
    );
  });

  it("marks and scrolls to the run a Call Workflow node jumped here for", async () => {
    render(
      <HistoryModal
        workflowId="wf-1"
        workspaceId="ws-1"
        highlightRunId="run-from-call"
        onClose={() => {}}
        onSelectRun={() => {}}
      />,
    );

    await screen.findByText("failed");
    const highlighted = document.querySelectorAll('[data-highlighted="true"]');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]?.textContent).toContain("failed");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("marks nothing when opened by hand", async () => {
    render(<HistoryModal workflowId="wf-1" workspaceId="ws-1" onClose={() => {}} onSelectRun={() => {}} />);

    await screen.findByText("completed");
    expect(document.querySelectorAll("[data-highlighted]")).toHaveLength(0);
  });

  it("deletes a run after confirmation and reloads the list", async () => {
    const onSelectRun = vi.fn();
    render(<HistoryModal workflowId="wf-1" workspaceId="ws-1" onClose={() => {}} onSelectRun={onSelectRun} />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete run run-newer" }));
    vi.mocked(apiweave.runs.history).mockResolvedValue({ items: [runs[1]!], nextCursor: null });
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(apiweave.runs.delete).toHaveBeenCalledWith("ws-1", "run-newer"));
    await waitFor(() => expect(screen.queryByText("completed")).toBeNull());
    expect(onSelectRun).not.toHaveBeenCalled();
  });
});
