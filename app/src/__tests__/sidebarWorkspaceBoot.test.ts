import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useSidebarStore from "../stores/SidebarStore";

function resetStores(): void {
  useSidebarStore.setState({
    workflows: [],
    collections: [],
    projects: [],
    isRefreshing: false,
    searchQuery: "",
    workflowVersion: 0,
    collectionVersion: 0,
    projectVersion: 0,
    activeWorkspaceId: null,
  });
}

function makeWorkflow(id: string, name: string) {
  return {
    workflowId: id,
    workspaceId: "ws-personal",
    name,
    nodes: [],
    edges: [],
    variables: {},
    tags: [],
    nodeTemplates: [],
    rev: 0,
    createdAt: "2026-06-18T00:00:00Z",
    updatedAt: "2026-06-18T00:00:00Z",
  };
}

type TestIpcBridge = NonNullable<Window["__APIWEAVE_IPC__"]>;

function installBridge(): ReturnType<typeof vi.fn<TestIpcBridge["invoke"]>> {
  const invoke = vi.fn<TestIpcBridge["invoke"]>(async (domain) => ({
    ok: true,
    data:
      domain === "projects"
        ? { items: [{ id: "p-1", name: "Proj A" }], total: 1 }
        : { items: [makeWorkflow("wf-1", "WF A")], total: 1 },
  }));
  vi.stubGlobal("__APIWEAVE_IPC__", {
    invoke,
    onRunProgress: () => () => undefined,
  });
  return invoke;
}

describe("sidebar workspace boot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setActiveWorkspaceId("ws-A") from null triggers fetchProjects and fetchWorkflows(0)', async () => {
    const invoke = installBridge();

    useSidebarStore.getState().setActiveWorkspaceId("ws-A");

    // State is set synchronously
    expect(useSidebarStore.getState().activeWorkspaceId).toBe("ws-A");

    // Wait for async fetches to complete
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("projects", "list", {
        workspaceId: "ws-A",
      });
      expect(invoke).toHaveBeenCalledWith("workflows", "list", {
        workspaceId: "ws-A",
        includeAttached: false,
      });
    });
  });

  it('setActiveWorkspaceId("ws-B") from "ws-A" clears stale data and refetches', async () => {
    // Pre-populate stale data for ws-A
    useSidebarStore.setState({
      activeWorkspaceId: "ws-A",
      workflows: [makeWorkflow("stale-wf", "Stale WF")],
      projects: [
        {
          id: "stale-p",
          collectionId: "stale-p",
          name: "Stale Project",
          workflowCount: 0,
          createdAt: "2026-06-18T00:00:00Z",
          updatedAt: "2026-06-18T00:00:00Z",
        },
      ],
    });

    const invoke = installBridge();

    useSidebarStore.getState().setActiveWorkspaceId("ws-B");

    // Stale data cleared synchronously before async fetches
    expect(useSidebarStore.getState().activeWorkspaceId).toBe("ws-B");
    expect(useSidebarStore.getState().workflows).toEqual([]);
    expect(useSidebarStore.getState().projects).toEqual([]);

    // Wait for async fetches on ws-B
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("projects", "list", {
        workspaceId: "ws-B",
      });
      expect(invoke).toHaveBeenCalledWith("workflows", "list", {
        workspaceId: "ws-B",
        includeAttached: false,
      });
    });

    // No requests to the old workspace
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("ws-A");
  });

  it("setActiveWorkspaceId(null) clears data and does not fetch", async () => {
    // Pre-populate as if a workspace was active
    useSidebarStore.setState({
      activeWorkspaceId: "ws-A",
      workflows: [makeWorkflow("wf-1", "WF A")],
      projects: [
        {
          id: "p-1",
          collectionId: "p-1",
          name: "Proj A",
          workflowCount: 0,
          createdAt: "2026-06-18T00:00:00Z",
          updatedAt: "2026-06-18T00:00:00Z",
        },
      ],
    });

    const invoke = installBridge();

    useSidebarStore.getState().setActiveWorkspaceId(null);

    // All data cleared
    expect(useSidebarStore.getState().activeWorkspaceId).toBeNull();
    expect(useSidebarStore.getState().workflows).toEqual([]);
    expect(useSidebarStore.getState().projects).toEqual([]);

    // No fetches triggered when setting to null
    expect(invoke).not.toHaveBeenCalled();
  });
});
