import { useMemo } from "react";
import useTabStore from "../stores/TabStore";
import { useScopeContext } from "./useScopeContext";
import type { WorkspaceTabsView } from "../types/WorkspaceTabsView";

/**
 * The open tabs of the workspace the user is currently in.
 *
 * The filtering happens here, during render, rather than in an effect that
 * prunes the store: a workspace switch changes `workspaceId` and the visible
 * tabs in the same commit, so the canvas and its toolbar never get one frame
 * of the new workspace's id paired with the previous workspace's workflow.
 * That pairing is what made `agents:resolveLocalPath` (and every other scoped
 * call the toolbar makes on mount) fail with "workflow ... not found".
 */
export function useWorkspaceTabs(): WorkspaceTabsView {
  const { workspaceId } = useScopeContext();
  const allTabs = useTabStore((s) => s.tabs);
  const activeIds = useTabStore((s) => s.activeTabIdByWorkspace);

  return useMemo<WorkspaceTabsView>(() => {
    if (workspaceId === null) {
      return { workspaceId, tabs: [], activeTabId: null, activeTab: undefined };
    }
    const tabs = allTabs.filter((t) => t.workspaceId === workspaceId);
    const recorded = activeIds[workspaceId] ?? null;
    // Falling back to the most recently opened tab keeps the canvas populated
    // when the recorded id names a tab that has since been closed.
    const activeTab = tabs.find((t) => t.id === recorded) ?? tabs[tabs.length - 1];
    return { workspaceId, tabs, activeTabId: activeTab?.id ?? null, activeTab };
  }, [workspaceId, allTabs, activeIds]);
}

export default useWorkspaceTabs;
