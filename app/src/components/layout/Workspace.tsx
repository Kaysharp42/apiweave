import { useCallback, useEffect, useState } from "react";
import {
  TabBar,
  WORKSPACE_TABPANEL_ID,
  workspaceTabId,
} from "../organisms/TabBar";
import { WorkspaceEmptyState } from "../molecules/WorkspaceEmptyState";
import useTabStore from "../../stores/TabStore";
import useSidebarStore from "../../stores/SidebarStore";
import { useWorkspaceTabs } from "../../hooks/useWorkspaceTabs";
import { useScopeContext } from "../../hooks/useScopeContext";
import useTutorialStore from "../../stores/TutorialStore";
import { useRecentWorkflows } from "../../hooks/useRecentWorkflows";
import { useWorkspaceShortcuts } from "../../hooks/useWorkspaceShortcuts";
import { useOpenTutorials } from "../../hooks/useOpenTutorials";
import { WorkspaceCanvasPane } from "./WorkspaceCanvasPane";
import { WorkspaceDialogs } from "./WorkspaceDialogs";
import { apiweave } from "../../utils/apiweaveClient";
import { getLogger } from "../../utils/logger";
import { toast } from "sonner";
import type { RecentWorkflow, WorkspaceProps } from "../../types";

const workspaceLog = getLogger("Workspace");

/**
 * The workspace screen: the tab bar, the active tab's canvas, the launch screen
 * when no tab is open, and the workspace's own dialogs.
 *
 * Mounted once for the whole session by `MainLayout` — see the note there for
 * why the canvas outlives the route.
 */
export function Workspace({ active = true }: WorkspaceProps) {
  // The lazy boundary keeps the canvas out of the launch chunk, not out of the
  // session: this is the screen the shell exists to show, so fetch it once the
  // shell has mounted rather than making the first workflow click wait for it.
  useEffect(() => {
    void import("../WorkflowCanvas");
  }, []);

  const { openTab } = useTabStore();
  const { workspaceId, isReady: isScopeReady } = useScopeContext();
  const tutorialCompleted = useTutorialStore(
    (state) => state.completedLessonIds.length,
  );
  const tutorialLastLessonId = useTutorialStore((state) => state.lastLessonId);
  const hasTutorialProgress =
    tutorialCompleted > 0 || tutorialLastLessonId !== null;
  // This workspace's tabs only. Tabs opened before a workspace switch stay in
  // the store so switching back restores them, and rendering one under the new
  // workspace would pair that workspace's id with the previous workspace's
  // workflow in every scoped call the canvas and its toolbar make.
  const { activeTab } = useWorkspaceTabs();
  const recentWorkflows = useRecentWorkflows(
    activeTab,
    isScopeReady,
    workspaceId,
  );
  const openTutorials = useOpenTutorials();

  const [showVariablesPanel, setShowVariablesPanel] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState("variables");
  const [showNewWorkflowPrompt, setShowNewWorkflowPrompt] = useState(false);
  const [showOpenFromGit, setShowOpenFromGit] = useState(false);

  const handleNewWorkflow = useCallback(() => {
    setShowNewWorkflowPrompt(true);
  }, []);

  const handleOpenFromGit = useCallback(() => {
    setShowOpenFromGit(true);
  }, []);

  const handleCreateWorkflow = useCallback(
    async (name: string) => {
      if (!isScopeReady || !workspaceId) {
        toast.error(
          "Workspace context is still loading. Please retry once a workspace is selected.",
        );
        return;
      }

      try {
        const workflow = await apiweave.workflows.create({
          workspaceId,
          name,
          description: "",
          nodes: [
            {
              nodeId: "start-1",
              type: "start",
              label: "Start",
              position: { x: 100, y: 100 },
              config: {},
            },
          ],
          edges: [],
          variables: {},
        });
        openTab(workflow);
        useSidebarStore.getState().signalWorkflowsRefresh();
      } catch (error) {
        workspaceLog.error("Error creating workflow:", error);
      }
    },
    [isScopeReady, openTab, workspaceId],
  );

  const handleOpenRecentWorkflow = useCallback(
    async (recent: RecentWorkflow) => {
      if (!isScopeReady || !workspaceId) {
        toast.error("Select a workspace before opening workflows.");
        return;
      }

      try {
        openTab(await apiweave.workflows.get(workspaceId, recent.workflowId));
      } catch (error) {
        toast.error("Unable to open workflow. Please retry.");
        workspaceLog.error("Error fetching full workflow payload:", error);
      }
    },
    [isScopeReady, openTab, workspaceId],
  );

  useWorkspaceShortcuts(active, handleNewWorkflow);

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface dark:bg-surface-dark">
      <TabBar />

      <div
        className="flex-1 min-h-0 overflow-hidden flex flex-col relative"
        {...(activeTab && {
          id: WORKSPACE_TABPANEL_ID,
          role: "tabpanel",
          "aria-labelledby": workspaceTabId(activeTab.id),
        })}
      >
        {activeTab ? (
          <WorkspaceCanvasPane
            tab={activeTab}
            showVariablesPanel={showVariablesPanel}
            onShowVariablesPanel={setShowVariablesPanel}
            activePanelTab={activePanelTab}
            onActivePanelTabChange={setActivePanelTab}
          />
        ) : (
          <WorkspaceEmptyState
            onNewWorkflow={handleNewWorkflow}
            onOpenFromGit={handleOpenFromGit}
            onOpenTutorials={openTutorials}
            tutorialsLabel={
              hasTutorialProgress ? "Continue tutorial" : "Start tutorial"
            }
            recentWorkflows={recentWorkflows}
            onOpenWorkflow={handleOpenRecentWorkflow}
          />
        )}
      </div>

      <WorkspaceDialogs
        showNewWorkflowPrompt={showNewWorkflowPrompt}
        onCloseNewWorkflowPrompt={() => setShowNewWorkflowPrompt(false)}
        onCreateWorkflow={handleCreateWorkflow}
        showOpenFromGit={showOpenFromGit}
        onCloseOpenFromGit={() => setShowOpenFromGit(false)}
      />
    </div>
  );
}
