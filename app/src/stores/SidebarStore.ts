import { create } from "zustand";
import type { Workflow } from "../types/Workflow";
import type { Project } from "../types/Project";
import type { PaginationState } from "../types/PaginationState";
import { authenticatedFetch } from "../utils/apiweaveClient";
import { projectsUrl, workflowsUrl } from "../utils/apiweaveClient";

interface PaginatedWorkflowResponse {
  workflows: Workflow[];
  total: number;
}

interface ProjectListResponse {
  projects: Project[];
  total: number;
}

interface SidebarState {
  workflows: Workflow[];
  allWorkflows: Workflow[];
  collections: Project[];
  /** Workspace-scoped projects (fetched from /api/workspaces/{id}/projects). */
  projects: Project[];
  pagination: PaginationState;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  searchQuery: string;
  workflowVersion: number;
  collectionVersion: number;
  projectVersion: number;
  /** Currently active workspace ID for scoped fetching. */
  activeWorkspaceId: string | null;
  setSearchQuery: (q: string) => void;
  signalWorkflowsRefresh: () => void;
  /**
   * Merge one authoritative workflow into the cached lists in place. A live
   * canvas update only needs the row it changed — a full refetch here would
   * reset pagination and replace the visible list on every applied snapshot.
   * Falls back to the refresh signal only when the change moves the row into a
   * list it is not cached in, which no in-place edit can position.
   */
  applyWorkflowChange: (workflow: Workflow) => void;
  signalCollectionsRefresh: () => void;
  signalProjectsRefresh: () => void;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  fetchWorkflows: (
    skip?: number,
    append?: boolean,
    limit?: number,
    includeAttached?: boolean,
  ) => Promise<void>;
  fetchAllWorkflows: (skip?: number, append?: boolean) => Promise<void>;
  fetchCollections: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  refreshAll: (selectedNav: string) => Promise<void>;
  setIsRefreshing: (v: boolean) => void;
  setIsLoadingMore: (v: boolean) => void;
  resetPagination: () => void;
}

const useSidebarStore = create<SidebarState>()((set, get) => ({
  workflows: [],
  allWorkflows: [],
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

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  signalWorkflowsRefresh: () =>
    set((s) => ({ workflowVersion: s.workflowVersion + 1 })),

  applyWorkflowChange: (workflow: Workflow) =>
    set((s) => {
      const id = workflow.workflowId;
      const inWorkflows = s.workflows.some((w) => w.workflowId === id);
      const inAllWorkflows = s.allWorkflows.some((w) => w.workflowId === id);
      // Cached in neither list: the row sits outside the sidebar's fetched
      // window, so nothing on screen is stale and a refetch would cost the
      // user their pagination for no visible gain.
      if (!inWorkflows && !inAllWorkflows) {
        return { workflows: s.workflows, allWorkflows: s.allWorkflows };
      }

      const inWorkspace =
        s.activeWorkspaceId === null ||
        workflow.workspaceId === s.activeWorkspaceId;
      // `fetchWorkflows` passes includeAttached: false, so the flat list holds
      // unattached rows only, while `allWorkflows` holds every row in the
      // workspace. A change can therefore carry a row out of one list, out of
      // both, or into one — patching in place only covers the first two.
      const belongsInWorkflows =
        inWorkspace && (workflow.collectionId ?? null) === null;

      // Detaching a row from its project makes it newly eligible for the flat
      // list, and its position there follows server ordering across pages that
      // were never fetched — only a refetch can place it correctly.
      if (belongsInWorkflows && !inWorkflows) {
        return { workflowVersion: s.workflowVersion + 1 };
      }

      const merge = (rows: Workflow[], keep: boolean): Workflow[] =>
        keep
          ? rows.map((w) => (w.workflowId === id ? workflow : w))
          : rows.filter((w) => w.workflowId !== id);

      return {
        workflows: inWorkflows
          ? merge(s.workflows, belongsInWorkflows)
          : s.workflows,
        allWorkflows: inAllWorkflows
          ? merge(s.allWorkflows, inWorkspace)
          : s.allWorkflows,
      };
    }),

  signalCollectionsRefresh: () =>
    set((s) => ({ collectionVersion: s.collectionVersion + 1 })),

  signalProjectsRefresh: () =>
    set((s) => ({ projectVersion: s.projectVersion + 1 })),

  setActiveWorkspaceId: (workspaceId: string | null) => {
    const prev = get().activeWorkspaceId;
    if (prev === workspaceId) return;
    set({
      activeWorkspaceId: workspaceId,
      workflows: [],
      allWorkflows: [],
      projects: [],
      pagination: { skip: 0, limit: 20, total: 0, hasMore: false },
    });
    if (workspaceId) {
      void get().fetchProjects();
      void get().fetchWorkflows(0);
    }
  },

  fetchWorkflows: async (
    skip = 0,
    append = false,
    limit = 20,
    includeAttached = false,
  ) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) {
      set({ isLoadingMore: false, isRefreshing: false });
      return;
    }

    try {
      const response = await authenticatedFetch(
        workflowsUrl(activeWorkspaceId, { skip, limit, includeAttached }),
      );
      if (response.ok) {
        const data: PaginatedWorkflowResponse = await response.json();
        const prev = get().workflows;
        const newWorkflows = append
          ? [...prev, ...data.workflows]
          : data.workflows;
        set({
          workflows: newWorkflows,
          pagination: {
            skip,
            limit,
            total: data.total,
            hasMore:
              data.workflows.length === limit && skip + limit < data.total,
          },
          isLoadingMore: false,
          isRefreshing: false,
        });
      } else {
        console.error(
          "SidebarStore: workflows fetch returned non-OK status",
          response.status,
        );
        set({ isLoadingMore: false, isRefreshing: false });
      }
    } catch (err) {
      console.error("SidebarStore: error fetching workflows", err);
      set({ isLoadingMore: false, isRefreshing: false });
    }
  },

  fetchCollections: async () => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) {
      set({ isRefreshing: false });
      return;
    }
    try {
      const response = await authenticatedFetch(projectsUrl(activeWorkspaceId));
      if (response.ok) {
        const data = (await response.json()) as {
          projects: Project[];
          total: number;
        };
        set({ collections: data.projects, isRefreshing: false });
      }
    } catch (err) {
      console.error("SidebarStore: error fetching collections", err);
      set({ isRefreshing: false });
    }
  },

  fetchProjects: async () => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;
    try {
      const response = await authenticatedFetch(projectsUrl(activeWorkspaceId));
      if (response.ok) {
        const data: ProjectListResponse = await response.json();
        set({ projects: data.projects, isRefreshing: false });
      }
    } catch (err) {
      console.error("SidebarStore: error fetching projects", err);
      set({ isRefreshing: false });
    }
  },

  refreshAll: async (selectedNav: string) => {
    set({ isRefreshing: true });
    const { fetchWorkflows, fetchProjects, fetchAllWorkflows } = get();
    if (selectedNav === "workflows") {
      await fetchWorkflows(0);
    } else if (selectedNav === "projects") {
      await fetchProjects();
      await fetchAllWorkflows(0);
    } else {
      set({ isRefreshing: false });
    }
  },

  fetchAllWorkflows: async (skip = 0, append = false) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) {
      set({ isRefreshing: false });
      return;
    }
    try {
      const response = await authenticatedFetch(
        workflowsUrl(activeWorkspaceId, { skip, limit: 100, includeAttached: true }),
      );
      if (response.ok) {
        const data: PaginatedWorkflowResponse = await response.json();
        const prev = get().allWorkflows;
        const next = append
          ? [...prev, ...data.workflows]
          : data.workflows;
        set({ allWorkflows: next, isRefreshing: false });
      } else {
        set({ isRefreshing: false });
      }
    } catch (err) {
      console.error("SidebarStore: error fetching workflows", err);
      set({ isRefreshing: false });
    }
  },

  setIsRefreshing: (v: boolean) => set({ isRefreshing: v }),
  setIsLoadingMore: (v: boolean) => set({ isLoadingMore: v }),
  resetPagination: () =>
    set({ pagination: { skip: 0, limit: 20, total: 0, hasMore: false } }),
}));

export default useSidebarStore;
