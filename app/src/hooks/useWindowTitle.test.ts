import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useTabStore from "../stores/TabStore";
import type { WorkspaceTab } from "../types/WorkspaceTab";
import { useWindowTitle } from "./useWindowTitle";

const workspace = vi.hoisted(() => ({
  current: { workspaceId: "ws-1", name: "Acme" } as {
    workspaceId: string;
    name: string;
  } | null,
}));

vi.mock("../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ currentWorkspace: workspace.current }),
}));

const TAB: WorkspaceTab = {
  id: "wf-1",
  workflowId: "wf-1",
  workspaceId: "ws-1",
  name: "Orders",
  isDirty: false,
};

beforeEach(() => {
  workspace.current = { workspaceId: "ws-1", name: "Acme" };
  useTabStore.setState({
    tabs: [TAB],
    activeTabIdByWorkspace: { "ws-1": "wf-1" },
  });
  document.title = "";
});

describe("useWindowTitle", () => {
  it("names the active workflow, its workspace and the app", () => {
    renderHook(() => useWindowTitle());

    expect(document.title).toBe("Orders — Acme — APIWeave");
  });

  it("falls back to the app's name with no active tab", () => {
    workspace.current = { workspaceId: "ws-1", name: "Acme" };
    useTabStore.setState({ tabs: [], activeTabIdByWorkspace: {} });

    renderHook(() => useWindowTitle());

    expect(document.title).toBe("APIWeave");
  });

  it("follows a rename, a tab switch and a workspace switch", () => {
    const { rerender } = renderHook(() => useWindowTitle());

    act(() => useTabStore.getState().renameTab("wf-1", "Orders v2"));
    expect(document.title).toBe("Orders v2 — Acme — APIWeave");

    act(() => {
      useTabStore.setState({
        tabs: [
          { ...TAB, name: "Orders v2" },
          {
            id: "wf-2",
            workflowId: "wf-2",
            workspaceId: "ws-1",
            name: "Checkout",
            isDirty: false,
          },
        ],
      });
      useTabStore.getState().setActive("wf-2");
    });
    expect(document.title).toBe("Checkout — Acme — APIWeave");

    // The workspace provider re-renders the shell on a switch; the hook reads
    // the new workspace's active tab rather than the last one's.
    workspace.current = { workspaceId: "ws-2", name: "Personal" };
    act(() => {
      useTabStore.setState({
        tabs: [
          {
            id: "wf-3",
            workflowId: "wf-3",
            workspaceId: "ws-2",
            name: "Payments",
            isDirty: false,
          },
        ],
        activeTabIdByWorkspace: { "ws-2": "wf-3" },
      });
    });
    rerender();

    expect(document.title).toBe("Payments — Personal — APIWeave");
  });
});
