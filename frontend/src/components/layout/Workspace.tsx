import { useReducer, useEffect, useCallback } from 'react';
import { Allotment } from 'allotment';
// @ts-expect-error CSS import without types
import 'allotment/dist/style.css';
import WorkflowCanvas from '../WorkflowCanvas';
import VariablesPanel from '../VariablesPanel';
import WorkflowSettingsPanel from '../WorkflowSettingsPanel';
import DynamicFunctionsHelper from '../DynamicFunctionsHelper';
import { WorkflowProvider } from '../../contexts/WorkflowContext';
import { Settings, Sparkles, Package, PanelRightClose } from 'lucide-react';
import { TabBar } from '../organisms/TabBar';
import { KeyboardShortcutsHelp } from '../organisms/KeyboardShortcutsHelp';
import { WorkspaceEmptyState } from '../molecules/WorkspaceEmptyState';
import { PromptDialog } from '../molecules/PromptDialog';
import { Panel } from '../molecules/Panel';
import { PanelTabs } from '../molecules/PanelTabs';
import { IconButton } from '../atoms/IconButton';
import useTabStore from '../../stores/TabStore';
import useSidebarStore from '../../stores/SidebarStore';
import useNavigationStore from '../../stores/NavigationStore';
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts';
import API_BASE_URL from '../../utils/api';
import type { WorkspaceProps } from '../../types/WorkspaceProps';
import type { WorkspaceTab } from '../../types/WorkspaceTab';
import type { TabItem } from '../../types/TabItem';
import { authenticatedFetch } from '../../utils/authenticatedApi';

const panelTabs: TabItem[] = [
  { key: 'variables', icon: Package, label: 'Variables' },
  { key: 'dynamic', icon: Sparkles, label: 'Functions' },
  { key: 'settings', icon: Settings, label: 'Settings' },
];

export function Workspace(_props: WorkspaceProps) {
  const { tabs, activeTabId, openTab, closeTab, activateNextTab, activatePrevTab } = useTabStore();

  type WorkspaceState = {
    showVariablesPanel: boolean;
    activePanelTab: string;
    environmentNames: Record<string, string>;
    showShortcutsHelp: boolean;
    showNewWorkflowPrompt: boolean;
  };

  type WorkspaceAction =
    | { type: 'set-show-variables-panel'; value: boolean }
    | { type: 'set-active-panel-tab'; value: string }
    | { type: 'set-environment-names'; value: Record<string, string> }
    | { type: 'set-show-shortcuts-help'; value: boolean }
    | { type: 'set-show-new-workflow-prompt'; value: boolean };

  const [state, dispatch] = useReducer((current: WorkspaceState, action: WorkspaceAction): WorkspaceState => {
    switch (action.type) {
      case 'set-show-variables-panel':
        return { ...current, showVariablesPanel: action.value };
      case 'set-active-panel-tab':
        return { ...current, activePanelTab: action.value };
      case 'set-environment-names':
        return { ...current, environmentNames: action.value };
      case 'set-show-shortcuts-help':
        return { ...current, showShortcutsHelp: action.value };
      case 'set-show-new-workflow-prompt':
        return { ...current, showNewWorkflowPrompt: action.value };
      default:
        return current;
    }
  }, {
    showVariablesPanel: false,
    activePanelTab: 'variables',
    environmentNames: {},
    showShortcutsHelp: false,
    showNewWorkflowPrompt: false,
  });

  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    const fetchEnvironments = async () => {
      try {
        const response = await authenticatedFetch(`${API_BASE_URL}/api/environments`);
        if (response.ok) {
          const envs: Array<{ environmentId: string; name: string }> = await response.json();
          const namesMap: Record<string, string> = {};
          envs.forEach((env) => {
            namesMap[env.environmentId] = env.name;
          });
          dispatch({ type: 'set-environment-names', value: namesMap });
        }
      } catch (error) {
        console.error('Error fetching environments:', error);
      }
    };
    fetchEnvironments();
  }, []);

  const environmentVersion = useSidebarStore((s) => s.environmentVersion);
  useEffect(() => {
    if (environmentVersion > 0) {
      const fetchEnvNames = async () => {
        try {
          const response = await authenticatedFetch(`${API_BASE_URL}/api/environments`);
          if (response.ok) {
            const envs: Array<{ environmentId: string; name: string }> = await response.json();
            const namesMap: Record<string, string> = {};
            envs.forEach((env) => {
              namesMap[env.environmentId] = env.name;
            });
            dispatch({ type: 'set-environment-names', value: namesMap });
          }
        } catch (error) {
          console.error('Error fetching environments:', error);
        }
      };
      fetchEnvNames();
    }
  }, [environmentVersion]);

  const handleNewWorkflow = useCallback(() => {
    dispatch({ type: 'set-show-new-workflow-prompt', value: true });
  }, []);

  const handleCreateWorkflow = useCallback(async (name: string) => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: '',
          nodes: [{ nodeId: 'start-1', type: 'start', label: 'Start', position: { x: 100, y: 100 }, config: {} }],
          edges: [],
          variables: {},
        }),
      });
      if (response.ok) {
        const workflow = await response.json();
        openTab(workflow);
        useSidebarStore.getState().signalWorkflowsRefresh();
      }
    } catch (error) {
      console.error('Error creating workflow:', error);
    }
  }, [openTab]);

  useKeyboardShortcuts({
    onNewWorkflow: handleNewWorkflow,
    onCloseTab: () => { if (activeTabId) closeTab(activeTabId); },
    onNextTab: activateNextTab,
    onPrevTab: activatePrevTab,
    onToggleSidebar: () => useNavigationStore.getState().toggleNavBarCollapse(),
    onShowShortcutsHelp: () => dispatch({ type: 'set-show-shortcuts-help', value: true }),
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface dark:bg-surface-dark">
      <TabBar />

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        {activeTab ? (
          <WorkflowProvider
            key={activeTab.id}
            workflowId={activeTab.id}
            initialWorkflow={activeTab.workflow ?? undefined}
          >
                {activeTab.workflow?.environmentId && (
                  <div className="px-3 py-2 bg-primary/5 dark:bg-primary/10 border-b border-primary/20 dark:border-primary/20 flex items-center gap-2 text-sm">
                <span className="text-primary dark:text-cyan-400">Running in environment:</span>
                <span className="font-semibold text-text-primary dark:text-text-primary-dark">
                  {state.environmentNames[activeTab.workflow.environmentId] ?? 'Loading...'}
                </span>
              </div>
            )}

            <div className="flex-1 overflow-hidden">
              <Allotment className="h-full">
                <Allotment.Pane>
                  <div className="h-full w-full">
                    <WorkflowCanvas
                      workflowId={activeTab.id}
                      workflow={activeTab.workflow}
                      isPanelOpen={state.showVariablesPanel}
                      showVariablesPanel={state.showVariablesPanel}
                      onShowVariablesPanel={(value) => dispatch({ type: 'set-show-variables-panel', value })}
                    />
                  </div>
                </Allotment.Pane>

                {state.showVariablesPanel && (
                  <Allotment.Pane preferredSize={320} minSize={280}>
                    <Panel
                      className="h-full border-0 rounded-none"
                      title=""
                      collapsible={false}
                      headerActions={
                        <IconButton
                          tooltip="Collapse panel"
                          size="xs"
                            onClick={() => dispatch({ type: 'set-show-variables-panel', value: false })}
                        >
                          <PanelRightClose className="w-4 h-4" />
                        </IconButton>
                      }
                    >
                      <PanelTabs
                        tabs={panelTabs}
                          activeTab={state.activePanelTab}
                          onTabChange={(value) => dispatch({ type: 'set-active-panel-tab', value })}
                        />
                      {state.activePanelTab === 'variables' && <VariablesPanel />}
                      {state.activePanelTab === 'dynamic' && <DynamicFunctionsHelper />}
                      {state.activePanelTab === 'settings' && <WorkflowSettingsPanel />}
                    </Panel>
                  </Allotment.Pane>
                )}
              </Allotment>
            </div>
          </WorkflowProvider>
        ) : (
          <WorkspaceEmptyState onNewWorkflow={handleNewWorkflow} />
        )}
      </div>
        <KeyboardShortcutsHelp open={state.showShortcutsHelp} onClose={() => dispatch({ type: 'set-show-shortcuts-help', value: false })} />
      {state.showNewWorkflowPrompt && (
        <PromptDialog
          open={true}
          onClose={() => dispatch({ type: 'set-show-new-workflow-prompt', value: false })}
          onSubmit={handleCreateWorkflow}
          title="New Workflow"
          message="Enter a name for your workflow."
          placeholder="My Workflow"
          submitLabel="Create"
        />
      )}
    </div>
  );
}
