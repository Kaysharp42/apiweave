import React, { useState, useEffect } from 'react';
import WorkflowCanvas from '../WorkflowCanvas';

const Workspace = () => {
  console.log('Workspace component rendered');
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);

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
      {/* Tabs */}
      {tabs.length > 0 && (
        <div className="flex bg-white dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center px-4 py-2 text-sm border-r border-gray-300 dark:border-gray-700 transition-colors ${
                activeTabId === tab.id
                  ? 'bg-gray-50 dark:bg-gray-900 text-cyan-900 dark:text-cyan-400 font-medium'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <span className="mr-2">{tab.name}</span>
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
      <div className="flex-1">
        {activeTab ? (
          <WorkflowCanvas
            key={activeTab.id}
            workflowId={activeTab.id}
            workflow={activeTab.workflow}
          />
        ) : (
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
