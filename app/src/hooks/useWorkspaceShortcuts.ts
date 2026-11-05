import useTabStore from "../stores/TabStore";
import { confirmCloseTabs } from "../stores/PendingEditsStore";
import useNavigationStore from "../stores/NavigationStore";
import useShortcutsHelpStore from "../stores/ShortcutsHelpStore";
import useKeyboardShortcuts from "./useKeyboardShortcuts";
import { useScopeContext } from "./useScopeContext";
import { useWorkspaceTabs } from "./useWorkspaceTabs";

/**
 * The workspace's keyboard shortcuts: new workflow, close/cycle tabs, sidebar
 * and the shortcuts sheet. Disabled while a page route covers the canvas — see
 * `useKeyboardShortcuts`.
 */
export function useWorkspaceShortcuts(
  enabled: boolean,
  onNewWorkflow: () => void,
): void {
  const { closeTab, activateNextTab, activatePrevTab } = useTabStore();
  const { workspaceId } = useScopeContext();
  const { activeTabId } = useWorkspaceTabs();

  useKeyboardShortcuts({
    enabled,
    onNewWorkflow,
    onCloseTab: () => {
      if (!activeTabId) return;
      void confirmCloseTabs([activeTabId]).then((ok) => {
        if (ok) closeTab(activeTabId);
      });
    },
    onNextTab: () => {
      if (workspaceId) activateNextTab(workspaceId);
    },
    onPrevTab: () => {
      if (workspaceId) activatePrevTab(workspaceId);
    },
    onToggleSidebar: () => useNavigationStore.getState().toggleSidebar(),
    onShowShortcutsHelp: () => useShortcutsHelpStore.getState().open(),
  });
}
