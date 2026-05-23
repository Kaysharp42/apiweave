import { create } from 'zustand';
import type { WorkspaceTab } from '../types/WorkspaceTab';
import type { Workflow } from '../types/Workflow';

interface TabStoreState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  openTab: (workflow: Workflow) => void;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  markDirty: (id: string) => void;
  markClean: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  updateTabWorkflow: (workflowId: string, workflow: Workflow | null) => void;
  activateNextTab: () => void;
  activatePrevTab: () => void;
}

const useTabStore = create<TabStoreState>()((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (workflow: Workflow) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.workflowId === workflow.workflowId);

    if (existing) {
      set((s) => ({
        activeTabId: existing.id,
        tabs: s.tabs.map((t) => (
          t.workflowId === workflow.workflowId
            ? {
                ...t,
                name: workflow.name || t.name,
                workflow,
              }
            : t
        )),
      }));
      return;
    }

    const newTab: WorkspaceTab = {
      id: workflow.workflowId,
      workflowId: workflow.workflowId,
      name: workflow.name || 'Untitled',
      workflow,
      isDirty: false,
    };

    set({ tabs: [...tabs, newTab], activeTabId: newTab.id });
  },

  setActive: (id: string) => set({ activeTabId: id }),

  closeTab: (id: string) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;

    const newTabs = tabs.filter((t) => t.id !== id);

    let nextActive: string | null = activeTabId;
    if (activeTabId === id) {
      if (newTabs.length === 0) {
        nextActive = null;
      } else if (idx < newTabs.length) {
        const nextTab = newTabs[idx];
        if (nextTab) {
          nextActive = nextTab.id;
        }
      } else {
        const lastTab = newTabs[newTabs.length - 1];
        if (lastTab) {
          nextActive = lastTab.id;
        }
      }
    }

    set({ tabs: newTabs, activeTabId: nextActive });
  },

  closeOthers: (id: string) => {
    const { tabs } = get();
    set({ tabs: tabs.filter((t) => t.id === id), activeTabId: id });
  },

  closeAll: () => set({ tabs: [], activeTabId: null }),

  markDirty: (id: string) =>
    set((s) => {
      const target = s.tabs.find((t) => t.id === id);
      if (!target || target.isDirty) return s;
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty: true } : t)),
      };
    }),

  markClean: (id: string) =>
    set((s) => {
      const target = s.tabs.find((t) => t.id === id);
      if (!target || !target.isDirty) return s;
      return {
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty: false } : t)),
      };
    }),

  renameTab: (id: string, name: string) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
    })),

  updateTabWorkflow: (workflowId: string, workflow: Workflow | null) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.workflowId !== workflowId) return t;
        const updated: WorkspaceTab = {
          ...t,
          name: workflow?.name ?? t.name,
        };
        if (workflow) {
          updated.workflow = workflow;
        } else {
          delete updated.workflow;
        }
        return updated;
      }),
    })),

  activateNextTab: () => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    const next = (idx + 1) % tabs.length;
    const nextTab = tabs[next];
    if (nextTab) {
      set({ activeTabId: nextTab.id });
    }
  },

  activatePrevTab: () => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    const prev = (idx - 1 + tabs.length) % tabs.length;
    const prevTab = tabs[prev];
    if (prevTab) {
      set({ activeTabId: prevTab.id });
    }
  },
}));

export default useTabStore;
