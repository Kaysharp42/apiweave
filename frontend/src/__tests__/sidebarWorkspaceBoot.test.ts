import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useSidebarStore from "../stores/SidebarStore";
import API_BASE_URL from "../utils/apiweaveClient";

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function methodFrom(init: RequestInit | undefined): string {
  return (init?.method ?? "GET").toUpperCase();
}

function resetStores(): void {
  useSidebarStore.setState({
    workflows: [],
    collections: [],
    projects: [],
    pagination: { skip: 0, limit: 20, total: 0, hasMore: false },
    isRefreshing: false,
    isLoadingMore: false,
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
    name,
    nodes: [],
    edges: [],
    variables: [],
    createdAt: "2026-06-18T00:00:00Z",
    updatedAt: "2026-06-18T00:00:00Z",
  };
}

function installFetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = inputUrl(input);

    if (url.includes("/projects")) {
      return responseJson({
        projects: [{ id: "p-1", name: "Proj A" }],
        total: 1,
      });
    }
    if (url.includes("/environments")) {
      return responseJson([{ environmentId: "env-1", name: "Env A" }]);
    }
    if (url.includes("/workflows")) {
      return responseJson({
        workflows: [makeWorkflow("wf-1", "WF A")],
        total: 1,
      });
    }

    return responseJson({}, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
    const fetchMock = installFetchMock();

    useSidebarStore.getState().setActiveWorkspaceId("ws-A");

    // State is set synchronously
    expect(useSidebarStore.getState().activeWorkspaceId).toBe("ws-A");

    // Wait for async fetches to complete
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      url: inputUrl(input),
      method: methodFrom(init),
    }));

    expect(calls).toContainEqual({
      url: `${API_BASE_URL}/api/workspaces/ws-A/projects`,
      method: "GET",
    });
    expect(calls).toContainEqual({
      url: `${API_BASE_URL}/api/workspaces/ws-A/workflows?skip=0&limit=20`,
      method: "GET",
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
      pagination: { skip: 20, limit: 20, total: 100, hasMore: true },
    });

    const fetchMock = installFetchMock();

    useSidebarStore.getState().setActiveWorkspaceId("ws-B");

    // Stale data cleared synchronously before async fetches
    expect(useSidebarStore.getState().activeWorkspaceId).toBe("ws-B");
    expect(useSidebarStore.getState().workflows).toEqual([]);
    expect(useSidebarStore.getState().projects).toEqual([]);
    expect(useSidebarStore.getState().pagination).toEqual({
      skip: 0,
      limit: 20,
      total: 0,
      hasMore: false,
    });

    // Wait for async fetches on ws-B
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const urls = fetchMock.mock.calls.map(([input]) => inputUrl(input));
    expect(urls).toContain(`${API_BASE_URL}/api/workspaces/ws-B/projects`);
    expect(urls).toContain(
      `${API_BASE_URL}/api/workspaces/ws-B/workflows?skip=0&limit=20`,
    );

    // No requests to the old workspace
    expect(urls.some((u) => u.includes("ws-A"))).toBe(false);
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

    const fetchMock = installFetchMock();

    useSidebarStore.getState().setActiveWorkspaceId(null);

    // All data cleared
    expect(useSidebarStore.getState().activeWorkspaceId).toBeNull();
    expect(useSidebarStore.getState().workflows).toEqual([]);
    expect(useSidebarStore.getState().projects).toEqual([]);

    // No fetches triggered when setting to null
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
