import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceGitStatuses } from "./useWorkspaceGitStatuses";
import { installGitBridge, trackedStatus, untrackedStatus } from "../__tests__/gitFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWorkspaceGitStatuses", () => {
  it("loads every tracked workspace once, then follows the pushes for all of them", async () => {
    const { bridge, push } = installGitBridge(trackedStatus(), {
      statusAll: vi.fn(async () => [
        trackedStatus(),
        trackedStatus({ workspaceId: "ws-2", remoteUrl: null, lastSyncedAt: null }),
      ]),
    });
    const { result } = renderHook(() => useWorkspaceGitStatuses());
    expect(result.current.size).toBe(0);

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(bridge.statusAll).toHaveBeenCalledTimes(1);
    expect([...result.current.keys()].sort()).toEqual(["ws-1", "ws-2"]);

    act(() => push(trackedStatus({ state: "syncing" })));
    expect(result.current.get("ws-1")?.state).toBe("syncing");
    expect(bridge.statusAll).toHaveBeenCalledTimes(1);
  });

  it("adds a workspace it had not seen, and keeps its row's icon current", async () => {
    const { push } = installGitBridge(trackedStatus());
    const { result } = renderHook(() => useWorkspaceGitStatuses());
    await waitFor(() => expect(result.current.size).toBe(1));

    act(() => push(trackedStatus({ workspaceId: "ws-9", uncommitted: true })));

    expect(result.current.get("ws-9")?.uncommitted).toBe(true);
  });

  it("drops a workspace back to untracked when main says so", async () => {
    const { push } = installGitBridge(trackedStatus());
    const { result } = renderHook(() => useWorkspaceGitStatuses());
    await waitFor(() => expect(result.current.size).toBe(1));

    act(() => push(untrackedStatus));

    expect(result.current.get("ws-1")?.tracked).toBe(false);
  });

  it("keeps a status pushed while the list was still being read", async () => {
    let release: (statuses: readonly ReturnType<typeof trackedStatus>[]) => void = () => undefined;
    const { push } = installGitBridge(trackedStatus(), {
      statusAll: vi.fn(
        () =>
          new Promise<readonly ReturnType<typeof trackedStatus>[]>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const { result } = renderHook(() => useWorkspaceGitStatuses());

    // An untrack of ws-1 lands before the slower list read resolves.
    act(() => push(untrackedStatus));
    expect(result.current.get("ws-1")?.tracked).toBe(false);

    await act(async () => release([trackedStatus()]));

    expect(result.current.get("ws-1")?.tracked).toBe(false);
  });

  it("stays empty with no bridge, and on a failed load", async () => {
    const { result } = renderHook(() => useWorkspaceGitStatuses());
    expect(result.current.size).toBe(0);

    installGitBridge(trackedStatus(), {
      statusAll: vi.fn(async () => {
        throw new Error("git is not installed");
      }),
    });
    const { result: failed } = renderHook(() => useWorkspaceGitStatuses());
    await waitFor(() => expect(failed.current.size).toBe(0));
  });

  it("unsubscribes when it unmounts", async () => {
    const { subscriptions } = installGitBridge(trackedStatus());
    const { unmount } = renderHook(() => useWorkspaceGitStatuses());
    await waitFor(() => expect(subscriptions()).toBe(1));

    unmount();

    expect(subscriptions()).toBe(0);
  });
});
