import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CollectionManager from '../CollectionManager';
import WebhookManager from '../WebhookManager';
import SidebarHeader from './SidebarHeader';
import {
  Download,
  Folder,
  File,
  ChevronDown,
  ChevronRight,
  Settings,
  LayoutGrid,
  FileText,
  FolderOpen,
  Globe,
  Layers,
  Cog,
  Webhook,
} from 'lucide-react';
import API_BASE_URL from '../../utils/api';
import WorkflowExportImport from '../WorkflowExportImport';
import CollectionExportImport from '../CollectionExportImport';
import { Badge, Spinner } from '../atoms';
import { EmptyState } from '../molecules';
import useSidebarStore from '../../stores/SidebarStore';
import useTabStore from '../../stores/TabStore';

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
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [exportingWorkflowId, setExportingWorkflowId] = useState(null);
  const [exportingWorkflowName, setExportingWorkflowName] = useState(null);
  const [expandedCollections, setExpandedCollections] = useState(new Set());
  const [exportingCollectionId, setExportingCollectionId] = useState(null);
  const [exportingCollectionName, setExportingCollectionName] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const scrollContainerRef = useRef(null);

  // Zustand sidebar store subscriptions
  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const workflowVersion = useSidebarStore((s) => s.workflowVersion);
  const collectionVersion = useSidebarStore((s) => s.collectionVersion);

  // Fetch workflows/collections on initial navigation
  useEffect(() => {
    if (selectedNav === 'workflows') {
      setWorkflows([]);
      setPagination({ skip: 0, limit: 20, total: 0, hasMore: false });
      fetchWorkflows(0);
    } else if (selectedNav === 'collections') {
      fetchCollections();
      fetchWorkflows(0, false, 1000);
    }
  }, [selectedNav]);

  // React to Zustand store signals (replaces some window events)
  useEffect(() => {
    if (workflowVersion > 0) {
      setIsRefreshing(true);
      setPagination({ skip: 0, limit: 20, total: 0, hasMore: false });
      if (selectedNav === 'workflows') {
        fetchWorkflows(0);
      } else if (selectedNav === 'collections') {
        fetchWorkflows(0, false, 1000);
      }
    }
  }, [workflowVersion]);

  useEffect(() => {
    if (collectionVersion > 0) {
      setIsRefreshing(true);
      if (selectedNav === 'collections') {
        fetchCollections();
        fetchWorkflows(0, false, 1000);
      } else if (selectedNav === 'workflows') {
        fetchWorkflows(0);
      }
    }
  }, [collectionVersion]);

  // Fetch environments once for displaying badges
  useEffect(() => {
    const loadEnvs = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/environments`);
        if (res.ok) {
          const data = await res.json();
          setEnvironments(data);
        }
      } catch { /* silent */ }
    };
    loadEnvs();
  }, []);

  // Helper: get the assigned environment name for a workflow from localStorage
  const getWorkflowEnvName = (workflowId) => {
    const envId = localStorage.getItem(`selectedEnvironment_${workflowId}`);
    if (!envId) return null;
    const env = environments.find(e => e.environmentId === envId);
    return env ? env.name : null;
  };

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
        
        useTabStore.getState().openTab(workflow);
      }
    } catch (error) {
      console.error('Error creating workflow:', error);
    }
  };

  const handleWorkflowClick = (workflow) => {
    setSelectedWorkflowId(workflow.workflowId);
    
    useTabStore.getState().openTab(workflow);
  };

  const handleExportWorkflow = (workflow) => {
    setExportingWorkflowId(workflow.workflowId);
    setExportingWorkflowName(workflow.name);
    // Opening modal handled by conditional render below
  };

  const handleExportCollection = (collection) => {
    setExportingCollectionId(collection.collectionId);
    setExportingCollectionName(collection.name);
  };

  const handleCreateNew = () => {
    if (selectedNav === 'workflows') {
      createNewWorkflow();
    } else if (selectedNav === 'collections') {
      setShowCollectionManager(true);
    }
  };

  // --- Filtered data ---
  const filteredWorkflows = useMemo(() => {
    if (!searchQuery) return workflows;
    const q = searchQuery.toLowerCase();
    return workflows.filter(
      (wf) =>
        wf.name?.toLowerCase().includes(q) ||
        wf.description?.toLowerCase().includes(q),
    );
  }, [workflows, searchQuery]);

  const filteredCollections = useMemo(() => {
    if (!searchQuery) return collections;
    const q = searchQuery.toLowerCase();
    return collections.filter((c) => c.name?.toLowerCase().includes(q));
  }, [collections, searchQuery]);

  // --- Workflow item renderer (shared between workflows & collections views) ---
  const WorkflowItem = ({ workflow, isActive }) => {
    const envName = getWorkflowEnvName(workflow.workflowId);
    return (
      <li>
        <button
          onClick={() => handleWorkflowClick(workflow)}
          className={[
            'group flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-all duration-150 cursor-pointer',
            isActive
              ? 'bg-primary/10 dark:bg-primary-light/10 border-l-[3px] border-primary dark:border-primary-light'
              : 'hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay border-l-[3px] border-transparent',
          ].join(' ')}
        >
          <FileText className="w-4 h-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
          <div className="flex-1 min-w-0 text-left">
            <div className="font-medium text-text-primary dark:text-text-primary-dark truncate">
              {workflow.name}
            </div>
            <div className="text-xs text-text-secondary dark:text-text-secondary-dark flex items-center gap-1.5 flex-wrap mt-0.5">
              <Badge variant="ghost" size="xs">{workflow.nodes?.length || 0} nodes</Badge>
              {workflow.collectionId && (
                <Badge variant="info" size="xs">
                  {collections.find(c => c.collectionId === workflow.collectionId)?.name || '…'}
                </Badge>
              )}
              {envName && (
                <Badge variant="secondary" size="xs">
                  <Globe className="w-2.5 h-2.5 mr-0.5" />
                  {envName}
                </Badge>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleExportWorkflow(workflow); }}
            className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay text-text-muted dark:text-text-muted-dark"
            title="Export workflow"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </button>
      </li>
    );
  };

  // --- Render: Workflows ---
  const renderWorkflowsContent = () => (
    <div className="h-full flex flex-col">
      <div
        ref={scrollContainerRef}
        className={[
          'flex-1 overflow-auto transition-opacity duration-300',
          isRefreshing ? 'opacity-50' : 'opacity-100',
        ].join(' ')}
        style={{ scrollbarGutter: 'stable' }}
      >
        {filteredWorkflows.length === 0 && !isLoadingMore ? (
          <EmptyState
            icon={<FileText className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
            title={searchQuery ? 'No matching workflows' : 'No workflows yet'}
            description={
              searchQuery
                ? `No workflows match "${searchQuery}"`
                : 'Create your first workflow to get started'
            }
            action={
              !searchQuery && (
                <button onClick={createNewWorkflow} className="btn btn-primary btn-sm gap-1.5">
                  <FileText className="w-4 h-4" /> Create Workflow
                </button>
              )
            }
          />
        ) : (
          <>
            <ul className="menu menu-sm w-full p-1.5 gap-0.5">
              {filteredWorkflows.map((workflow) => (
                <WorkflowItem
                  key={workflow.workflowId}
                  workflow={workflow}
                  isActive={selectedWorkflowId === workflow.workflowId}
                />
              ))}
            </ul>

            {isLoadingMore && (
              <div className="flex items-center justify-center gap-2 py-4 text-text-secondary dark:text-text-secondary-dark text-xs">
                <Spinner size="xs" /> Loading more…
              </div>
            )}
            {!pagination.hasMore && workflows.length > 0 && (
              <div className="text-center py-3 text-text-muted dark:text-text-muted-dark text-xs border-t border-border dark:border-border-dark mx-3 mt-1">
                Showing all {pagination.total} workflow{pagination.total !== 1 ? 's' : ''}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  // --- Collections toggle ---
  const toggleCollection = (collectionId) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      next.has(collectionId) ? next.delete(collectionId) : next.add(collectionId);
      return next;
    });
  };

  // --- Render: Collections ---
  const renderCollectionsContent = () => (
    <div
      className={[
        'h-full overflow-auto p-1.5 transition-opacity duration-300',
        isRefreshing ? 'opacity-50' : 'opacity-100',
      ].join(' ')}
    >
      {filteredCollections.length === 0 ? (
        <EmptyState
          icon={<Layers className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
          title={searchQuery ? 'No matching collections' : 'No collections yet'}
          description={
            searchQuery
              ? `No collections match "${searchQuery}"`
              : 'Create collections to organize your workflows'
          }
          action={
            !searchQuery && (
              <button onClick={() => setShowCollectionManager(true)} className="btn btn-primary btn-sm gap-1.5">
                <Layers className="w-4 h-4" /> Create Collection
              </button>
            )
          }
        />
      ) : (
        <ul className="menu menu-sm w-full gap-1">
          {filteredCollections.map((collection) => {
            const collectionWorkflows = Array.isArray(workflows)
              ? workflows.filter((wf) => wf.collectionId === collection.collectionId)
              : [];
            const isExpanded = expandedCollections.has(collection.collectionId);

            return (
              <li key={collection.collectionId}>
                {/* Collection header row */}
                <div
                  className="group flex items-center justify-between gap-1.5 rounded-lg cursor-pointer hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
                  onClick={() => toggleCollection(collection.collectionId)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />}
                    <FolderOpen className="w-4 h-4 text-primary dark:text-primary-light flex-shrink-0" />
                    <span className="font-medium text-text-primary dark:text-text-primary-dark truncate">
                      {collection.name}
                    </span>
                    <Badge variant="ghost" size="xs">{collectionWorkflows.length}</Badge>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleExportCollection(collection); }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay text-text-muted dark:text-text-muted-dark flex-shrink-0"
                    title="Export collection"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Nested workflows with indent guide */}
                {isExpanded && (
                  <ul className="relative ml-3 pl-3 mt-0.5 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px before:bg-border dark:before:bg-border-dark">
                    {collectionWorkflows.length === 0 ? (
                      <li className="py-3 text-center">
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">
                          No workflows in this collection
                        </span>
                      </li>
                    ) : (
                      collectionWorkflows.map((workflow) => (
                        <WorkflowItem
                          key={workflow.workflowId}
                          workflow={workflow}
                          isActive={selectedWorkflowId === workflow.workflowId}
                        />
                      ))
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  // --- Render: Settings placeholder ---
  const renderSettingsContent = () => (
    <div className="h-full overflow-auto">
      <ul className="menu menu-sm w-full p-2 gap-1">
        {[
          { icon: Cog, label: 'General', desc: 'App behavior & defaults' },
          { icon: Globe, label: 'Editor', desc: 'Canvas & node defaults' },
          { icon: Layers, label: 'Theme', desc: 'Colors & appearance' },
        ].map(({ icon: Icon, label, desc }) => (
          <li key={label}>
            <button className="flex items-center gap-3 w-full rounded-lg opacity-60 cursor-not-allowed" disabled>
              <Icon className="w-4 h-4 text-text-muted dark:text-text-muted-dark" />
              <div className="text-left">
                <div className="font-medium text-text-primary dark:text-text-primary-dark text-sm">{label}</div>
                <div className="text-xs text-text-secondary dark:text-text-secondary-dark">{desc}</div>
              </div>
              <Badge variant="warning" size="xs" className="ml-auto">Soon</Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  // --- Render: Webhooks ---
  const renderWebhooksContent = () => <WebhookManager />;

  // ============================================================
  return (
    <div className="flex flex-col h-full w-full bg-surface-raised dark:bg-surface-dark-raised">
      <SidebarHeader
        selectedNav={selectedNav}
        onCreateNew={handleCreateNew}
        isRefreshing={isRefreshing}
      />

      <div className="flex-1 overflow-hidden">
        {selectedNav === 'workflows' && renderWorkflowsContent()}
        {selectedNav === 'collections' && renderCollectionsContent()}
        {selectedNav === 'webhooks' && renderWebhooksContent()}
        {selectedNav === 'settings' && renderSettingsContent()}
      </div>

      {/* Collection Manager Modal */}
      <CollectionManager open={showCollectionManager} onClose={() => setShowCollectionManager(false)} />

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

      {/* Collection Export Modal */}
      {exportingCollectionId && (
        <CollectionExportImport
          collectionId={exportingCollectionId}
          collectionName={exportingCollectionName}
          isOpen={!!exportingCollectionId}
          onClose={() => {
            setExportingCollectionId(null);
            setExportingCollectionName(null);
          }}
          mode="export"
        />
      )}
    </div>
  );
};

export default Sidebar;