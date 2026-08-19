import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ScopeContext } from "../types";

let scope: ScopeContext = {
  workspaceId: "ws-1",
  workspaceSlug: "ws-one",
  orgId: null,
  orgSlug: null,
  userId: "user-1",
  isReady: true,
};

vi.mock("./useScopeContext", () => ({
  useScopeContext: () => scope,
}));

const { useWorkspaceTabs } = await import("./useWorkspaceTabs");
const { default: useTabStore } = await import("../stores/TabStore");

function inWorkspace(workspaceId: string, slug: string): ScopeContext {
  return {
    workspaceId,
    workspaceSlug: slug,
    orgId: null,
    orgSlug: null,
    userId: "user-1",
    isReady: true,
  };
}

describe("useWorkspaceTabs", () => {
  beforeEach(() => {
    scope = inWorkspace("ws-1", "ws-one");
    useTabStore.setState({
      tabs: [
        {
          id: "wf-a",
          workflowId: "wf-a",
          workspaceId: "ws-1",
          name: "Actor Module",
          isDirty: false,
        },
        {
          id: "wf-b",
          workflowId: "wf-b",
          workspaceId: "ws-2",
          name: "Billing",
          isDirty: false,
        },
      ],
      activeTabIdByWorkspace: { "ws-1": "wf-a", "ws-2": "wf-b" },
    });
  });

  it("returns only the current workspace's tabs", () => {
    const { result } = renderHook(() => useWorkspaceTabs());

    expect(result.current.tabs.map((t) => t.workflowId)).toEqual(["wf-a"]);
    expect(result.current.activeTabId).toBe("wf-a");
    expect(result.current.activeTab?.name).toBe("Actor Module");
  });

  it("swaps the slice in the same render the workspace changes", () => {
    // The regression this guards: while the switch was applied in an effect,
    // the canvas rendered one frame with the new workspace's id and the old
    // workspace's workflow, and every scoped main-process call made on mount
    // — `agents:resolveLocalPath` among them — failed with "workflow not found".
    const { result, rerender } = renderHook(() => useWorkspaceTabs());
    expect(result.current.activeTab?.workflowId).toBe("wf-a");

    scope = inWorkspace("ws-2", "ws-two");
    rerender();

    expect(result.current.workspaceId).toBe("ws-2");
    expect(result.current.tabs.map((t) => t.workflowId)).toEqual(["wf-b"]);
    expect(result.current.activeTab?.workflowId).toBe("wf-b");
  });

  it("shows no tabs for a workspace that has none open", () => {
    scope = inWorkspace("ws-3", "ws-three");
    const { result } = renderHook(() => useWorkspaceTabs());

    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.activeTab).toBeUndefined();
  });

  it("falls back to the last open tab when the recorded id is gone", () => {
    useTabStore.setState({ activeTabIdByWorkspace: { "ws-1": "wf-closed" } });
    const { result } = renderHook(() => useWorkspaceTabs());

    expect(result.current.activeTabId).toBe("wf-a");
  });
});
