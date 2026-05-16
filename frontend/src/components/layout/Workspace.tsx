import { useState, useEffect, useCallback } from 'react';
import { Allotment } from 'allotment';
// @ts-expect-error CSS import without types
import 'allotment/dist/style.css';
// @ts-expect-error WorkflowCanvas.jsx not yet migrated
import WorkflowCanvas from '../WorkflowCanvas';
// @ts-expect-error VariablesPanel.jsx not yet migrated
import VariablesPanel from '../VariablesPanel';
// @ts-expect-error WorkflowSettingsPanel.jsx not yet migrated
import WorkflowSettingsPanel from '../WorkflowSettingsPanel';
// @ts-expect-error DynamicFunctionsHelper.jsx not yet migrated
import DynamicFunctionsHelper from '../DynamicFunctionsHelper';
import { WorkflowProvider } from '../../contexts/WorkflowContext';
import { Settings, Sparkles, Package, PanelRightClose } from 'lucide-react';
import { TabBar, KeyboardShortcutsHelp } from '../organisms';
import { WorkspaceEmptyState, PromptDialog, Panel, PanelTabs } from '../molecules';
import { IconButton } from '../atoms';
import useTabStore from '../../stores/TabStore';
import useSidebarStore from '../../stores/SidebarStore';
import useNavigationStore from '../../stores/NavigationStore';
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts';
import API_BASE_URL from '../../utils/api';
import type { WorkspaceProps } from '../../types/WorkspaceProps';
import type { WorkspaceTab } from '../../types/WorkspaceTab';
import type { TabItem } from '../../types/TabItem';

const panelTabs: TabItem[] = [
  { key: 'variables', icon: Package, label: 'Variables' },
  { key: 'dynamic', icon: Sparkles, label: 'Functions' },
  { key: 'settings', icon: Settings, label: 'Settings' },
];

export function Workspace({ onActiveTabChange }: WorkspaceProps) {
  const { tabs, activeTabId, openTab, closeTab, activateNextTab, activatePrevTab } = useTabStore();
  const [showVariablesPanel, setShowVariablesPanel] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState('variables');
  const [environmentNames, setEnvironmentNames] = useState<Record<string, string>>({});
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showNewWorkflowPrompt, setShowNewWorkflowPrompt] = useState(false);

  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    if (onActiveTabChange) {
      onActiveTabChange(activeTabId);
    }
  }, [activeTabId, onActiveTabChange]);

  useEffect(() => {
    const fetchEnvironments = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/environments`);
        if (response.ok) {
          const envs: Array<{ environmentId: string; name: string }> = await response.json();
          const namesMap: Record<string, string> = {};
          envs.forEach((env) => {
            namesMap[env.environmentId] = env.name;
          });
          setEnvironmentNames(namesMap);
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
          const response = await fetch(`${API_BASE_URL}/api/environments`);
          if (response.ok) {
            const envs: Array<{ environmentId: string; name: string }> = await response.json();
            const namesMap: Record<string, string> = {};
            envs.forEach((env) => {
              namesMap[env.environmentId] = env.name;
            });
            setEnvironmentNames(namesMap);
          }
        } catch (error) {
          console.error('Error fetching environments:', error);
        }
      };
      fetchEnvNames();
    }
  }, [environmentVersion]);

  const handleNewWorkflow = useCallback(() => {
    setShowNewWorkflowPrompt(true);
  }, []);

  const handleCreateWorkflow = useCallback(async (name: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows`, {
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
    onShowShortcutsHelp: () => setShowShortcutsHelp(true),
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
                  {environmentNames[activeTab.workflow.environmentId] ?? 'Loading...'}
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
                      isPanelOpen={showVariablesPanel}
                      showVariablesPanel={showVariablesPanel}
                      onShowVariablesPanel={setShowVariablesPanel}
                    />
                  </div>
                </Allotment.Pane>

                {showVariablesPanel && (
                  <Allotment.Pane preferredSize={320} minSize={280}>
                    <Panel
                      title=""
                      collapsible={false}
                      headerActions={
                        <IconButton
                          tooltip="Collapse panel"
                          size="xs"
                          onClick={() => setShowVariablesPanel(false)}
                        >
                          <PanelRightClose className="w-4 h-4" />
                        </IconButton>
                      }
                    >
                      <PanelTabs
                        tabs={panelTabs}
                        activeTab={activePanelTab}
                        onTabChange={setActivePanelTab}
                      />
                      <div className="flex-1 overflow-hidden">
                        {activePanelTab === 'variables' && <VariablesPanel />}
                        {activePanelTab === 'dynamic' && <DynamicFunctionsHelper />}
                        {activePanelTab === 'settings' && <WorkflowSettingsPanel />}
                      </div>
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
      <KeyboardShortcutsHelp open={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />
      <PromptDialog
        open={showNewWorkflowPrompt}
        onClose={() => setShowNewWorkflowPrompt(false)}
        onSubmit={handleCreateWorkflow}
        title="New Workflow"
        message="Enter a name for your workflow."
        placeholder="My Workflow"
        submitLabel="Create"
      />
    </div>
  );
}
