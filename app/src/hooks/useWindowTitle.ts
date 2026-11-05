import { useEffect } from "react";
import { useWorkspace } from "../contexts/WorkspaceContext";
import useTabStore from "../stores/TabStore";
import { windowTitle } from "../utils/windowTitle";

/**
 * Keeps `document.title` in step with the active tab and workspace, so the
 * taskbar, alt-tab and the window switcher name the workflow being edited
 * rather than the build's placeholder. Mounted once by the shell.
 */
export function useWindowTitle(): void {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.workspaceId ?? null;
  const workspaceName = currentWorkspace?.name ?? null;

  // A primitive selector: renaming or closing the tab, or activating another
  // one, all change this string and nothing else re-renders.
  const activeTabName = useTabStore((state) => {
    if (workspaceId === null) return null;
    const activeId = state.activeTabIdByWorkspace[workspaceId];
    return state.tabs.find((tab) => tab.id === activeId)?.name ?? null;
  });

  useEffect(() => {
    document.title = windowTitle(activeTabName, workspaceName);
  }, [activeTabName, workspaceName]);
}
