import React, { useState, useEffect } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import WorkflowCanvas from '../WorkflowCanvas';
import VariablesPanel from '../VariablesPanel';
import WorkflowSettingsPanel from '../WorkflowSettingsPanel';
import DynamicFunctionsHelper from '../DynamicFunctionsHelper';
import { WorkflowProvider } from '../../contexts/WorkflowContext';
import { MdSettings, MdCode } from 'react-icons/md';
import { HiMiniSparkles } from 'react-icons/hi2';
import { BiPackage } from 'react-icons/bi';
import { BsGearFill } from 'react-icons/bs';
import API_BASE_URL from '../../utils/api';

const Workspace = ({ onActiveTabChange }) => {
  console.log('Workspace component rendered');
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [showVariablesPanel, setShowVariablesPanel] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState('variables'); // 'variables', 'dynamic', or 'settings'
  const [environmentNames, setEnvironmentNames] = useState({});

  // Notify parent when activeTabId changes
  useEffect(() => {
    if (onActiveTabChange) {
      onActiveTabChange(activeTabId);
    }
  }, [activeTabId, onActiveTabChange]);

  // Fetch environment names when component mounts
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

    // Listen for environment changes
    const handleEnvironmentsChanged = () => {
      fetchEnvironments();
    };
    window.addEventListener('environmentsChanged', handleEnvironmentsChanged);
    return () => window.removeEventListener('environmentsChanged', handleEnvironmentsChanged);
  }, []);

  useEffect(() => {
    const handleOpenWorkflow = (event) => {
      console.log('openWorkflow event received:', event.detail);
      const workflow = event.detail;
      
      // Check if tab already exists
      const existingTab = tabs.find(t => t.id === workflow.workflowId);
      if (existingTab) {
        console.log('Tab already exists, activating:', workflow.workflowId);
        setActiveTabId(workflow.workflowId);
        return;
      }

      // Create new tab
      const newTab = {
        id: workflow.workflowId,
        name: workflow.name,
        workflow: workflow,
      };

      console.log('Creating new tab:', newTab);
      setTabs([...tabs, newTab]);
      setActiveTabId(workflow.workflowId);
    };

    window.addEventListener('openWorkflow', handleOpenWorkflow);
    return () => window.removeEventListener('openWorkflow', handleOpenWorkflow);
  }, [tabs]);

  const closeTab = (tabId, e) => {
    e.stopPropagation();
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);
    
    if (activeTabId === tabId) {
      setActiveTabId(newTabs.length > 0 ? newTabs[0].id : null);
    }
  };

  const activeTab = tabs.find(t => t.id === activeTabId);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {tabs.length > 0 && (
        <div className="flex bg-white dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm border-r border-gray-300 dark:border-gray-700 transition-colors ${
                activeTabId === tab.id
                  ? 'bg-gray-50 dark:bg-gray-900 text-cyan-900 dark:text-cyan-400 font-medium'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center gap-2 flex-1">
                <span>{tab.name}</span>
                {tab.workflow?.environmentId && (
                  <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded whitespace-nowrap">
                    🌍 {environmentNames[tab.workflow.environmentId] || 'Environment'}
                  </span>
                )}
              </div>
              <span
                onClick={(e) => closeTab(tab.id, e)}
                className="ml-2 hover:bg-gray-300 dark:hover:bg-gray-600 rounded px-1"
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Workspace Content */}
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {activeTab ? (
          <WorkflowProvider 
            key={activeTab.id} 
            workflowId={activeTab.id} 
            initialWorkflow={activeTab.workflow}
          >
            {/* Environment Context Bar */}
            {activeTab.workflow?.environmentId && (
              <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 flex items-center gap-2 text-sm">
                <span className="text-blue-700 dark:text-blue-300">🌍 Running in environment:</span>
                <span className="font-semibold text-blue-900 dark:text-blue-200">
                  {environmentNames[activeTab.workflow.environmentId] || 'Loading...'}
                </span>
              </div>
            )}
            
            {/* Main Layout */}
            <div className="flex-1 overflow-hidden">
              <Allotment>
                {/* Left: Canvas */}
                <Allotment.Pane>
                  <WorkflowCanvas
                    workflowId={activeTab.id}
                    workflow={activeTab.workflow}
                    isPanelOpen={showVariablesPanel}
                  />
                </Allotment.Pane>
                
                {/* Right: Variables & Settings Panel (Conditional) */}
                {showVariablesPanel && (
                  <Allotment.Pane preferredSize={300} minSize={200}>
                    <div className="flex flex-col h-full bg-white dark:bg-gray-800 border-l dark:border-gray-700">
                      {/* Panel Header with Tabs */}
                      <div className="bg-slate-50 dark:bg-gray-900 border-b dark:border-gray-700 flex flex-col">
                        <div className="flex items-center justify-between px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              onClick={() => setActivePanelTab('variables')}
                              className={`px-2 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1 ${
                                activePanelTab === 'variables'
                                  ? 'bg-cyan-500 dark:bg-cyan-600 text-white'
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                              }`}
                              title="Workflow Variables"
                            >
                              <BiPackage className="w-4 h-4" />
                              Variables
                            </button>
                            <button
                              onClick={() => setActivePanelTab('dynamic')}
                              className={`px-2 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1 ${
                                activePanelTab === 'dynamic'
                                  ? 'bg-cyan-500 dark:bg-cyan-600 text-white'
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                              }`}
                              title="Dynamic Functions"
                            >
                              <HiMiniSparkles className="w-4 h-4" />
                              Functions
                            </button>
                            <button
                              onClick={() => setActivePanelTab('settings')}
                              className={`px-2 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1 ${
                                activePanelTab === 'settings'
                                  ? 'bg-cyan-500 dark:bg-cyan-600 text-white'
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                              }`}
                              title="Workflow Settings"
                            >
                              <MdSettings className="w-4 h-4" />
                              Settings
                            </button>
                          </div>
                          <button
                            onClick={() => setShowVariablesPanel(false)}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
                            title="Collapse panel"
                            aria-label="Collapse panel"
                          >
                            <svg width="16" height="16" viewBox="0 0 20 20" focusable="false" aria-hidden="true" fill="currentColor" className="text-gray-600 dark:text-gray-300">
                              <path d="M16 16V4h2v12h-2zM6 9l2.501-2.5-1.5-1.5-5 5 5 5 1.5-1.5-2.5-2.5h8V9H6z"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                      
                      {/* Panel Content based on active tab */}
                      <div className="flex-1 overflow-hidden">
                        {activePanelTab === 'variables' && (
                          <VariablesPanel />
                        )}
                        {activePanelTab === 'dynamic' && (
                          <DynamicFunctionsHelper />
                        )}
                        {activePanelTab === 'settings' && (
                          <WorkflowSettingsPanel />
                        )}
                      </div>
                    </div>
                  </Allotment.Pane>
                )}
              </Allotment>
            </div>
            
            {/* Show Panel Button (when hidden - positioned within canvas) */}
            {!showVariablesPanel && (
              <div className="absolute bottom-4 right-4 z-40">
                <button
                  onClick={() => setShowVariablesPanel(true)}
                  className="p-3 bg-cyan-500 dark:bg-cyan-600 hover:bg-cyan-600 dark:hover:bg-cyan-700 text-white rounded-full transition-colors shadow-lg hover:shadow-xl"
                  title="Show Panel (Variables, Functions, Settings)"
                  aria-label="Show Panel"
                >
                  <BsGearFill className="w-5 h-5" />
                </button>
              </div>
            )}
          </WorkflowProvider>        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p className="text-xl mb-2">Welcome to APIWeave</p>
              <p className="text-sm">Select or create a workflow to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Workspace;
