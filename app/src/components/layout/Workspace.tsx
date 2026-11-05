import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { useNavigate, useParams } from "react-router";
import { WorkflowProvider } from "../../contexts/WorkflowContext";
import { Spinner } from "../atoms/Spinner";
import { Settings, Sparkles, Package, PanelRightClose } from "lucide-react";
import {
  TabBar,
  WORKSPACE_TABPANEL_ID,
  workspaceTabId,
} from "../organisms/TabBar";
import { WorkspaceEmptyState } from "../molecules/WorkspaceEmptyState";
import { PromptDialog } from "../molecules/PromptDialog";
import { Panel } from "../molecules/Panel";
import { PanelTabs } from "../molecules/PanelTabs";
import { IconButton } from "../atoms/IconButton";
import useTabStore from "../../stores/TabStore";
import { confirmCloseTabs } from "../../stores/PendingEditsStore";
import { useWorkspaceTabs } from "../../hooks/useWorkspaceTabs";
import useSidebarStore from "../../stores/SidebarStore";
import useNavigationStore from "../../stores/NavigationStore";
import useShortcutsHelpStore from "../../stores/ShortcutsHelpStore";
import useKeyboardShortcuts from "../../hooks/useKeyboardShortcuts";
import { useScopeContext } from "../../hooks/useScopeContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import useTutorialStore from "../../stores/TutorialStore";
import type { WorkspaceProps } from "../../types/WorkspaceProps";
import type { TabItem } from "../../types/TabItem";
import type { RecentWorkflow } from "../../types/RecentWorkflow";
import { apiweave } from "../../utils/apiweaveClient";
import { getLogger } from "../../utils/logger";
import { toast } from "sonner";

const workspaceLog = getLogger("Workspace");

// The canvas is the screen, but it is not the launch screen: a session with no
// tab open shows the workflow list and never mounts it. Keeping it (and the
// right-panel inspectors) behind its own chunk means the shell can paint before
// ReactFlow and the node family are parsed.
const WorkflowCanvas = lazy(() => import("../WorkflowCanvas"));
const VariablesPanel = lazy(() => import("../VariablesPanel"));
const DynamicFunctionsHelper = lazy(() => import("../DynamicFunctionsHelper"));
const WorkflowSettingsPanel = lazy(() => import("../WorkflowSettingsPanel"));
const KeyboardShortcutsHelp = lazy(() =>
  import("../organisms/KeyboardShortcutsHelp").then((module) => ({
    default: module.KeyboardShortcutsHelp,
  })),
);
const OpenWorkspaceFromGitModal = lazy(() =>
  import("../organisms/OpenWorkspaceFromGitModal").then((module) => ({
    default: module.OpenWorkspaceFromGitModal,
  })),
);

const panelTabs: TabItem[] = [
  { key: "variables", icon: Package, label: "Variables" },
  { key: "dynamic", icon: Sparkles, label: "Functions" },
  { key: "settings", icon: Settings, label: "Settings" },
];

export function Workspace({ active = true }: WorkspaceProps) {
  // The lazy boundary keeps the canvas out of the launch chunk, not out of the
  // session: this is the screen the shell exists to show, so fetch it once the
  // shell has mounted rather than making the first workflow click wait for it.
  useEffect(() => {
    void import("../WorkflowCanvas");
  }, []);

  const { openTab, closeTab, activateNextTab, activatePrevTab } =
    useTabStore();
  const { workspaceId, isReady: isScopeReady } = useScopeContext();
  const { currentOrg, currentWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const routeParams = useParams<{
    orgSlug?: string;
    workspaceSlug?: string;
  }>();
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
  const { activeTabId, activeTab } = useWorkspaceTabs();
  const [recentWorkflows, setRecentWorkflows] = useState<RecentWorkflow[]>([]);

  // The launch screen is the one place a workflow is opened without the sidebar
  // mounted (or on a nav section that does not list every workflow), so it reads
  // the workspace's full list once and keeps the five newest by `updatedAt`.
  useEffect(() => {
    if (activeTab || !isScopeReady || !workspaceId) return;

    let cancelled = false;
    const loadRecent = async (): Promise<void> => {
      try {
        const { items } = await apiweave.workflows.list(workspaceId, true);
        if (cancelled) return;
        setRecentWorkflows(
          [...items]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 5)
            .map(({ workflowId, name, updatedAt }) => ({
              workflowId,
              name,
              updatedAt,
            })),
        );
      } catch (error) {
        if (!cancelled) {
          workspaceLog.error("Error fetching recent workflows:", error);
        }
      }
    };

    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [activeTab, isScopeReady, workspaceId]);

  type WorkspaceState = {
    showVariablesPanel: boolean;
    activePanelTab: string;
    showNewWorkflowPrompt: boolean;
    showOpenFromGit: boolean;
  };

  type WorkspaceAction =
    | { type: "set-show-variables-panel"; value: boolean }
    | { type: "set-active-panel-tab"; value: string }
    | { type: "set-show-new-workflow-prompt"; value: boolean }
    | { type: "set-show-open-from-git"; value: boolean };

  const [state, dispatch] = useReducer(
    (current: WorkspaceState, action: WorkspaceAction): WorkspaceState => {
      switch (action.type) {
        case "set-show-variables-panel":
          return { ...current, showVariablesPanel: action.value };
        case "set-active-panel-tab":
          return { ...current, activePanelTab: action.value };
        case "set-show-new-workflow-prompt":
          return { ...current, showNewWorkflowPrompt: action.value };
        case "set-show-open-from-git":
          return { ...current, showOpenFromGit: action.value };
        default:
          return current;
      }
    },
    {
      showVariablesPanel: false,
      activePanelTab: "variables",
      showNewWorkflowPrompt: false,
      showOpenFromGit: false,
    },
  );

  const shortcutsHelpOpen = useShortcutsHelpStore((state) => state.isOpen);
  const closeShortcutsHelp = useShortcutsHelpStore((state) => state.close);

  const handleNewWorkflow = useCallback(() => {
    dispatch({ type: "set-show-new-workflow-prompt", value: true });
  }, []);

  const handleOpenFromGit = useCallback(() => {
    dispatch({ type: "set-show-open-from-git", value: true });
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
        openTab(
          await apiweave.workflows.get(workspaceId, recent.workflowId),
        );
      } catch (error) {
        toast.error("Unable to open workflow. Please retry.");
        workspaceLog.error("Error fetching full workflow payload:", error);
      }
    },
    [isScopeReady, openTab, workspaceId],
  );

  const handleOpenTutorials = useCallback(() => {
    const org = currentOrg?.slug ?? routeParams.orgSlug ?? "personal";
    const ws = currentWorkspace?.slug ?? routeParams.workspaceSlug ?? "personal";
    navigate(`/${org}/${ws}/tutorials`);
  }, [
    navigate,
    currentOrg?.slug,
    currentWorkspace?.slug,
    routeParams.orgSlug,
    routeParams.workspaceSlug,
  ]);

  useKeyboardShortcuts({
    enabled: active,
    onNewWorkflow: handleNewWorkflow,
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
          <WorkflowProvider
            key={activeTab.id}
            workflowId={activeTab.id}
            initialWorkflow={activeTab.draft ?? activeTab.workflow}
          >
            <div className="flex-1 overflow-hidden">
              <Allotment className="h-full">
                <Allotment.Pane>
                  <div className="h-full w-full">
                    <Suspense
                      fallback={
                        <div className="flex h-full items-center justify-center">
                          <Spinner size="lg" />
                        </div>
                      }
                    >
                      <WorkflowCanvas
                        workflowId={activeTab.id}
                        workflow={activeTab.workflow}
                        draft={activeTab.draft}
                        isPanelOpen={state.showVariablesPanel}
                        showVariablesPanel={state.showVariablesPanel}
                        onShowVariablesPanel={(value) =>
                          dispatch({ type: "set-show-variables-panel", value })
                        }
                      />
                    </Suspense>
                  </div>
                </Allotment.Pane>

                {state.showVariablesPanel && (
                  <Allotment.Pane preferredSize={320} minSize={280}>
                    <Panel
                      className="h-full rounded-none border-l border-border dark:border-border-dark"
                      title=""
                      collapsible={false}
                      headerActions={
                        <IconButton
                          tooltip="Collapse panel"
                          size="xs"
                          onClick={() =>
                            dispatch({
                              type: "set-show-variables-panel",
                              value: false,
                            })
                          }
                        >
                          <PanelRightClose className="w-4 h-4" />
                        </IconButton>
                      }
                    >
                      {/* Column: the tab bar keeps its intrinsic height and the
                          active panel takes the rest. Without this the panel's
                          own `h-full` stacked below the tab bar and its footer
                          was clipped out of reach by the shell's overflow. */}
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="shrink-0">
                          <PanelTabs
                            tabs={panelTabs}
                            activeTab={state.activePanelTab}
                            onTabChange={(value) =>
                              dispatch({ type: "set-active-panel-tab", value })
                            }
                          />
                        </div>

                        <div className="min-h-0 flex-1">
                          <Suspense
                            fallback={
                              <div className="flex justify-center p-4">
                                <Spinner />
                              </div>
                            }
                          >
                            {state.activePanelTab === "variables" && (
                              <VariablesPanel />
                            )}
                            {state.activePanelTab === "dynamic" && (
                              <DynamicFunctionsHelper />
                            )}
                            {state.activePanelTab === "settings" && (
                              <WorkflowSettingsPanel />
                            )}
                          </Suspense>
                        </div>
                      </div>
                    </Panel>
                  </Allotment.Pane>
                )}
              </Allotment>
            </div>
          </WorkflowProvider>
        ) : (
          <WorkspaceEmptyState
            onNewWorkflow={handleNewWorkflow}
            onOpenFromGit={handleOpenFromGit}
            onOpenTutorials={handleOpenTutorials}
            tutorialsLabel={
              hasTutorialProgress ? "Continue tutorial" : "Start tutorial"
            }
            recentWorkflows={recentWorkflows}
            onOpenWorkflow={handleOpenRecentWorkflow}
          />
        )}
      </div>

      {shortcutsHelpOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcutsHelp open onClose={closeShortcutsHelp} />
        </Suspense>
      )}

      {state.showNewWorkflowPrompt && (
        <PromptDialog
          open={true}
          onClose={() =>
            dispatch({ type: "set-show-new-workflow-prompt", value: false })
          }
          onSubmit={handleCreateWorkflow}
          title="New Workflow"
          message="Enter a name for your workflow."
          placeholder="My Workflow"
          submitLabel="Create"
        />
      )}

      {state.showOpenFromGit && (
        <Suspense fallback={null}>
          <OpenWorkspaceFromGitModal
            isOpen
            onClose={() =>
              dispatch({ type: "set-show-open-from-git", value: false })
            }
          />
        </Suspense>
      )}
    </div>
  );
}
