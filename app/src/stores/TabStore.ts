import { create } from "zustand";
import type { WorkspaceTab } from "../types/WorkspaceTab";
import type { Workflow } from "../types/Workflow";

interface TabStoreState {
  /**
   * Every open tab, from every workspace visited this session. Tabs are kept
   * rather than dropped on a workspace switch so switching back restores what
   * was open — including tabs with unsaved edits, which closing would discard.
   * Views read their own workspace's slice through `useWorkspaceTabs`.
   */
  tabs: WorkspaceTab[];
  /** Last active tab per workspace, so a switch back lands where it left. */
  activeTabIdByWorkspace: Record<string, string | null>;
  openTab: (workflow: Workflow) => void;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  /** Scoped to one workspace, or every workspace when the id is omitted. */
  closeAll: (workspaceId?: string) => void;
  markDirty: (id: string) => void;
  markClean: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  updateTabWorkflow: (workflowId: string, workflow: Workflow | null) => void;
  activateNextTab: (workspaceId: string) => void;
  activatePrevTab: (workspaceId: string) => void;
}

/**
 * The tabs of one workspace, in the order they were opened.
 *
 * Cycling and close-neighbour selection are relative to what the user can
 * actually see, so both are computed from this slice rather than from the flat
 * list that spans workspaces.
 */
const tabsIn = (tabs: readonly WorkspaceTab[], workspaceId: string): WorkspaceTab[] =>
  tabs.filter((t) => t.workspaceId === workspaceId);

const useTabStore = create<TabStoreState>()((set, get) => ({
  tabs: [],
  activeTabIdByWorkspace: {},

  openTab: (workflow: Workflow) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.workflowId === workflow.workflowId);

    if (existing) {
      set((s) => ({
        activeTabIdByWorkspace: {
          ...s.activeTabIdByWorkspace,
          [workflow.workspaceId]: existing.id,
        },
        tabs: s.tabs.map((t) =>
          t.workflowId === workflow.workflowId
            ? {
                ...t,
                name: workflow.name || t.name,
                workspaceId: workflow.workspaceId,
                workflow,
              }
            : t,
        ),
      }));
      return;
    }

    const newTab: WorkspaceTab = {
      id: workflow.workflowId,
      workflowId: workflow.workflowId,
      workspaceId: workflow.workspaceId,
      name: workflow.name || "Untitled",
      workflow,
      isDirty: false,
    };

    set((s) => ({
      tabs: [...s.tabs, newTab],
      activeTabIdByWorkspace: {
        ...s.activeTabIdByWorkspace,
        [newTab.workspaceId]: newTab.id,
      },
    }));
  },

  setActive: (id: string) =>
    set((s) => {
      const target = s.tabs.find((t) => t.id === id);
      if (!target) return s;
      return {
        activeTabIdByWorkspace: {
          ...s.activeTabIdByWorkspace,
          [target.workspaceId]: id,
        },
      };
    }),

  closeTab: (id: string) => {
    const { tabs, activeTabIdByWorkspace } = get();
    const target = tabs.find((t) => t.id === id);
    if (!target) return;

    const workspaceId = target.workspaceId;
    const siblings = tabsIn(tabs, workspaceId);
    const idx = siblings.findIndex((t) => t.id === id);
    const remaining = siblings.filter((t) => t.id !== id);

    let nextActive: string | null = activeTabIdByWorkspace[workspaceId] ?? null;
    if (nextActive === id) {
      const successor = idx < remaining.length ? remaining[idx] : remaining[remaining.length - 1];
      nextActive = successor?.id ?? null;
    }

    set({
      tabs: tabs.filter((t) => t.id !== id),
      activeTabIdByWorkspace: { ...activeTabIdByWorkspace, [workspaceId]: nextActive },
    });
  },

  closeOthers: (id: string) => {
    const { tabs, activeTabIdByWorkspace } = get();
    const target = tabs.find((t) => t.id === id);
    if (!target) return;
    set({
      tabs: tabs.filter((t) => t.workspaceId !== target.workspaceId || t.id === id),
      activeTabIdByWorkspace: { ...activeTabIdByWorkspace, [target.workspaceId]: id },
    });
  },

  closeAll: (workspaceId?: string) =>
    set((s) => {
      if (workspaceId === undefined) {
        return { tabs: [], activeTabIdByWorkspace: {} };
      }
      const activeTabIdByWorkspace = { ...s.activeTabIdByWorkspace };
      delete activeTabIdByWorkspace[workspaceId];
      return {
        tabs: s.tabs.filter((t) => t.workspaceId !== workspaceId),
        activeTabIdByWorkspace,
      };
    }),

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

  activateNextTab: (workspaceId: string) => {
    const { tabs, activeTabIdByWorkspace } = get();
    const scoped = tabsIn(tabs, workspaceId);
    if (scoped.length <= 1) return;
    const idx = scoped.findIndex((t) => t.id === activeTabIdByWorkspace[workspaceId]);
    const nextTab = scoped[(Math.max(idx, 0) + 1) % scoped.length];
    if (nextTab) {
      set({
        activeTabIdByWorkspace: { ...activeTabIdByWorkspace, [workspaceId]: nextTab.id },
      });
    }
  },

  activatePrevTab: (workspaceId: string) => {
    const { tabs, activeTabIdByWorkspace } = get();
    const scoped = tabsIn(tabs, workspaceId);
    if (scoped.length <= 1) return;
    const idx = scoped.findIndex((t) => t.id === activeTabIdByWorkspace[workspaceId]);
    const prevTab = scoped[(Math.max(idx, 0) - 1 + scoped.length) % scoped.length];
    if (prevTab) {
      set({
        activeTabIdByWorkspace: { ...activeTabIdByWorkspace, [workspaceId]: prevTab.id },
      });
    }
  },
}));

export default useTabStore;
