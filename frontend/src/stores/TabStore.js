import { create } from 'zustand';

/**
 * TabStore — Zustand store for workspace tab management.
 *
 * Replaces the local `useState` tab logic in Workspace.jsx with
 * a globally accessible store. Sidebar, Workspace, and TabBar
 * all share this state without prop-drilling or window events.
 *
 * Each tab holds: { id, workflowId, name, isDirty }
 * `isDirty` tracks whether the workflow has a pending auto-save.
 */
const useTabStore = create((set, get) => ({
  // --- State ---
  tabs: [],
  activeTabId: null,

  // --- Actions ---

  /**
   * Open a workflow in a tab. If a tab for this workflow already
   * exists, activate it instead of creating a duplicate.
   */
  openTab: (workflow) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.workflowId === workflow.workflowId);

    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const newTab = {
      id: workflow.workflowId,
      workflowId: workflow.workflowId,
      name: workflow.name || 'Untitled',
      workflow, // full workflow payload for WorkflowProvider
      isDirty: false,
    };

    set({ tabs: [...tabs, newTab], activeTabId: newTab.id });
  },

  /** Activate a tab by its id. */
  setActive: (id) => set({ activeTabId: id }),

  /**
   * Close a tab. If it was the active tab, activate the nearest
   * neighbour (prefer right, fall back to left, then null).
   */
  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;

    const newTabs = tabs.filter((t) => t.id !== id);

    let nextActive = activeTabId;
    if (activeTabId === id) {
      if (newTabs.length === 0) {
        nextActive = null;
      } else if (idx < newTabs.length) {
        // activate the tab that slid into this position (right neighbour)
        nextActive = newTabs[idx].id;
      } else {
        // was last tab — activate the new last
        nextActive = newTabs[newTabs.length - 1].id;
      }
    }

    set({ tabs: newTabs, activeTabId: nextActive });
  },

  /** Close all tabs except the one with the given id. */
  closeOthers: (id) => {
    const { tabs } = get();
    set({ tabs: tabs.filter((t) => t.id === id), activeTabId: id });
  },

  /** Close all open tabs. */
  closeAll: () => set({ tabs: [], activeTabId: null }),

  /** Mark a tab as having unsaved (dirty) changes. */
  markDirty: (id) =>
    set((s) => {
      const target = s.tabs.find((t) => t.id === id);
      if (!target || target.isDirty) return s;
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty: true } : t)),
      };
    }),

  /** Mark a tab as saved (clean). */
  markClean: (id) =>
    set((s) => {
      const target = s.tabs.find((t) => t.id === id);
      if (!target || !target.isDirty) return s;
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty: false } : t)),
      };
    }),

  /** Update a tab's display name (e.g. after rename). */
  renameTab: (id, name) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
    })),

  /** Cycle to the next tab (Ctrl+Tab). Wraps around. */
  activateNextTab: () => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    const next = (idx + 1) % tabs.length;
    set({ activeTabId: tabs[next].id });
  },

  /** Cycle to the previous tab (Ctrl+Shift+Tab). Wraps around. */
  activatePrevTab: () => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    const prev = (idx - 1 + tabs.length) % tabs.length;
    set({ activeTabId: tabs[prev].id });
  },
}));

export default useTabStore;
