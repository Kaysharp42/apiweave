import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { CloudSyncStatus } from "../types/cloud";

const navigate = vi.fn();
const status = vi.fn();
let emitCloudStatusChanged: (() => void) | undefined;

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

vi.mock("../utils/apiweaveClient", () => ({
  apiweave: { cloud: { status: () => status() } },
  onCloudStatusChanged: (callback: () => void) => {
    emitCloudStatusChanged = callback;
    return () => {
      emitCloudStatusChanged = undefined;
    };
  },
}));

const { useAccountSessionReset } = await import("./useAccountSessionReset");
const { default: useTabStore } = await import("../stores/TabStore");
const { default: useSidebarStore } = await import("../stores/SidebarStore");

function statusForAccount(accountId: string | null): CloudSyncStatus {
  return {
    linked: accountId !== null,
    active: false,
    linkState: accountId === null ? "unlinked" : "linked",
    syncState: "idle",
    state: "idle",
    pendingCount: 0,
    deadLetterCount: 0,
    conflictCount: 0,
    workspaceIds: [],
    bindings: [],
    workspaceCatalog: [],
    teamCatalog: [],
    ...(accountId === null ? {} : { account: { accountId } }),
  } as CloudSyncStatus;
}

function seedSession(): void {
  useTabStore.setState({
    tabs: [
      {
        id: "wf-old",
        workflowId: "wf-old",
        workspaceId: "ws-old",
        name: "Old account workflow",
        isDirty: false,
      },
    ],
    activeTabIdByWorkspace: { "ws-old": "wf-old" },
  });
  useSidebarStore.setState({ activeWorkspaceId: "ws-old" });
  localStorage.setItem("defaultEnvironment", "env-old");
}

describe("useAccountSessionReset", () => {
  beforeEach(() => {
    navigate.mockReset();
    status.mockReset();
    emitCloudStatusChanged = undefined;
    seedSession();
  });

  it("clears tabs, workspace, environment and route when the account changes", async () => {
    status
      .mockResolvedValueOnce(statusForAccount("account-a"))
      .mockResolvedValueOnce(statusForAccount("account-b"));
    renderHook(() => useAccountSessionReset());
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));

    // Baseline observation must not disturb the session.
    expect(useTabStore.getState().tabs).toHaveLength(1);

    emitCloudStatusChanged?.();

    await waitFor(() => expect(useTabStore.getState().tabs).toHaveLength(0));
    expect(useTabStore.getState().activeTabIdByWorkspace).toEqual({});
    expect(useSidebarStore.getState().activeWorkspaceId).toBeNull();
    expect(localStorage.getItem("defaultEnvironment")).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/app", { replace: true });
  });

  it("clears the session on disconnect, when no account remains", async () => {
    status
      .mockResolvedValueOnce(statusForAccount("account-a"))
      .mockResolvedValueOnce(statusForAccount(null));
    renderHook(() => useAccountSessionReset());
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));

    emitCloudStatusChanged?.();

    await waitFor(() => expect(useTabStore.getState().tabs).toHaveLength(0));
    expect(navigate).toHaveBeenCalledWith("/app", { replace: true });
  });

  it("leaves the session alone when the same account reports again", async () => {
    status.mockResolvedValue(statusForAccount("account-a"));
    renderHook(() => useAccountSessionReset());
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));

    emitCloudStatusChanged?.();
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useSidebarStore.getState().activeWorkspaceId).toBe("ws-old");
    expect(localStorage.getItem("defaultEnvironment")).toBe("env-old");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves the session alone when cloud sync is unavailable", async () => {
    status.mockRejectedValue(new Error("no bridge"));
    renderHook(() => useAccountSessionReset());
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));

    emitCloudStatusChanged?.();
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));

    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});
