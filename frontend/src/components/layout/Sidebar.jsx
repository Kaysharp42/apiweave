import React, { useState, useEffect, useRef, useCallback } from 'react';
import EnvironmentManager from '../EnvironmentManager';

const Sidebar = ({ selectedNav, isCollapsed, setIsCollapsed }) => {
  const [workflows, setWorkflows] = useState([]);
  const [pagination, setPagination] = useState({
    skip: 0,
    limit: 20,
    total: 0,
    hasMore: false,
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [environments, setEnvironments] = useState([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [showEnvManager, setShowEnvManager] = useState(false);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    if (selectedNav === 'workflows') {
      // Reset and fetch initial workflows
      setWorkflows([]);
      setPagination({ skip: 0, limit: 20, total: 0, hasMore: false });
      fetchWorkflows(0);
    } else if (selectedNav === 'environments') {
      fetchEnvironments();
    }
    
    // Listen for environment changes to refresh list
    const handleEnvironmentsChanged = () => {
      if (selectedNav === 'environments') {
        fetchEnvironments();
      }
    };
    window.addEventListener('environmentsChanged', handleEnvironmentsChanged);
    
    return () => {
      window.removeEventListener('environmentsChanged', handleEnvironmentsChanged);
    };
  }, [selectedNav]);

  const fetchEnvironments = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/environments');
      if (response.ok) {
        const data = await response.json();
        setEnvironments(data);
      }
    } catch (error) {
      console.error('Error fetching environments:', error);
    }
  };

  const fetchWorkflows = async (skip = 0, append = false) => {
    try {
      setIsLoadingMore(true);
      const response = await fetch(
        `http://localhost:8000/api/workflows?skip=${skip}&limit=${pagination.limit}`
      );
      if (response.ok) {
        const data = await response.json();
        if (append) {
          setWorkflows((prev) => [...prev, ...data.workflows]);
        } else {
          setWorkflows(data.workflows);
        }
        setPagination({
          skip: data.skip,
          limit: data.limit,
          total: data.total,
          hasMore: data.hasMore,
        });
      }
    } catch (error) {
      console.error('Error fetching workflows:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || isLoadingMore || !pagination.hasMore) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Trigger load more when scrolled to within 100px of bottom
    if (scrollHeight - scrollTop - clientHeight < 100) {
      const nextSkip = pagination.skip + pagination.limit;
      fetchWorkflows(nextSkip, true);
    }
  }, [isLoadingMore, pagination]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer && selectedNav === 'workflows') {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll, selectedNav]);

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
        // Add new workflow to the top of the list
        setWorkflows([newWorkflow, ...workflows]);
        setPagination((prev) => ({
          ...prev,
          total: prev.total + 1,
        }));
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
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 flex-1 min-w-0">
            {selectedNav === 'workflows' ? 'Workflows' : 'Environments'}
          </h2>
          <div className="flex items-center gap-2">
            {selectedNav === 'workflows' && (
              <button
                onClick={createNewWorkflow}
                className="px-3 py-1 text-xs bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 flex-shrink-0"
              >
                + New
              </button>
            )}
            {selectedNav === 'environments' && (
              <button
                onClick={() => setShowEnvManager(true)}
                className="px-3 py-1 text-xs bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 flex-shrink-0"
              >
                + New
              </button>
            )}
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-cyan-900 dark:hover:text-cyan-400 rounded focus:outline-none flex-shrink-0"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        {selectedNav === 'workflows' ? (
          <div className="p-2">
            {workflows.length === 0 && !isLoadingMore ? (
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
              <>
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
                        <div className="font-medium truncate">{workflow.name}</div>
                        {workflow.description && (
                          <div className="text-xs opacity-75 mt-1 truncate">
                            {workflow.description}
                          </div>
                        )}
                        <div className="text-xs opacity-75 mt-1 truncate">
                          {workflow.nodes?.length || 0} nodes
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                {isLoadingMore && (
                  <div className="text-center py-3 text-gray-500 dark:text-gray-400 text-xs">
                    <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-cyan-900 dark:border-cyan-400"></div>
                    <span className="ml-2">Loading more...</span>
                  </div>
                )}
                {!pagination.hasMore && workflows.length > 0 && (
                  <div className="text-center py-3 text-gray-500 dark:text-gray-400 text-xs">
                    Showing all {pagination.total} workflow{pagination.total !== 1 ? 's' : ''}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="p-2">
            {environments.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                <p>No environments yet</p>
                <button
                  onClick={() => setShowEnvManager(true)}
                  className="mt-2 text-cyan-900 dark:text-cyan-400 hover:underline text-xs"
                >
                  Create your first environment
                </button>
              </div>
            ) : (
              <ul className="space-y-1">
                {environments.map((env) => (
                  <li key={env.environmentId}>
                    <button
                      onClick={() => setShowEnvManager(true)}
                      className="w-full text-left px-3 py-2 rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{env.name}</div>
                          {env.description && (
                            <div className="text-xs opacity-75 mt-1 truncate">
                              {env.description}
                            </div>
                          )}
                          <div className="text-xs opacity-75 mt-1 truncate">
                            {Object.keys(env.variables).length} variables
                          </div>
                        </div>
                        <svg className="w-4 h-4 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      
      {/* Environment Manager Modal */}
      {showEnvManager && (
        <EnvironmentManager onClose={() => setShowEnvManager(false)} />
      )}
    </div>
  );
};

export default Sidebar;
