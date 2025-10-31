import React, { useState, useEffect, useRef, useCallback } from 'react';
import CollectionManager from '../CollectionManager';
import SidebarHeader from './SidebarHeader';
import { MdDownload, MdFolder, MdInsertDriveFile, MdKeyboardArrowDown, MdKeyboardArrowRight, MdSettings } from 'react-icons/md';
import { BsFillCollectionFill } from 'react-icons/bs';
import { AiOutlineFileText, AiOutlineFolderOpen } from 'react-icons/ai';
import { BiChevronDown, BiChevronRight } from 'react-icons/bi';
import API_BASE_URL from '../../utils/api';
import WorkflowExportImport from '../WorkflowExportImport';

const Sidebar = ({ selectedNav, currentWorkflowId }) => {
  const [workflows, setWorkflows] = useState([]);
  const [pagination, setPagination] = useState({
    skip: 0,
    limit: 20,
    total: 0,
    hasMore: false,
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [selectedCollectionWorkflows, setSelectedCollectionWorkflows] = useState([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [exportingWorkflowId, setExportingWorkflowId] = useState(null);
  const [exportingWorkflowName, setExportingWorkflowName] = useState(null);
  const [expandedCollections, setExpandedCollections] = useState(new Set());
  const [draggedWorkflow, setDraggedWorkflow] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const scrollContainerRef = useRef(null);

  // Fetch workflows when needed
  useEffect(() => {
    if (selectedNav === 'workflows') {
      setWorkflows([]);
      setPagination({ skip: 0, limit: 20, total: 0, hasMore: false });
      fetchWorkflows(0);
    } else if (selectedNav === 'collections') {
      fetchCollections();
      // Also fetch workflows to show in collections
      fetchWorkflows(0, false, 1000); // Fetch more workflows for collections view
    }
    
    const handleCollectionsChanged = () => {
      // Set refreshing state for smooth transition
      setIsRefreshing(true);
      
      setTimeout(() => {
        if (selectedNav === 'collections') {
          fetchCollections();
          // Also refresh workflows to update collection assignments
          fetchWorkflows(0, false, 1000);
        } else if (selectedNav === 'workflows') {
          // Refresh workflows list to reflect collection changes
          fetchWorkflows(0);
        }
      }, 100); // Shorter delay for collections
    };

    const handleWorkflowsNeedRefresh = () => {
      // Set refreshing state for smooth transition
      setIsRefreshing(true);
      
      // Small delay for smooth transition, then refresh
      setTimeout(() => {
        // Reset pagination
        setPagination({ skip: 0, limit: 20, total: 0, hasMore: false });
        
        // Force refresh workflows regardless of current tab
        if (selectedNav === 'workflows') {
          fetchWorkflows(0);
        } else if (selectedNav === 'collections') {
          fetchWorkflows(0, false, 1000);
        }
      }, 150); // Short delay for transition
    };

    window.addEventListener('collectionsChanged', handleCollectionsChanged);
    window.addEventListener('workflowsNeedRefresh', handleWorkflowsNeedRefresh);
    
    return () => {
      window.removeEventListener('collectionsChanged', handleCollectionsChanged);
      window.removeEventListener('workflowsNeedRefresh', handleWorkflowsNeedRefresh);
    };
  }, [selectedNav]);

  const fetchWorkflows = async (skip = 0, append = false, limit = 20) => {
    try {
      // Use unattached endpoint for workflows view, all workflows for collections view
      const endpoint = selectedNav === 'workflows' 
        ? `${API_BASE_URL}/api/workflows/unattached?skip=${skip}&limit=${limit}`
        : `${API_BASE_URL}/api/workflows?skip=${skip}&limit=${limit}`;
      
      const response = await fetch(endpoint);
      if (response.ok) {
        const data = await response.json();
        
        // Both endpoints now return paginated format
        const newWorkflows = append ? [...workflows, ...data.workflows] : data.workflows;
        setWorkflows(newWorkflows);
        setPagination({
          skip: skip,
          limit: limit,
          total: data.total,
          hasMore: data.workflows.length === limit && (skip + limit) < data.total,
        });
      }
    } catch (error) {
      console.error('Error fetching workflows:', error);
    } finally {
      setIsLoadingMore(false);
      setIsRefreshing(false);
    }
  };

  const fetchCollections = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data = await response.json();
        setCollections(data);
      }
    } catch (error) {
      console.error('Error fetching collections:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current && selectedNav === 'workflows') {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      if (scrollHeight - scrollTop <= clientHeight + 100 && !isLoadingMore && pagination.hasMore) {
        setIsLoadingMore(true);
      }
    }
  }, [isLoadingMore, pagination]);

  useEffect(() => {
    if (isLoadingMore && pagination.hasMore) {
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
            position: { x: 100, y: 100 },
            data: { label: 'Start' },
          }],
          edges: [],
        }),
      });

      if (response.ok) {
        const workflow = await response.json();
        fetchWorkflows(0);
        
        window.dispatchEvent(new CustomEvent('openWorkflow', {
          detail: workflow
        }));
      }
    } catch (error) {
      console.error('Error creating workflow:', error);
    }
  };

  const handleWorkflowClick = (workflow) => {
    setSelectedWorkflowId(workflow.workflowId);
    
    window.dispatchEvent(new CustomEvent('openWorkflow', {
      detail: workflow
    }));
  };

  const handleExportWorkflow = (workflow) => {
    setExportingWorkflowId(workflow.workflowId);
    setExportingWorkflowName(workflow.name);
    // Opening modal handled by conditional render below
  };

  const handleCreateNew = () => {
    if (selectedNav === 'workflows') {
      createNewWorkflow();
    } else if (selectedNav === 'collections') {
      setShowCollectionManager(true);
    }
  };

  const handleImport = () => {
    if (selectedNav === 'collections') {
      console.log('Import collection');
    }
  };

  const renderWorkflowsContent = () => (
    <div className="h-full flex flex-col">
      <div 
        ref={scrollContainerRef} 
        className={`flex-1 overflow-auto p-3 transition-opacity duration-300 ${isRefreshing ? 'opacity-50' : 'opacity-100'}`} 
        style={{ scrollbarGutter: 'stable' }}
      >
        {workflows.length === 0 && !isLoadingMore ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            <div className="mb-4">
              <AiOutlineFileText className="w-12 h-12 mx-auto opacity-40" />
            </div>
            <p className="font-medium mb-1">No workflows yet</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Create your first workflow to get started</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {workflows.map((workflow, index) => (
                <div
                  key={workflow.workflowId}
                  className="group relative px-3 py-3 rounded-l-lg text-sm transition-all cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200"
                  onClick={() => handleWorkflowClick(workflow)}
                >
                  <div className="font-medium truncate">{workflow.name}</div>
                  <div className="text-xs opacity-75 mt-0.5">
                    {workflow.nodes?.length || 0} nodes
                    {workflow.collectionId && ` • ${collections.find(c => c.collectionId === workflow.collectionId)?.name || 'Unknown'}`}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExportWorkflow(workflow);
                    }}
                    className={`absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-all ${
                      selectedWorkflowId === workflow.workflowId
                        ? 'text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-800'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                    title="Export workflow"
                  >
                    <MdDownload className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {isLoadingMore && (
              <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-xs">
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-cyan-600 dark:border-cyan-400 mr-2"></div>
                Loading more...
              </div>
            )}
            {!pagination.hasMore && workflows.length > 0 && (
              <div className="text-center py-3 text-gray-500 dark:text-gray-400 text-xs border-t border-gray-200 dark:border-gray-700 mt-3 pt-3">
                Showing all {pagination.total} workflow{pagination.total !== 1 ? 's' : ''}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const toggleCollection = (collectionId) => {
    setExpandedCollections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(collectionId)) {
        newSet.delete(collectionId);
      } else {
        newSet.add(collectionId);
      }
      return newSet;
    });
  };

  const renderCollectionsContent = () => (
    <div className={`p-3 h-full overflow-auto transition-opacity duration-300 ${isRefreshing ? 'opacity-50' : 'opacity-100'}`}>
      {collections.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <div className="mb-4">
            <BsFillCollectionFill className="w-12 h-12 mx-auto opacity-40" />
          </div>
          <p className="font-medium mb-1">No collections yet</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">Create collections to organize your workflows</p>
        </div>
      ) : (
        <div className="space-y-2">
          {collections.map((collection) => {
            // Get workflows attached to this collection
            const collectionWorkflows = Array.isArray(workflows)
              ? workflows.filter(wf => wf.collectionId === collection.collectionId)
              : [];
            const isExpanded = expandedCollections.has(collection.collectionId);
            
            return (
              <div key={collection.collectionId} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                {/* Collection Header */}
                <button
                  onClick={() => toggleCollection(collection.collectionId)}
                  className="w-full p-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    {/* Expand/Collapse Icon */}
                    {isExpanded ? 
                      <MdKeyboardArrowDown className="w-4 h-4 text-gray-500" /> : 
                      <MdKeyboardArrowRight className="w-4 h-4 text-gray-500" />
                    }
                    {/* Collection Icon - Stacked Folders */}
                    <BsFillCollectionFill className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">{collection.name}</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {collectionWorkflows.length} workflow{collectionWorkflows.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                </button>

                {/* Collection Workflows */}
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                    {collectionWorkflows.length === 0 ? (
                      <div className="px-4 py-6 text-center">
                        <div className="text-gray-400 dark:text-gray-500 mb-2">
                          <AiOutlineFileText className="w-8 h-8 mx-auto opacity-40" />
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">No workflows in this collection</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Add workflows from the Settings panel</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {collectionWorkflows.map((workflow) => (
                          <div
                            key={workflow.workflowId}
                            className="px-4 py-2 flex items-center gap-2 group hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer rounded-l-lg"
                            onClick={() => handleWorkflowClick(workflow)}
                          >
                            {/* Workflow Icon */}
                            <MdInsertDriveFile className="w-4 h-4 text-gray-400 flex-shrink-0" />

                            {/* Workflow Info */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                {workflow.name}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {workflow.nodes?.length || 0} nodes
                              </div>
                            </div>

                            {/* Export Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportWorkflow(workflow);
                              }}
                              className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 flex-shrink-0"
                              title="Export workflow"
                            >
                              <MdDownload className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderSettingsContent = () => (
    <div className="p-3">
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <div className="mb-4">
          <MdSettings className="w-12 h-12 mx-auto opacity-40" />
        </div>
        <p className="font-medium mb-1">Settings</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">Coming soon...</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full w-full">
      <SidebarHeader 
        selectedNav={selectedNav}
        onCreateNew={handleCreateNew}
        onImport={handleImport}
        isRefreshing={isRefreshing}
      />

      <div className="flex-1 overflow-hidden bg-white dark:bg-gray-800">
        {selectedNav === 'workflows' && renderWorkflowsContent()}
        {selectedNav === 'collections' && renderCollectionsContent()}
        {selectedNav === 'settings' && renderSettingsContent()}
      </div>

      {/* Collection Manager Modal */}
      {showCollectionManager && (
        <CollectionManager onClose={() => setShowCollectionManager(false)} />
      )}

      {/* Workflow Export / Import Modal */}
      {exportingWorkflowId && (
        <WorkflowExportImport
          workflowId={exportingWorkflowId}
          workflowName={exportingWorkflowName}
          onClose={() => {
            setExportingWorkflowId(null);
            setExportingWorkflowName(null);
          }}
        />
      )}
    </div>
  );
};

export default Sidebar;