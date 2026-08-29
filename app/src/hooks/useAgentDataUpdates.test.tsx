import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWriteEvent } from "@shared/types/AgentWriteEvent";
import { useAgentDataUpdates } from "./useAgentDataUpdates";

const onAgentWriteMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const refreshWorkspacesMock = vi.hoisted(() => vi.fn());
const fetchEnvironmentsMock = vi.hoisted(() => vi.fn());
const fetchPresetsMock = vi.hoisted(() => vi.fn());
const signalWorkflowsRefreshMock = vi.hoisted(() => vi.fn());
const signalCollectionsRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/apiweaveClient", () => ({ onAgentWrite: onAgentWriteMock }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigateMock }));
vi.mock("../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    refresh: refreshWorkspacesMock,
    currentWorkspace: { workspaceId: "ws1", slug: "acme" },
  }),
}));
vi.mock("../stores/SidebarStore", () => ({
  default: {
    getState: () => ({
      signalWorkflowsRefresh: signalWorkflowsRefreshMock,
      signalCollectionsRefresh: signalCollectionsRefreshMock,
    }),
  },
}));
vi.mock("../stores/EnvironmentStore", () => ({
  default: { getState: () => ({ fetchEnvironments: fetchEnvironmentsMock }) },
}));
vi.mock("../stores/NodePresetStore", () => ({
  default: { getState: () => ({ fetchPresets: fetchPresetsMock }) },
}));

/**
 * Capture every listener the hook registers — it subscribes once per store it
 * owns — and return a publisher that fans an event out to all of them, the way
 * the main-process broadcast does.
 */
function mount(): (...events: AgentWriteEvent[]) => void {
  const listeners = new Set<(event: AgentWriteEvent) => void>();
  onAgentWriteMock.mockImplementation((callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  });
  renderHook(() => useAgentDataUpdates());
  if (listeners.size === 0) throw new Error("no agent-write listener registered");
  return (...events) => {
    for (const event of events) for (const listener of listeners) listener(event);
  };
}

describe("useAgentDataUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const m of [
      onAgentWriteMock,
      navigateMock,
      refreshWorkspacesMock,
      fetchEnvironmentsMock,
      fetchPresetsMock,
      signalWorkflowsRefreshMock,
      signalCollectionsRefreshMock,
    ]) {
      m.mockReset();
    }
    fetchEnvironmentsMock.mockResolvedValue(undefined);
    fetchPresetsMock.mockResolvedValue(undefined);
    refreshWorkspacesMock.mockResolvedValue(undefined);
  });

  it("refetches the store that owns each written domain", () => {
    const publish = mount();

    act(() => {
      publish(
        { domain: "environments", action: "setVariable", workspaceId: "ws1" },
        { domain: "nodePresets", action: "create", workspaceId: "ws1" },
        { domain: "projects", action: "create", workspaceId: "ws1" },
      );
      vi.advanceTimersByTime(250);
    });

    expect(fetchEnvironmentsMock).toHaveBeenCalledWith("ws1");
    expect(fetchPresetsMock).toHaveBeenCalledWith("ws1");
    expect(signalWorkflowsRefreshMock).toHaveBeenCalledTimes(1);
    expect(signalCollectionsRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of writes into one refetch per store", () => {
    const publish = mount();

    act(() => {
      for (let i = 0; i < 12; i += 1) {
        publish({ domain: "projects", action: "addWorkflow", workspaceId: "ws1" });
      }
      vi.advanceTimersByTime(250);
    });

    expect(signalWorkflowsRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("refetches a workspace whose id it was never told", () => {
    const publish = mount();

    act(() => {
      publish({ domain: "environments", action: "duplicate" });
      vi.advanceTimersByTime(250);
    });

    // No workspaceId on the event (a cross-workspace copy names the target
    // separately), so the current workspace is refetched regardless.
    expect(fetchEnvironmentsMock).toHaveBeenCalledWith("ws1");
  });

  it("leaves the workspace the user is in when a DIFFERENT one is deleted", () => {
    const publish = mount();

    act(() => {
      publish({ domain: "workspaces", action: "delete", workspaceId: "ws2" });
      vi.advanceTimersByTime(250);
    });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(refreshWorkspacesMock).toHaveBeenCalledTimes(1);
  });

  it("navigates out when the workspace the user is in is deleted", () => {
    const publish = mount();

    act(() => {
      publish({ domain: "workspaces", action: "delete", workspaceId: "ws1" });
    });

    // Immediate, not coalesced: every scoped fetch resolves through the
    // workspace that just stopped existing.
    expect(navigateMock).toHaveBeenCalledWith("/app", { replace: true });
    expect(refreshWorkspacesMock).toHaveBeenCalledTimes(1);
  });
});
