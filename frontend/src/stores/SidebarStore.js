import { create } from 'zustand';
import API_BASE_URL from '../utils/api';

/**
 * SidebarStore — Zustand store for sidebar data and refresh state.
 *
 * Replaces the fragile `window.dispatchEvent('workflowsNeedRefresh')`
 * and `window.dispatchEvent('collectionsChanged')` patterns used
 * by Sidebar, SidebarHeader, CollectionManager, etc.
 *
 * Components call `useSidebarStore.getState().refreshWorkflows()` instead
 * of firing a custom DOM event.
 */
const useSidebarStore = create((set, get) => ({
  // --- Data ---
  workflows: [],
  collections: [],
  environments: [],

  // --- Pagination (workflows view) ---
  pagination: { skip: 0, limit: 20, total: 0, hasMore: false },

  // --- UI state ---
  isRefreshing: false,
  isLoadingMore: false,
  searchQuery: '',

  // --- Refresh version counter (subscribers react to changes) ---
  workflowVersion: 0,
  collectionVersion: 0,
  environmentVersion: 0,

  // --- Actions ---

  setSearchQuery: (q) => set({ searchQuery: q }),

  /**
   * Trigger a workflows refresh. Components that hold workflow data
   * should subscribe to `workflowVersion` and re-fetch accordingly.
   * This avoids broadcasting a DOM event — a Zustand state bump
   * causes a targeted re-render only in subscribing components.
   */
  signalWorkflowsRefresh: () =>
    set((s) => ({ workflowVersion: s.workflowVersion + 1 })),

  /**
   * Trigger a collections refresh.
   */
  signalCollectionsRefresh: () =>
    set((s) => ({ collectionVersion: s.collectionVersion + 1 })),

  /**
   * Trigger an environments refresh. Components that display environment
   * data (EnvironmentSelector, Workspace, WorkflowCanvas) subscribe to
   * `environmentVersion` and re-fetch accordingly.
   */
  signalEnvironmentsRefresh: () =>
    set((s) => ({ environmentVersion: s.environmentVersion + 1 })),

  /** Fetch workflows from API. */
  fetchWorkflows: async (skip = 0, append = false, limit = 20, endpoint = 'unattached') => {
    try {
      const url =
        endpoint === 'unattached'
          ? `${API_BASE_URL}/api/workflows/unattached?skip=${skip}&limit=${limit}`
          : `${API_BASE_URL}/api/workflows?skip=${skip}&limit=${limit}`;

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
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

  /** Fetch collections from API. */
  fetchCollections: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data = await response.json();
        set({ collections: data, isRefreshing: false });
      }
    } catch (err) {
      console.error('SidebarStore: error fetching collections', err);
      set({ isRefreshing: false });
    }
  },

  /** Fetch environments from API. */
  fetchEnvironments: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/environments`);
      if (response.ok) {
        const data = await response.json();
        set({ environments: data });
      }
    } catch { /* silent */ }
  },

  /** Convenience: full refresh for workflows + collections. */
  refreshAll: async (selectedNav) => {
    set({ isRefreshing: true });
    const { fetchWorkflows, fetchCollections, fetchEnvironments } = get();
    await fetchEnvironments();
    if (selectedNav === 'workflows') {
      await fetchWorkflows(0);
    } else if (selectedNav === 'collections') {
      await fetchCollections();
      await fetchWorkflows(0, false, 1000, 'all');
    }
  },

  setIsRefreshing: (v) => set({ isRefreshing: v }),
  setIsLoadingMore: (v) => set({ isLoadingMore: v }),
  resetPagination: () => set({ pagination: { skip: 0, limit: 20, total: 0, hasMore: false } }),
}));

export default useSidebarStore;
