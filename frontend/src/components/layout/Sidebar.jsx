import React, { useState, useEffect } from 'react';

const Sidebar = ({ selectedNav }) => {
  const [workflows, setWorkflows] = useState([]);
  const [environments, setEnvironments] = useState([
    { id: '1', name: 'Development', active: true },
    { id: '2', name: 'Staging', active: false },
    { id: '3', name: 'Production', active: false },
  ]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);

  useEffect(() => {
    if (selectedNav === 'workflows') {
      fetchWorkflows();
    }
  }, [selectedNav]);

  const fetchWorkflows = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/workflows');
      if (response.ok) {
        const data = await response.json();
        setWorkflows(data);
      }
    } catch (error) {
      console.error('Error fetching workflows:', error);
    }
  };

  const createNewWorkflow = async () => {
    const name = prompt('Workflow Name:');
    if (!name) return;

    try {
      const response = await fetch('http://localhost:8000/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: '',
          nodes: [{
            nodeId: 'start-1',
            type: 'start',
            label: 'Start',
            position: { x: 250, y: 50 },
            config: {}
          }],
          edges: [],
          variables: {},
          tags: [],
        }),
      });

      if (response.ok) {
        const newWorkflow = await response.json();
        setWorkflows([newWorkflow, ...workflows]);
        setSelectedWorkflowId(newWorkflow.workflowId);
        // Trigger workspace to open this workflow
        window.dispatchEvent(new CustomEvent('openWorkflow', { detail: newWorkflow }));
      }
    } catch (error) {
      console.error('Error creating workflow:', error);
    }
  };

  const handleWorkflowClick = (workflow) => {
    setSelectedWorkflowId(workflow.workflowId);
    window.dispatchEvent(new CustomEvent('openWorkflow', { detail: workflow }));
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800">
      {/* Sidebar Header */}
      <div className="p-3 border-b border-gray-300 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
            {selectedNav === 'workflows' ? 'Workflows' : 'Environments'}
          </h2>
          {selectedNav === 'workflows' && (
            <button
              onClick={createNewWorkflow}
              className="px-3 py-1 text-xs bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900"
            >
              + New
            </button>
          )}
        </div>
      </div>

      {/* Sidebar Content */}
      <div className="flex-1 overflow-auto">
        {selectedNav === 'workflows' ? (
          <div className="p-2">
            {workflows.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                <p>No workflows yet</p>
                <button
                  onClick={createNewWorkflow}
                  className="mt-2 text-cyan-900 dark:text-cyan-400 hover:underline"
                >
                  Create your first workflow
                </button>
              </div>
            ) : (
              <ul className="space-y-1">
                {workflows.map((workflow) => (
                  <li key={workflow.workflowId}>
                    <button
                      onClick={() => handleWorkflowClick(workflow)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        selectedWorkflowId === workflow.workflowId
                          ? 'bg-cyan-900 dark:bg-cyan-800 text-white'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200'
                      }`}
                    >
                      <div className="font-medium">{workflow.name}</div>
                      {workflow.description && (
                        <div className="text-xs opacity-75 mt-1 truncate">
                          {workflow.description}
                        </div>
                      )}
                      <div className="text-xs opacity-75 mt-1">
                        {workflow.nodes?.length || 0} nodes
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="p-2">
            <ul className="space-y-1">
              {environments.map((env) => (
                <li key={env.id}>
                  <button
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      env.active
                        ? 'bg-cyan-900 dark:bg-cyan-800 text-white'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{env.name}</span>
                      {env.active && <span className="text-xs">✓</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
