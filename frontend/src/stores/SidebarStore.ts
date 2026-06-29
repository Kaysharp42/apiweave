import { create } from "zustand";
import type { Workflow } from "../types/Workflow";
import type { Collection } from "../types/Collection";
import type { Project } from "../types/Project";
import type { PaginationState } from "../types/PaginationState";
import { authenticatedFetch } from "../utils/authenticatedApi";
import { projectsUrl, workflowsUrl } from "../utils/scopedApi";

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
  collections: Collection[];
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
  signalCollectionsRefresh: () => void;
  signalProjectsRefresh: () => void;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  fetchWorkflows: (
    skip?: number,
    append?: boolean,
    limit?: number,
    includeAttached?: boolean,
  ) => Promise<void>;
  fetchCollections: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  refreshAll: (selectedNav: string) => Promise<void>;
  setIsRefreshing: (v: boolean) => void;
  setIsLoadingMore: (v: boolean) => void;
  resetPagination: () => void;
}

const useSidebarStore = create<SidebarState>()((set, get) => ({
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

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  signalWorkflowsRefresh: () =>
    set((s) => ({ workflowVersion: s.workflowVersion + 1 })),

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
          projects: Collection[];
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
    const { fetchWorkflows, fetchProjects } = get();
    if (selectedNav === "workflows") {
      await fetchWorkflows(0);
    } else if (selectedNav === "projects") {
      await fetchProjects();
      // Projects view groups workflows under projects — needs attached ones too.
      await fetchWorkflows(0, false, 100, true);
    } else {
      set({ isRefreshing: false });
    }
  },

  setIsRefreshing: (v: boolean) => set({ isRefreshing: v }),
  setIsLoadingMore: (v: boolean) => set({ isLoadingMore: v }),
  resetPagination: () =>
    set({ pagination: { skip: 0, limit: 20, total: 0, hasMore: false } }),
}));

export default useSidebarStore;
