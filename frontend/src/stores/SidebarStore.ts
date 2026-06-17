import { create } from 'zustand';
import API_BASE_URL from '../utils/api';
import type { Workflow } from '../types/Workflow';
import type { Collection } from '../types/Collection';
import type { Project } from '../types/Project';
import type { Environment } from '../types/Environment';
import type { PaginationState } from '../types/PaginationState';
import { authenticatedFetch } from '../utils/authenticatedApi';

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
  environments: Environment[];
  pagination: PaginationState;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  searchQuery: string;
  workflowVersion: number;
  collectionVersion: number;
  environmentVersion: number;
  projectVersion: number;
  /** Currently active workspace ID for scoped fetching. */
  activeWorkspaceId: string | null;
  setSearchQuery: (q: string) => void;
  signalWorkflowsRefresh: () => void;
  signalCollectionsRefresh: () => void;
  signalEnvironmentsRefresh: () => void;
  signalProjectsRefresh: () => void;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  fetchWorkflows: (skip?: number, append?: boolean, limit?: number, endpoint?: string) => Promise<void>;
  fetchCollections: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  fetchEnvironments: () => Promise<void>;
  refreshAll: (selectedNav: string) => Promise<void>;
  setIsRefreshing: (v: boolean) => void;
  setIsLoadingMore: (v: boolean) => void;
  resetPagination: () => void;
}

const useSidebarStore = create<SidebarState>()((set, get) => ({
  workflows: [],
  collections: [],
  projects: [],
  environments: [],

  pagination: { skip: 0, limit: 20, total: 0, hasMore: false },

  isRefreshing: false,
  isLoadingMore: false,
  searchQuery: '',

  workflowVersion: 0,
  collectionVersion: 0,
  environmentVersion: 0,
  projectVersion: 0,
  activeWorkspaceId: null,

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  signalWorkflowsRefresh: () =>
    set((s) => ({ workflowVersion: s.workflowVersion + 1 })),

  signalCollectionsRefresh: () =>
    set((s) => ({ collectionVersion: s.collectionVersion + 1 })),

  signalEnvironmentsRefresh: () =>
    set((s) => ({ environmentVersion: s.environmentVersion + 1 })),

  signalProjectsRefresh: () =>
    set((s) => ({ projectVersion: s.projectVersion + 1 })),

  setActiveWorkspaceId: (workspaceId: string | null) => {
    const prev = get().activeWorkspaceId;
    if (prev !== workspaceId) {
      set({ activeWorkspaceId: workspaceId });
      // Re-fetch workspace-scoped data when workspace changes
      if (workspaceId) {
        void get().fetchProjects();
      }
    }
  },

  fetchWorkflows: async (skip = 0, append = false, limit = 20, endpoint = 'unattached') => {
    const { activeWorkspaceId } = get();
    try {
      // Use workspace-scoped endpoint when available
      const url = activeWorkspaceId
        ? `${API_BASE_URL}/api/workspaces/${activeWorkspaceId}/workflows?skip=${skip}&limit=${limit}`
        : endpoint === 'unattached'
          ? `${API_BASE_URL}/api/workflows/unattached?skip=${skip}&limit=${limit}`
          : `${API_BASE_URL}/api/workflows?skip=${skip}&limit=${limit}`;

      const response = await authenticatedFetch(url);
      if (response.ok) {
        const data: PaginatedWorkflowResponse = await response.json();
        const prev = get().workflows;
        const newWorkflows = append ? [...prev, ...data.workflows] : data.workflows;
        set({
          workflows: newWorkflows,
          pagination: {
            skip,
            limit,
            total: data.total,
            hasMore: data.workflows.length === limit && (skip + limit) < data.total,
          },
          isLoadingMore: false,
          isRefreshing: false,
        });
      }
    } catch (err) {
      console.error('SidebarStore: error fetching workflows', err);
      set({ isLoadingMore: false, isRefreshing: false });
    }
  },

  fetchCollections: async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data: Collection[] = await response.json();
        set({ collections: data, isRefreshing: false });
      }
    } catch (err) {
      console.error('SidebarStore: error fetching collections', err);
      set({ isRefreshing: false });
    }
  },

  fetchProjects: async () => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/workspaces/${activeWorkspaceId}/projects`,
      );
      if (response.ok) {
        const data: ProjectListResponse = await response.json();
        set({ projects: data.projects, isRefreshing: false });
      }
    } catch (err) {
      console.error('SidebarStore: error fetching projects', err);
      set({ isRefreshing: false });
    }
  },

  fetchEnvironments: async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/environments`);
      if (response.ok) {
        const data: Environment[] = await response.json();
        set({ environments: data });
      }
    } catch { /* silent */ }
  },

  refreshAll: async (selectedNav: string) => {
    set({ isRefreshing: true });
    const { fetchWorkflows, fetchCollections, fetchProjects, fetchEnvironments } = get();
    await fetchEnvironments();
    if (selectedNav === 'workflows') {
      await fetchWorkflows(0);
    } else if (selectedNav === 'projects') {
      await fetchProjects();
      await fetchWorkflows(0, false, 1000, 'all');
    }
  },

  setIsRefreshing: (v: boolean) => set({ isRefreshing: v }),
  setIsLoadingMore: (v: boolean) => set({ isLoadingMore: v }),
  resetPagination: () => set({ pagination: { skip: 0, limit: 20, total: 0, hasMore: false } }),
}));

export default useSidebarStore;
