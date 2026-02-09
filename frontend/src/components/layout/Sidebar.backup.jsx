import React, { useState, useEffect, useRef, useCallback } from 'react';
import EnvironmentManager from '../EnvironmentManager';
import CollectionManager from '../CollectionManager';
import SidebarHeader from './SidebarHeader';
import WorkflowExportImport from '../WorkflowExportImport';
import HARImport from '../HARImport';
import OpenAPIImport from '../OpenAPIImport';
import CurlImport from '../CurlImport';
import { MoreVertical, Download, Settings, Upload, Folder, Terminal } from 'lucide-react';
import API_BASE_URL from '../../utils/api';

const Sidebar = ({ selectedNav, currentWorkflowId }) => {
  const [workflows, setWorkflows] = useState([]);
  const [pagination, setPagination] = useState({
    skip: 0,
    limit: 20,
    total: 0,
    hasMore: false,
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [selectedCollectionWorkflows, setSelectedCollectionWorkflows] = useState([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showWorkflowImportExport, setShowWorkflowImportExport] = useState(false);
  const [showHARImport, setShowHARImport] = useState(false);
  const [showOpenAPIImport, setShowOpenAPIImport] = useState(false);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [exportingWorkflowId, setExportingWorkflowId] = useState(null);
  const [exportingWorkflowName, setExportingWorkflowName] = useState(null);
  const [expandedCollections, setExpandedCollections] = useState(new Set());
  const [draggedWorkflow, setDraggedWorkflow] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
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
    } else if (selectedNav === 'collections') {
      fetchCollections();
    }
    
    // Listen for collections changes to refresh list
    const handleCollectionsChanged = () => {
      if (selectedNav === 'collections') {
        fetchCollections();
      }
    };
    window.addEventListener('collectionsChanged', handleCollectionsChanged);
    
    return () => {
      window.removeEventListener('collectionsChanged', handleCollectionsChanged);
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

  const fetchCollections = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data = await response.json();
        setCollections(data);
      }
    } catch (error) {
      console.error('Error fetching collections:', error);
    }
  };

  const fetchCollectionWorkflows = async (collectionId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections/${collectionId}/workflows`);
      if (response.ok) {
        const data = await response.json();
        setSelectedCollectionWorkflows(data);
      }
    } catch (error) {
      console.error('Error fetching collection workflows:', error);
      setSelectedCollectionWorkflows([]);
    }
  };

  const handleSelectCollection = (collection) => {
    setSelectedCollection(collection);
    fetchCollectionWorkflows(collection.collectionId);
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
    setShowCurlImport(false);
    setShowImportMenu(false);
  };

  const handleExportWorkflow = (workflow) => {
    setExportingWorkflowId(workflow.workflowId);
    setExportingWorkflowName(workflow.name);
    setShowWorkflowImportExport(true);
    setShowImportMenu(false);
  };

  const handleAssignToCollection = async (workflowId, collectionId) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/workflows/${workflowId}/collection?collection_id=${collectionId}`,
        { method: 'PUT' }
      );

      if (response.ok) {
        // Refresh workflows list
        await fetchWorkflows(0);
        // If viewing a collection, refresh its workflows too
        if (selectedCollection) {
          await fetchCollectionWorkflows(selectedCollection.collectionId);
        }
        window.dispatchEvent(new CustomEvent('collectionsChanged'));
      }
    } catch (error) {
      console.error('Error assigning workflow to collection:', error);
      alert('Failed to assign workflow to collection');
    }
  };

  // Group workflows by environment
  const groupedWorkflows = () => {
    const unattached = [];
    const byCollection = {};

    workflows.forEach((workflow) => {
      if (!workflow.collectionId) {
        unattached.push(workflow);
      } else {
        if (!byCollection[workflow.collectionId]) {
          byCollection[workflow.collectionId] = [];
        }
        byCollection[workflow.collectionId].push(workflow);
      }
    });

    return { unattached, byCollection };
  };

  // Get collection name by ID
  const getCollectionName = (colId) => {
    const col = collections.find((c) => c.collectionId === colId);
    return col?.name || 'Unknown Collection';
  };

  // Toggle collection expansion
  const toggleCollection = (colId) => {
    const newExpanded = new Set(expandedCollections);
    if (newExpanded.has(colId)) {
      newExpanded.delete(colId);
    } else {
      newExpanded.add(colId);
    }
    setExpandedCollections(newExpanded);
  };

  // Handle workflow drag start
  const handleDragStart = (e, workflow) => {
    setDraggedWorkflow(workflow);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Handle collection drag over
  const handleDragOver = (e, colId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colId);
  };

  // Handle collection drag leave
  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  // Handle collection drop (assign workflow to collection)
  const handleDropCollection = async (e, colId) => {
    e.preventDefault();
    setDragOverCol(null);

    if (!draggedWorkflow) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/workflows/${draggedWorkflow.workflowId}/collection?collection_id=${colId}`,
        { method: 'PUT' }
      );

      if (response.ok) {
        // Update local state
        const updated = await response.json();
        setWorkflows((prev) =>
          prev.map((w) => (w.workflowId === updated.workflowId ? updated : w))
        );
        setDraggedWorkflow(null);
      }
    } catch (error) {
      console.error('Error attaching workflow to collection:', error);
    }
  };

  // Handle unattached drop (detach workflow from collection)
  const handleDropUnattached = async (e) => {
    e.preventDefault();
    setDragOverCol(null);

    if (!draggedWorkflow || !draggedWorkflow.collectionId) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/workflows/${draggedWorkflow.workflowId}/collection`,
        { method: 'PUT' }
      );

      if (response.ok) {
        // Update local state
        const updated = await response.json();
        setWorkflows((prev) =>
          prev.map((w) => (w.workflowId === updated.workflowId ? updated : w))
        );
        setDraggedWorkflow(null);
      }
    } catch (error) {
      console.error('Error detaching workflow from environment:', error);
    }
  };

  const handleCreateNew = () => {
    if (selectedNav === 'workflows') {
      createNewWorkflow();
    } else if (selectedNav === 'collections') {
      setShowCollectionManager(true);
    } else if (selectedNav === 'environments') {
      // Handle create new environment
      console.log('Create new environment');
    }
  };

  const handleImport = () => {
    if (selectedNav === 'collections') {
      // Handle collection import
      console.log('Import collection');
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Enhanced Sidebar Header */}
      <SidebarHeader 
        selectedNav={selectedNav}
        onCreateNew={handleCreateNew}
        onImport={handleImport}
      />

      {/* Sidebar Content */}
      <div className="flex-1 overflow-hidden">
        {selectedNav === 'workflows' && (
          <div className="h-full flex flex-col">
            <div ref={scrollContainerRef} className="flex-1 overflow-auto p-3" style={{ scrollbarGutter: 'stable' }}>
              {workflows.length === 0 && !isLoadingMore ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
                  <div className="mb-4">
                    <svg className="w-12 h-12 mx-auto opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="font-medium mb-1">No workflows yet</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Create your first workflow to get started</p>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    {workflows.map((workflow) => (
                      <div
                        key={workflow.workflowId}
                        className={`group relative px-3 py-2 rounded-lg text-sm transition-all ${
                          selectedWorkflowId === workflow.workflowId
                            ? 'bg-cyan-50 dark:bg-cyan-900/30 border-l-2 border-l-cyan-600 dark:border-l-cyan-400 text-cyan-900 dark:text-cyan-100'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200'
                        }`}
                      >
                        <button
                          onClick={() => handleWorkflowClick(workflow)}
                          onContextMenu={(e) => e.preventDefault()}
                          className="w-full text-left"
                        >
                          <div className="font-medium truncate">{workflow.name}</div>
                          <div className="text-xs opacity-75 mt-0.5">
                            {workflow.nodes?.length || 0} nodes
                            {workflow.collectionId && ` • ${collections.find(c => c.collectionId === workflow.collectionId)?.name || 'Unknown'}`}
                          </div>
                        </button>
                        <button
                          onClick={() => handleExportWorkflow(workflow)}
                          onContextMenu={(e) => e.preventDefault()}
                          className={`absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-all ${
                            selectedWorkflowId === workflow.workflowId
                              ? 'text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-800'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600'
                          }`}
                          title="Export workflow"
                        >
                          <Download className="w-4 h-4" />
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
        )}

        {selectedNav === 'collections' && (
          <div className="p-3 h-full overflow-auto">
            {collections.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <div className="mb-4">
                  <svg className="w-12 h-12 mx-auto opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7a2 2 0 012-2h14a2 2 0 012 2m0 0V5a2 2 0 00-2-2H5a2 2 0 00-2 2v2" />
                  </svg>
                </div>
                <p className="font-medium mb-1">No collections yet</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Create collections to organize your workflows</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Import/Export Dropdown */}
                <div>
                  <button
                    ref={importMenuButtonRef}
                    onClick={() => setShowImportMenu(!showImportMenu)}
                    onContextMenu={(e) => e.preventDefault()}
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
                          onContextMenu={(e) => e.preventDefault()}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center gap-3 first:rounded-t-md"
                        >
                          <Folder className="w-5 h-5" />
                          <span className="font-medium">Import APIWeave</span>
                        </button>
                        <div className="border-t border-gray-200 dark:border-gray-600" />
                        <button
                          onClick={() => {
                            setShowHARImport(true);
                            setShowImportMenu(false);
                          }}
                          onContextMenu={(e) => e.preventDefault()}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center gap-3"
                        >
                          <Upload className="w-5 h-5" />
                          <span className="font-medium">Import HAR File</span>
                        </button>
                        <div className="border-t border-gray-200 dark:border-gray-600" />
                        <button
                          onClick={() => {
                            setShowOpenAPIImport(true);
                            setShowImportMenu(false);
                          }}
                          onContextMenu={(e) => e.preventDefault()}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center gap-3"
                        >
                          <Settings className="w-5 h-5" />
                          <span className="font-medium">Import OpenAPI</span>
                        </button>
                        <div className="border-t border-gray-200 dark:border-gray-600" />
                        <button
                          onClick={() => {
                            setShowCurlImport(true);
                            setShowImportMenu(false);
                          }}
                          onContextMenu={(e) => e.preventDefault()}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center gap-3 last:rounded-b-md"
                        >
                          <Terminal className="w-5 h-5" />
                          <span className="font-medium">Import curl</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
            {selectedNav === 'collections' && (
              <button
                onClick={() => setShowCollectionManager(true)}
                onContextMenu={(e) => e.preventDefault()}
                className="px-2 py-0.5 text-xs bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 flex-shrink-0 whitespace-nowrap"
              >
                + New
              </button>
            )}
            <button
              onClick={() => setIsCollapsed(true)}
              onContextMenu={(e) => e.preventDefault()}
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
                <div className="space-y-1">
                  {/* All Workflows */}
                  {workflows.map((workflow) => (
                    <div
                      key={workflow.workflowId}
                      className={`group relative px-3 py-2 rounded text-sm transition-all ${
                        selectedWorkflowId === workflow.workflowId
                          ? 'bg-cyan-900 dark:bg-cyan-800 text-white'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200'
                      }`}
                    >
                      <button
                        onClick={() => handleWorkflowClick(workflow)}
                        onContextMenu={(e) => e.preventDefault()}
                        className="w-full text-left"
                      >
                        <div className="font-medium truncate">{workflow.name}</div>
                        <div className="text-xs opacity-75">
                          {workflow.nodes?.length || 0} nodes
                          {workflow.collectionId && ` • ${collections.find(c => c.collectionId === workflow.collectionId)?.name || 'Unknown'}`}
                        </div>
                      </button>
                      <button
                        onClick={() => handleExportWorkflow(workflow)}
                        onContextMenu={(e) => e.preventDefault()}
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
                  ))}
                </div>

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
          <div className="p-3">
            {collections.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <div className="mb-4">
                  <svg className="w-12 h-12 mx-auto opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7a2 2 0 012-2h14a2 2 0 012 2m0 0V5a2 2 0 00-2-2H5a2 2 0 00-2 2v2" />
                  </svg>
                </div>
                <p className="font-medium">No collections yet</p>
                <p className="text-xs mt-1 mb-4">Create your first collection to organize workflows</p>
                <button
                  onClick={() => setShowCollectionManager(true)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-900 dark:bg-cyan-800 text-white rounded-lg hover:bg-cyan-950 dark:hover:bg-cyan-900 text-sm font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Collection
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {collections.map((col) => {
                  const colWorkflows = workflows.filter(w => w.collectionId === col.collectionId);
                  const isExpanded = expandedCollections.has(col.collectionId);
                  
                  return (
                    <div
                      key={col.collectionId}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:border-gray-300 dark:hover:border-gray-600 transition-colors bg-white dark:bg-gray-800"
                    >
                      {/* Collection Header */}
                      <button
                        onClick={() => {
                          const newExpanded = new Set(expandedCollections);
                          if (newExpanded.has(col.collectionId)) {
                            newExpanded.delete(col.collectionId);
                          } else {
                            newExpanded.add(col.collectionId);
                          }
                          setExpandedCollections(newExpanded);
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        {/* Collection Color Dot */}
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: col.color || '#3B82F6' }}
                        />
                        
                        {/* Collection Info */}
                        <div className="flex-1 min-w-0 text-left">
                          <div className="font-semibold text-gray-800 dark:text-gray-200 text-sm truncate">
                            {col.name}
                          </div>
                          {col.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {col.description}
                            </div>
                          )}
                        </div>
                        
                        {/* Count Badge */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded">
                            {colWorkflows.length}
                          </span>
                          
                          {/* Expand Arrow */}
                          <svg
                            className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform flex-shrink-0 ${
                              isExpanded ? 'rotate-90' : ''
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </button>

                      {/* Collection Workflows */}
                      {isExpanded && (
                        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
                          {colWorkflows.length === 0 ? (
                            <div className="px-4 py-6 text-center">
                              <div className="text-gray-400 dark:text-gray-500 mb-2">
                                <svg className="w-8 h-8 mx-auto opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400">No workflows in this collection</p>
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Add workflows from the Settings panel</p>
                            </div>
                          ) : (
                            <div className="divide-y divide-gray-200 dark:divide-gray-700">
                              {colWorkflows.map((workflow) => (
                                <div
                                  key={workflow.workflowId}
                                  className={`px-4 py-2 flex items-center gap-2 group hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                                    selectedWorkflowId === workflow.workflowId
                                      ? 'bg-cyan-50 dark:bg-cyan-900/30 border-l-2 border-l-cyan-900 dark:border-l-cyan-400'
                                      : ''
                                  }`}
                                >
                                  {/* Workflow Icon */}
                                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M5.5 13a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.3A4.5 4.5 0 1113.5 13H11V9.413l1.293 1.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13H5.5z" />
                                  </svg>

                                  {/* Workflow Info */}
                                  <button
                                    onClick={() => handleWorkflowClick(workflow)}
                                    onContextMenu={(e) => e.preventDefault()}
                                    className="flex-1 text-left min-w-0"
                                  >
                                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                      {workflow.name}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      {workflow.nodes?.length || 0} nodes
                                    </div>
                                  </button>

                                  {/* Export Button */}
                                  <button
                                    onClick={() => handleExportWorkflow(workflow)}
                                    onContextMenu={(e) => e.preventDefault()}
                                    className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 flex-shrink-0"
                                    title="Export workflow"
                                  >
                                    <Download className="w-4 h-4" />
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
        )}
      </div>
      
      {/* Collection Manager Modal */}
      {showCollectionManager && (
        <CollectionManager onClose={() => setShowCollectionManager(false)} />
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

      {/* Curl Import Modal */}
      {showCurlImport && (
        <CurlImport
          onClose={() => setShowCurlImport(false)}
          onImportSuccess={handleImportSuccess}
          currentWorkflowId={currentWorkflowId}
        />
      )}
    </div>
  );
};

export default Sidebar;

