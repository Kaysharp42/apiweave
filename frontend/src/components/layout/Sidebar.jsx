import React, { useState, useEffect, useRef, useCallback } from 'react';
import EnvironmentManager from '../EnvironmentManager';
import WorkflowExportImport from '../WorkflowExportImport';
import HARImport from '../HARImport';
import OpenAPIImport from '../OpenAPIImport';
import { MoreVertical, Download } from 'lucide-react';
import API_BASE_URL from '../../utils/api';

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
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showWorkflowImportExport, setShowWorkflowImportExport] = useState(false);
  const [showHARImport, setShowHARImport] = useState(false);
  const [showOpenAPIImport, setShowOpenAPIImport] = useState(false);
  const [exportingWorkflowId, setExportingWorkflowId] = useState(null);
  const [exportingWorkflowName, setExportingWorkflowName] = useState(null);
  const scrollContainerRef = useRef(null);
  const importMenuRef = useRef(null);
  const importMenuButtonRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState(null);

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

  // Calculate menu position when opened
  useEffect(() => {
    if (showImportMenu && importMenuButtonRef.current) {
      const buttonRect = importMenuButtonRef.current.getBoundingClientRect();
      const menuWidth = 200; // approximate menu width
      const menuHeight = 120; // approximate menu height
      const padding = 8;
      
      let top = buttonRect.bottom + padding;
      let left = buttonRect.left;
      
      // Check if menu would go off-screen to the right
      if (left + menuWidth > window.innerWidth) {
        left = buttonRect.right - menuWidth;
      }
      
      // Check if menu would go off-screen at the bottom
      if (top + menuHeight > window.innerHeight) {
        top = buttonRect.top - menuHeight - padding;
      }
      
      setMenuPosition({ top, left });
    }
  }, [showImportMenu]);

  // Close import menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        importMenuRef.current && 
        !importMenuRef.current.contains(event.target) &&
        importMenuButtonRef.current &&
        !importMenuButtonRef.current.contains(event.target)
      ) {
        setShowImportMenu(false);
      }
    };

    if (showImportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showImportMenu]);

  const fetchEnvironments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/environments`);
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
        `${API_BASE_URL}/api/workflows?skip=${skip}&limit=${pagination.limit}`
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
      const response = await fetch(`${API_BASE_URL}/api/workflows`, {
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

  const handleImportSuccess = (workflowId) => {
    // Refresh workflows list
    setWorkflows([]);
    setPagination({ skip: 0, limit: 20, total: 0, hasMore: false });
    fetchWorkflows(0);
    // Close all modals
    setShowWorkflowImportExport(false);
    setShowHARImport(false);
    setShowOpenAPIImport(false);
    setShowImportMenu(false);
  };

  const handleExportWorkflow = (workflow) => {
    setExportingWorkflowId(workflow.workflowId);
    setExportingWorkflowName(workflow.name);
    setShowWorkflowImportExport(true);
    setShowImportMenu(false);
  };

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-gray-800">
      {/* Sidebar Header */}
      <div className="p-3 border-b border-gray-300 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 flex-1 min-w-0 truncate">
            {selectedNav === 'workflows' ? 'Workflows' : 'Environments'}
          </h2>
          <div className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap">
            {selectedNav === 'workflows' && (
              <>
                <button
                  onClick={createNewWorkflow}
                  className="px-2 py-0.5 text-xs bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 flex-shrink-0 whitespace-nowrap"
                >
                  + New
                </button>
                {/* Import/Export Dropdown */}
                <div>
                  <button
                    ref={importMenuButtonRef}
                    onClick={() => setShowImportMenu(!showImportMenu)}
                    className="p-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-300 rounded flex-shrink-0 transition-colors"
                    title="Import or export workflows"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>
                
                {/* Import Menu - Modern design with smart positioning */}
                {showImportMenu && menuPosition && (
                  <>
                    {/* Backdrop overlay */}
                    <div 
                      className="fixed inset-0 z-40"
                      onClick={() => setShowImportMenu(false)}
                    />
                    {/* Menu */}
                    <div 
                      ref={importMenuRef}
                      className="fixed bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg z-50"
                      style={{
                        top: `${menuPosition.top}px`,
                        left: `${menuPosition.left}px`,
                        minWidth: '200px',
                      }}
                    >
                      <div className="py-1">
                        <button
                          onClick={() => {
                            setShowWorkflowImportExport(true);
                            setShowImportMenu(false);
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center gap-3 first:rounded-t-md"
                        >
                          <span className="text-base">📦</span>
                          <span className="font-medium">Import APIWeave</span>
                        </button>
                        <div className="border-t border-gray-200 dark:border-gray-600" />
                        <button
                          onClick={() => {
                            setShowHARImport(true);
                            setShowImportMenu(false);
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center gap-3"
                        >
                          <span className="text-base">📋</span>
                          <span className="font-medium">Import HAR File</span>
                        </button>
                        <div className="border-t border-gray-200 dark:border-gray-600" />
                        <button
                          onClick={() => {
                            setShowOpenAPIImport(true);
                            setShowImportMenu(false);
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center gap-3 last:rounded-b-md"
                        >
                          <span className="text-base">🔧</span>
                          <span className="font-medium">Import OpenAPI</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
            {selectedNav === 'environments' && (
              <button
                onClick={() => setShowEnvManager(true)}
                className="px-2 py-0.5 text-xs bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 flex-shrink-0 whitespace-nowrap"
              >
                + New
              </button>
            )}
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-0.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-cyan-900 dark:hover:text-cyan-400 rounded focus:outline-none flex-shrink-0"
              title="Collapse sidebar"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto" style={{ scrollbarGutter: 'stable' }}>
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
                      <div className="group relative">
                        <button
                          onClick={() => handleWorkflowClick(workflow)}
                          className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                            selectedWorkflowId === workflow.workflowId
                              ? 'bg-cyan-900 dark:bg-cyan-800 text-white'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200'
                          }`}
                        >
                          <div className="font-medium truncate">{workflow.name}</div>
                          <div className="text-xs opacity-75">
                            {workflow.nodes?.length || 0} nodes
                          </div>
                        </button>
                        {/* Export button - appears on hover */}
                        <button
                          onClick={() => handleExportWorkflow(workflow)}
                          className={`absolute bottom-1 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                            selectedWorkflowId === workflow.workflowId
                              ? 'text-white hover:bg-cyan-950 dark:hover:bg-cyan-700'
                              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                          title="Export workflow"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
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

      {/* Workflow Export/Import Modal */}
      {showWorkflowImportExport && (
        <WorkflowExportImport
          workflowId={exportingWorkflowId}
          workflowName={exportingWorkflowName}
          onClose={() => {
            setShowWorkflowImportExport(false);
            setExportingWorkflowId(null);
            setExportingWorkflowName(null);
          }}
          onImportSuccess={handleImportSuccess}
        />
      )}

      {/* HAR Import Modal */}
      {showHARImport && (
        <HARImport
          onClose={() => setShowHARImport(false)}
          onImportSuccess={handleImportSuccess}
        />
      )}

      {/* OpenAPI Import Modal */}
      {showOpenAPIImport && (
        <OpenAPIImport
          onClose={() => setShowOpenAPIImport(false)}
          onImportSuccess={handleImportSuccess}
        />
      )}
    </div>
  );
};

export default Sidebar;
