import { create } from "zustand";
import type { Workflow } from "../types/Workflow";
import type { SidebarState } from "../types/SidebarState";
import { apiweave } from "../utils/apiweaveClient";
import { getLogger } from "../utils/logger";

const sidebarLog = getLogger("SidebarStore");

const useSidebarStore = create<SidebarState>()((set, get) => ({
  workflows: [],
  allWorkflows: [],
  collections: [],
  projects: [],

  isRefreshing: false,
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
      // Cached in neither list: nothing on screen is stale.
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
      // list, and its position there follows server ordering — only a refetch
      // can place it correctly.
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
    });
    if (workspaceId) {
      void get().fetchProjects();
      void get().fetchWorkflows();
    }
  },

  // The workspace's unattached workflows, all of them: the list handler does
  // not page.
  fetchWorkflows: async () => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) {
      set({ isRefreshing: false });
      return;
    }

    try {
      const data = await apiweave.workflows.list(activeWorkspaceId, false);
      set({ workflows: [...data.items], isRefreshing: false });
    } catch (err) {
      sidebarLog.error("error fetching workflows", err);
      set({ isRefreshing: false });
    }
  },

  fetchCollections: async () => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) {
      set({ isRefreshing: false });
      return;
    }
    try {
      const data = await apiweave.projects.list(activeWorkspaceId);
      set({ collections: [...data.items], isRefreshing: false });
    } catch (err) {
      sidebarLog.error("error fetching collections", err);
      set({ isRefreshing: false });
    }
  },

  fetchProjects: async () => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;
    try {
      const data = await apiweave.projects.list(activeWorkspaceId);
      set({ projects: [...data.items], isRefreshing: false });
    } catch (err) {
      sidebarLog.error("error fetching projects", err);
      set({ isRefreshing: false });
    }
  },

  refreshAll: async (selectedNav: string) => {
    set({ isRefreshing: true });
    const { fetchWorkflows, fetchProjects, fetchAllWorkflows } = get();
    if (selectedNav === "workflows") {
      await fetchWorkflows();
    } else if (selectedNav === "projects") {
      await fetchProjects();
      await fetchAllWorkflows();
    } else {
      set({ isRefreshing: false });
    }
  },

  fetchAllWorkflows: async () => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) {
      set({ isRefreshing: false });
      return;
    }
    try {
      const data = await apiweave.workflows.list(activeWorkspaceId, true);
      set({ allWorkflows: [...data.items], isRefreshing: false });
    } catch (err) {
      sidebarLog.error("error fetching workflows", err);
      set({ isRefreshing: false });
    }
  },

  setIsRefreshing: (v: boolean) => set({ isRefreshing: v }),
}));

export default useSidebarStore;
