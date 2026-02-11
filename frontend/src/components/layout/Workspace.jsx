import React, { useState, useEffect, useCallback } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import WorkflowCanvas from '../WorkflowCanvas';
import VariablesPanel from '../VariablesPanel';
import WorkflowSettingsPanel from '../WorkflowSettingsPanel';
import DynamicFunctionsHelper from '../DynamicFunctionsHelper';
import { WorkflowProvider } from '../../contexts/WorkflowContext';
import { Settings, Sparkles, Package } from 'lucide-react';
import { TabBar, KeyboardShortcutsHelp } from '../organisms';
import { WorkspaceEmptyState, PromptDialog } from '../molecules';
import useTabStore from '../../stores/TabStore';
import useSidebarStore from '../../stores/SidebarStore';
import useNavigationStore from '../../stores/NavigationStore';
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts';
import API_BASE_URL from '../../utils/api';

const Workspace = ({ onActiveTabChange }) => {
  const { tabs, activeTabId, openTab, closeTab, activateNextTab, activatePrevTab } = useTabStore();
  const [showVariablesPanel, setShowVariablesPanel] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState('variables');
  const [environmentNames, setEnvironmentNames] = useState({});
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showNewWorkflowPrompt, setShowNewWorkflowPrompt] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Notify parent when activeTabId changes
  useEffect(() => {
    if (onActiveTabChange) {
      onActiveTabChange(activeTabId);
    }
  }, [activeTabId, onActiveTabChange]);

  // ---------- environment names ----------
  useEffect(() => {
    const fetchEnvironments = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/environments`);
        if (response.ok) {
          const envs = await response.json();
          const namesMap = {};
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

  // (openWorkflow bridge removed — all callers now use useTabStore.openTab() directly)

  // ---------- React to environment version changes from SidebarStore ----------
  const environmentVersion = useSidebarStore((s) => s.environmentVersion);
  useEffect(() => {
    if (environmentVersion > 0) {
      const fetchEnvNames = async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/environments`);
          if (response.ok) {
            const envs = await response.json();
            const namesMap = {};
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

  // ---------- empty-state handler: create new workflow ----------
  const handleNewWorkflow = useCallback(() => {
    setShowNewWorkflowPrompt(true);
  }, []);

  const handleCreateWorkflow = useCallback(async (name) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: '',
          nodes: [{ nodeId: 'start-1', type: 'start', position: { x: 100, y: 100 }, data: { label: 'Start' } }],
          edges: [],
        }),
      });
      if (response.ok) {
        const workflow = await response.json();
        openTab(workflow);
        // Signal sidebar to refresh via Zustand store
        useSidebarStore.getState().signalWorkflowsRefresh();
      }
    } catch (error) {
      console.error('Error creating workflow:', error);
    }
  }, [openTab]);

  // ---------- keyboard shortcuts via mousetrap ----------
  useKeyboardShortcuts({
    onNewWorkflow: handleNewWorkflow,
    onCloseTab: () => { if (activeTabId) closeTab(activeTabId); },
    onNextTab: activateNextTab,
    onPrevTab: activatePrevTab,
    onToggleSidebar: () => useNavigationStore.getState().toggleNavBarCollapse(),
    onShowShortcutsHelp: () => setShowShortcutsHelp(true),
    // onSave, onRun, onToggleJsonEditor, onToggleEnvironmentManager are handled by WorkflowCanvas
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface dark:bg-surface-dark">
      {/* Tab Bar */}
      <TabBar />

      {/* Workspace Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        {activeTab ? (
          <WorkflowProvider
            key={activeTab.id}
            workflowId={activeTab.id}
            initialWorkflow={activeTab.workflow}
          >
            {/* Environment Context Bar */}
            {activeTab.workflow?.environmentId && (
              <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 flex items-center gap-2 text-sm">
                <span className="text-blue-700 dark:text-blue-300">Running in environment:</span>
                <span className="font-semibold text-blue-900 dark:text-blue-200">
                  {environmentNames[activeTab.workflow.environmentId] || 'Loading...'}
                </span>
              </div>
            )}

            {/* Main Layout */}
            <div className="flex-1 overflow-hidden">
              <Allotment className="h-full">
                {/* Left: Canvas */}
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

                {/* Right: Variables & Settings Panel (Conditional) */}
                {showVariablesPanel && (
                  <Allotment.Pane preferredSize={300} minSize={200}>
                    <div className="flex flex-col h-full bg-surface-raised dark:bg-surface-dark-raised border-l border-border-default dark:border-border-default-dark">
                      {/* Panel Header with Tabs */}
                      <div className="bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border-default dark:border-border-default-dark flex flex-col">
                        <div className="flex items-center justify-between px-3 py-2">
                          <div className="flex gap-1">
                            {[
                              { key: 'variables', icon: Package, label: 'Variables' },
                              { key: 'dynamic', icon: Sparkles, label: 'Functions' },
                              { key: 'settings', icon: Settings, label: 'Settings' },
                            ].map(({ key, icon: Icon, label }) => (
                              <button
                                key={key}
                                onClick={() => setActivePanelTab(key)}
                                className={[
                                  'px-2 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1',
                                  activePanelTab === key
                                    ? 'bg-primary dark:bg-primary-dark text-white'
                                    : 'bg-surface-overlay dark:bg-surface-dark-overlay text-text-secondary dark:text-text-secondary-dark hover:bg-border-default dark:hover:bg-border-default-dark',
                                ].join(' ')}
                                title={`Workflow ${label}`}
                              >
                                <Icon className="w-4 h-4" />
                                {label}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => setShowVariablesPanel(false)}
                            className="p-1.5 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay rounded transition-colors flex-shrink-0"
                            title="Collapse panel"
                            aria-label="Collapse panel"
                          >
                            <svg width="16" height="16" viewBox="0 0 20 20" focusable="false" aria-hidden="true" fill="currentColor" className="text-text-secondary dark:text-text-secondary-dark">
                              <path d="M16 16V4h2v12h-2zM6 9l2.501-2.5-1.5-1.5-5 5 5 5 1.5-1.5-2.5-2.5h8V9H6z" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Panel Content based on active tab */}
                      <div className="flex-1 overflow-hidden">
                        {activePanelTab === 'variables' && <VariablesPanel />}
                        {activePanelTab === 'dynamic' && <DynamicFunctionsHelper />}
                        {activePanelTab === 'settings' && <WorkflowSettingsPanel />}
                      </div>
                    </div>
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
};

export default Workspace;
