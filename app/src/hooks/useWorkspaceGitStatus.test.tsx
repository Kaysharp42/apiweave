import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceGitStatus } from "./useWorkspaceGitStatus";
import { installGitBridge, trackedStatus } from "../__tests__/gitFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWorkspaceGitStatus", () => {
  it("loads the status once, then follows the pushes for its workspace", async () => {
    const { bridge, push } = installGitBridge(trackedStatus());
    const { result } = renderHook(() => useWorkspaceGitStatus("ws-1"));
    expect(result.current.status).toBeNull();

    await waitFor(() => expect(result.current.status).toEqual(trackedStatus()));
    expect(bridge.status).toHaveBeenCalledTimes(1);
    expect(bridge.status).toHaveBeenCalledWith("ws-1");

    act(() => push(trackedStatus({ state: "syncing" })));
    expect(result.current.status?.state).toBe("syncing");
    act(() => push(trackedStatus({ workspaceId: "ws-2", state: "error" })));
    expect(result.current.status?.state).toBe("syncing");
    expect(bridge.status).toHaveBeenCalledTimes(1);
  });

  it("never shows one workspace's status as another's while the workspace changes underneath it", async () => {
    const { bridge, push, subscriptions } = installGitBridge(trackedStatus(), {
      status: vi.fn(async (workspaceId: string) =>
        trackedStatus({ workspaceId, branch: `branch-of-${workspaceId}` }),
      ),
    });
    const { result, rerender } = renderHook(({ id }) => useWorkspaceGitStatus(id), {
      initialProps: { id: "ws-1" as string | null },
    });
    await waitFor(() => expect(result.current.status?.branch).toBe("branch-of-ws-1"));

    rerender({ id: "ws-2" });
    // Straight away, before the new load lands: nothing, not ws-1's.
    expect(result.current.status).toBeNull();
    await waitFor(() => expect(result.current.status?.branch).toBe("branch-of-ws-2"));
    expect(subscriptions()).toBe(1);

    // The previous workspace's pushes no longer reach it.
    act(() => push(trackedStatus({ workspaceId: "ws-1", state: "error" })));
    expect(result.current.status?.workspaceId).toBe("ws-2");
    expect(result.current.status?.state).toBe("idle");
    expect(bridge.status).toHaveBeenCalledTimes(2);

    rerender({ id: null });
    expect(result.current.status).toBeNull();
    expect(subscriptions()).toBe(0);
  });

  it("drops a load that was overtaken by a switch", async () => {
    let releaseFirst: (status: ReturnType<typeof trackedStatus>) => void = () => undefined;
    installGitBridge(trackedStatus(), {
      status: vi.fn((workspaceId: string) =>
        workspaceId === "ws-1"
          ? new Promise<ReturnType<typeof trackedStatus>>((resolve) => {
              releaseFirst = resolve;
            })
          : Promise.resolve(trackedStatus({ workspaceId, branch: "second" })),
      ),
    });
    const { result, rerender } = renderHook(({ id }) => useWorkspaceGitStatus(id), {
      initialProps: { id: "ws-1" },
    });

    rerender({ id: "ws-2" });
    await waitFor(() => expect(result.current.status?.branch).toBe("second"));
    await act(async () => releaseFirst(trackedStatus({ workspaceId: "ws-1", branch: "first" })));

    expect(result.current.status?.branch).toBe("second");
  });

  it("unsubscribes when it unmounts", async () => {
    const { subscriptions } = installGitBridge(trackedStatus());
    const { result, unmount } = renderHook(() => useWorkspaceGitStatus("ws-1"));
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(subscriptions()).toBe(1);

    unmount();

    expect(subscriptions()).toBe(0);
  });

  it("takes a status a call resolved with, ahead of the push that announces it", async () => {
    installGitBridge(trackedStatus());
    const { result } = renderHook(() => useWorkspaceGitStatus("ws-1"));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    act(() => result.current.apply(trackedStatus({ mode: "manual" })));

    expect(result.current.status?.mode).toBe("manual");
  });

  it("drops a status handed to apply for another workspace, even through an apply from before the switch", async () => {
    installGitBridge(trackedStatus(), {
      status: vi.fn(async (workspaceId: string) => trackedStatus({ workspaceId, branch: `branch-of-${workspaceId}` })),
    });
    const { result, rerender } = renderHook(({ id }) => useWorkspaceGitStatus(id), { initialProps: { id: "ws-1" } });
    await waitFor(() => expect(result.current.status?.branch).toBe("branch-of-ws-1"));
    // What an action started on ws-1 still holds when it resolves.
    const startedOnFirst = result.current.apply;

    rerender({ id: "ws-2" });
    await waitFor(() => expect(result.current.status?.branch).toBe("branch-of-ws-2"));
    act(() => startedOnFirst(trackedStatus({ workspaceId: "ws-1", state: "error", branch: "late" })));

    expect(result.current.status).toMatchObject({ workspaceId: "ws-2", branch: "branch-of-ws-2", state: "idle" });
    act(() => startedOnFirst(trackedStatus({ workspaceId: "ws-2", branch: "applied" })));
    expect(result.current.status?.branch).toBe("applied");
  });

  it("reports a failed load, for the workspace it failed for only", async () => {
    installGitBridge(trackedStatus(), {
      status: vi.fn(async (workspaceId: string) => {
        if (workspaceId === "ws-1") throw new Error("git is not installed");
        return trackedStatus({ workspaceId });
      }),
    });
    const { result, rerender } = renderHook(({ id }) => useWorkspaceGitStatus(id), {
      initialProps: { id: "ws-1" },
    });

    await waitFor(() => expect(result.current.error).toBe("git is not installed"));
    expect(result.current.status).toBeNull();

    rerender({ id: "ws-2" });
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.status?.workspaceId).toBe("ws-2"));
  });

  it("stays empty, and subscribes to nothing, with no bridge or no workspace", () => {
    const { result } = renderHook(() => useWorkspaceGitStatus("ws-1"));
    expect(result.current).toMatchObject({ status: null, error: null });

    installGitBridge(trackedStatus());
    const { result: none } = renderHook(() => useWorkspaceGitStatus(null));
    expect(none.current.status).toBeNull();
  });
});
