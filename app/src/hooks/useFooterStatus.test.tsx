import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { WorkspaceTab } from "../types/WorkspaceTab";
import useRunStatusStore from "../stores/RunStatusStore";
import { useFooterStatus } from "./useFooterStatus";

const tabsView = vi.hoisted(() => ({
  activeTab: null as WorkspaceTab | null,
}));

vi.mock("./useWorkspaceTabs", () => ({
  useWorkspaceTabs: () => ({
    workspaceId: "ws-1",
    tabs: tabsView.activeTab === null ? [] : [tabsView.activeTab],
    activeTabId: tabsView.activeTab?.id ?? null,
    activeTab: tabsView.activeTab ?? undefined,
  }),
}));

const TAB = {
  id: "wf-a",
  workflowId: "wf-a",
  workspaceId: "ws-1",
  name: "Checkout",
  isDirty: false,
} as WorkspaceTab;

function setRun(phase: "running" | "completed" | "failed" | "cancelled" | "interrupted", durationMs: number | null) {
  useRunStatusStore.setState({
    byWorkflow: { "wf-a": { runId: "run-1", phase, durationMs } },
  });
}

beforeEach(() => {
  tabsView.activeTab = TAB;
  useRunStatusStore.setState({ byWorkflow: {} });
});

describe("useFooterStatus", () => {
  it("says nothing when the active workflow has not run", () => {
    const { result } = renderHook(() => useFooterStatus());
    expect(result.current).toBeNull();
  });

  it("says nothing without an active workflow tab", () => {
    tabsView.activeTab = null;
    setRun("completed", 1200);

    const { result } = renderHook(() => useFooterStatus());
    expect(result.current).toBeNull();
  });

  it("reports a run in progress", () => {
    setRun("running", null);

    const { result } = renderHook(() => useFooterStatus());
    expect(result.current).toEqual({ phase: "running", label: "Running…" });
  });

  it("reports the last run's outcome and duration", () => {
    setRun("completed", 2640);

    const { result } = renderHook(() => useFooterStatus());
    expect(result.current).toEqual({
      phase: "completed",
      label: "Last run passed · 2.6s",
    });
  });

  it("reports a failed run without inventing a duration", () => {
    setRun("failed", null);

    const { result } = renderHook(() => useFooterStatus());
    expect(result.current).toEqual({
      phase: "failed",
      label: "Last run failed",
    });
  });

  it("reports a cancelled run rather than calling it failed", () => {
    setRun("cancelled", null);

    const { result } = renderHook(() => useFooterStatus());
    expect(result.current).toMatchObject({
      phase: "cancelled",
      label: "Last run cancelled",
    });
  });
});
