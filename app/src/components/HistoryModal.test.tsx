import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import HistoryModal from "./HistoryModal";
import { authenticatedFetch } from "../utils/apiweaveClient";

vi.mock("../utils/apiweaveClient", () => ({
  authenticatedFetch: vi.fn(),
  workflowRunsListUrl: () => "/runs",
}));

const runs = [
  { runId: "run-newer", status: "completed", createdAt: "2026-09-16T10:00:00Z" },
  { runId: "run-from-call", status: "failed", createdAt: "2026-09-16T09:00:00Z" },
];

describe("HistoryModal", () => {
  beforeEach(() => {
    // jsdom has no layout, so it implements no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(authenticatedFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ runs, total: runs.length }),
    } as Response);
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
    render(
      <HistoryModal
        workflowId="wf-1"
        workspaceId="ws-1"
        onClose={() => {}}
        onSelectRun={() => {}}
      />,
    );

    await screen.findByText("completed");
    expect(document.querySelectorAll("[data-highlighted]")).toHaveLength(0);
  });
});
