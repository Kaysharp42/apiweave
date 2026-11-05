import { create } from "zustand";
import type { Viewport } from "@xyflow/react";
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
  /** Closes the tabs opened after this one, scoped to its workspace. */
  closeToRight: (id: string) => void;
  /** Scoped to one workspace, or every workspace when the id is omitted. */
  closeAll: (workspaceId?: string) => void;
  markDirty: (id: string) => void;
  /** Clears the unsaved flag and any draft: the tab now matches its workflow. */
  markClean: (id: string) => void;
  /**
   * Keeps (or, with null, drops) the content a canvas leaves unsaved as it
   * unmounts. A kept draft marks the tab dirty; dropping one marks it clean.
   */
  stashDraft: (id: string, draft: Workflow | null) => void;
  renameTab: (id: string, name: string) => void;
  /**
   * Remembers where the canvas of one tab was left, so showing the tab again
   * restores that view rather than recomputing an opening one. Memory only.
   */
  setTabViewport: (id: string, viewport: Viewport) => void;
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

/** One tab, its workspace's sibling list, and its position in that list. */
function locateTab(
  tabs: readonly WorkspaceTab[],
  id: string,
): { tab: WorkspaceTab; siblings: WorkspaceTab[]; index: number } | null {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return null;
  const siblings = tabsIn(tabs, tab.workspaceId);
  return { tab, siblings, index: siblings.findIndex((t) => t.id === id) };
}

/** Apply `patch` to the one tab with this id; every other row is untouched. */
function patchTabs(
  tabs: readonly WorkspaceTab[],
  id: string,
  patch: (tab: WorkspaceTab) => WorkspaceTab,
): WorkspaceTab[] {
  return tabs.map((t) => (t.id === id ? patch(t) : t));
}

/** The active-id map with one workspace pointing at `tabId`. */
function withActiveTab(
  activeTabIdByWorkspace: Record<string, string | null>,
  workspaceId: string,
  tabId: string | null,
): Record<string, string | null> {
  return { ...activeTabIdByWorkspace, [workspaceId]: tabId };
}

/** Keep the tabs `keep` accepts, and leave `workspaceId` on `nextActive`. */
function closeTabs(
  tabs: readonly WorkspaceTab[],
  keep: (tab: WorkspaceTab) => boolean,
  activeTabIdByWorkspace: Record<string, string | null>,
  workspaceId: string,
  nextActive: string | null,
): {
  tabs: WorkspaceTab[];
  activeTabIdByWorkspace: Record<string, string | null>;
} {
  return {
    tabs: tabs.filter(keep),
    activeTabIdByWorkspace: withActiveTab(
      activeTabIdByWorkspace,
      workspaceId,
      nextActive,
    ),
  };
}

/**
 * The state change that patches one tab, or the state untouched when the tab
 * is gone or `skip` says the patch would change nothing.
 */
function patchOne(
  state: TabStoreState,
  id: string,
  skip: (tab: WorkspaceTab) => boolean,
  patch: (tab: WorkspaceTab) => WorkspaceTab,
): TabStoreState | { tabs: WorkspaceTab[] } {
  const target = state.tabs.find((t) => t.id === id);
  if (!target || skip(target)) return state;
  return { tabs: patchTabs(state.tabs, id, patch) };
}

const useTabStore = create<TabStoreState>()((set, get) => {
  /** The current snapshot plus the tab this action targets, or null. */
  const tabContext = (id: string) => {
    const { tabs, activeTabIdByWorkspace } = get();
    const located = locateTab(tabs, id);
    return located ? { ...located, tabs, activeTabIdByWorkspace } : null;
  };

  /** Move a workspace's active tab `offset` places around its sibling list. */
  const activateByOffset = (workspaceId: string, offset: number): void => {
    const { tabs, activeTabIdByWorkspace } = get();
    const scoped = tabsIn(tabs, workspaceId);
    if (scoped.length <= 1) return;
    const index = scoped.findIndex(
      (t) => t.id === activeTabIdByWorkspace[workspaceId],
    );
    const nextTab =
      scoped[(Math.max(index, 0) + offset + scoped.length) % scoped.length];
    if (!nextTab) return;
    set({
      activeTabIdByWorkspace: withActiveTab(
        activeTabIdByWorkspace,
        workspaceId,
        nextTab.id,
      ),
    });
  };

  return {
    tabs: [],
    activeTabIdByWorkspace: {},

    openTab: (workflow: Workflow) => {
      const { tabs } = get();
      const existing = tabs.find((t) => t.workflowId === workflow.workflowId);

      if (existing) {
        set((s) => ({
          activeTabIdByWorkspace: withActiveTab(
            s.activeTabIdByWorkspace,
            workflow.workspaceId,
            existing.id,
          ),
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
        activeTabIdByWorkspace: withActiveTab(
          s.activeTabIdByWorkspace,
          newTab.workspaceId,
          newTab.id,
        ),
      }));
    },

    setActive: (id: string) =>
      set((s) => {
        const located = locateTab(s.tabs, id);
        if (!located) return s;
        return {
          activeTabIdByWorkspace: withActiveTab(
            s.activeTabIdByWorkspace,
            located.tab.workspaceId,
            id,
          ),
        };
      }),

    closeTab: (id: string) => {
      const context = tabContext(id);
      if (!context) return;
      const { tabs, tab, siblings, index, activeTabIdByWorkspace } = context;
      const remaining = siblings.filter((t) => t.id !== id);

      let nextActive = activeTabIdByWorkspace[tab.workspaceId] ?? null;
      if (nextActive === id) {
        const successor =
          index < remaining.length ? remaining[index] : remaining[remaining.length - 1];
        nextActive = successor?.id ?? null;
      }

      set(
        closeTabs(
          tabs,
          (t) => t.id !== id,
          activeTabIdByWorkspace,
          tab.workspaceId,
          nextActive,
        ),
      );
    },

    closeOthers: (id: string) => {
      const context = tabContext(id);
      if (!context) return;
      const { tabs, tab, activeTabIdByWorkspace } = context;
      set(
        closeTabs(
          tabs,
          (t) => t.workspaceId !== tab.workspaceId || t.id === id,
          activeTabIdByWorkspace,
          tab.workspaceId,
          id,
        ),
      );
    },

    closeToRight: (id: string) => {
      const context = tabContext(id);
      if (!context) return;
      const { tabs, tab, siblings, index, activeTabIdByWorkspace } = context;
      if (index === -1) return;

      const closing = new Set(siblings.slice(index + 1).map((t) => t.id));
      if (closing.size === 0) return;

      const active = activeTabIdByWorkspace[tab.workspaceId] ?? null;
      set(
        closeTabs(
          tabs,
          (t) => !closing.has(t.id),
          activeTabIdByWorkspace,
          tab.workspaceId,
          active !== null && closing.has(active) ? id : active,
        ),
      );
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
      set((s) =>
        patchOne(
          s,
          id,
          (t) => t.isDirty,
          (t) => ({ ...t, isDirty: true }),
        ),
      ),

    markClean: (id: string) =>
      set((s) =>
        patchOne(
          s,
          id,
          (t) => !t.isDirty && !t.draft,
          (t) => {
            const clean: WorkspaceTab = { ...t, isDirty: false };
            delete clean.draft;
            return clean;
          },
        ),
      ),

    stashDraft: (id: string, draft: Workflow | null) => {
      if (draft === null) {
        get().markClean(id);
        return;
      }
      set((s) => ({
        tabs: patchTabs(s.tabs, id, (t) => ({ ...t, draft, isDirty: true })),
      }));
    },

    renameTab: (id: string, name: string) =>
      set((s) => ({ tabs: patchTabs(s.tabs, id, (t) => ({ ...t, name })) })),

    setTabViewport: (id: string, viewport: Viewport) =>
      set((s) => ({ tabs: patchTabs(s.tabs, id, (t) => ({ ...t, viewport })) })),

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

    activateNextTab: (workspaceId: string) => activateByOffset(workspaceId, 1),

    activatePrevTab: (workspaceId: string) => activateByOffset(workspaceId, -1),
  };
});

export default useTabStore;
