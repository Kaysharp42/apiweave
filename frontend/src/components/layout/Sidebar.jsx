import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import CollectionManager from '../CollectionManager';
import WebhookManager from '../WebhookManager';
import SidebarHeader from './SidebarHeader';
import {
  Download,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Globe,
  Layers,
  Cog,
  Trash2,
} from 'lucide-react';
import API_BASE_URL from '../../utils/api';
import WorkflowExportImport from '../WorkflowExportImport';
import CollectionExportImport from '../CollectionExportImport';
import { Badge, Spinner, Skeleton } from '../atoms';
import { ConfirmDialog, EmptyState, PromptDialog } from '../molecules';
import useSidebarStore from '../../stores/SidebarStore';
import useTabStore from '../../stores/TabStore';
import { getSidebarItemLabel } from '../../utils/sidebarItemLabel';
import { requestCollectionDeletion, requestWorkflowDeletion } from '../../utils/sidebarDeletion';

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
  const [showNewWorkflowPrompt, setShowNewWorkflowPrompt] = useState(false);
  const [deleteWorkflowTarget, setDeleteWorkflowTarget] = useState(null);
  const [deleteCollectionTarget, setDeleteCollectionTarget] = useState(null);
  const scrollContainerRef = useRef(null);

  // Zustand sidebar store subscriptions
  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const workflowVersion = useSidebarStore((s) => s.workflowVersion);
  const collectionVersion = useSidebarStore((s) => s.collectionVersion);
  const closeTab = useTabStore((s) => s.closeTab);

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

  const createNewWorkflow = () => {
    setShowNewWorkflowPrompt(true);
  };

  const handleCreateWorkflow = async (name) => {
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
            position: { x: 100, y: 100 },
            config: {},
          }],
          edges: [],
          variables: {},
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

  const handleWorkflowClick = async (workflow) => {
    setSelectedWorkflowId(workflow.workflowId);

    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflow.workflowId}`);
      if (response.ok) {
        const fullWorkflow = await response.json();
        useTabStore.getState().openTab(fullWorkflow);
        return;
      }
      toast.error(`Unable to open workflow (${response.status}). Please retry.`);
      console.error(`Failed to fetch full workflow payload (${response.status})`);
    } catch (error) {
      toast.error('Unable to open workflow. Check your connection and retry.');
      console.error('Error fetching full workflow payload:', error);
    }
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

  const handleDeleteWorkflow = async () => {
    try {
      const result = await requestWorkflowDeletion({
        target: deleteWorkflowTarget,
        apiBaseUrl: API_BASE_URL,
      });

      if (!result.deleted) return;

      const workflowId = result.workflowId;

      toast.success('Workflow deleted permanently');
      setSelectedWorkflowId((prev) => (prev === workflowId ? null : prev));
      setWorkflows((prev) => prev.filter((wf) => wf.workflowId !== workflowId));
      closeTab(workflowId);

      if (selectedNav === 'collections') {
        await Promise.all([fetchCollections(), fetchWorkflows(0, false, 1000)]);
      } else {
        await fetchWorkflows(0);
      }

      useSidebarStore.getState().signalWorkflowsRefresh();
    } catch (error) {
      console.error('Error deleting workflow:', error);
      toast.error(error.message || 'Error deleting workflow');
    } finally {
      setDeleteWorkflowTarget(null);
    }
  };

  const handleDeleteCollection = async () => {
    try {
      const result = await requestCollectionDeletion({
        target: deleteCollectionTarget,
        apiBaseUrl: API_BASE_URL,
      });

      if (!result.deleted) return;

      const collectionId = result.collectionId;

      toast.success('Collection deleted permanently');
      setCollections((prev) => prev.filter((c) => c.collectionId !== collectionId));
      setExpandedCollections((prev) => {
        const next = new Set(prev);
        next.delete(collectionId);
        return next;
      });

      if (selectedNav === 'collections') {
        await Promise.all([fetchCollections(), fetchWorkflows(0, false, 1000)]);
      } else {
        await fetchWorkflows(0);
      }

      const sidebarStore = useSidebarStore.getState();
      sidebarStore.signalCollectionsRefresh();
      sidebarStore.signalWorkflowsRefresh();
    } catch (error) {
      console.error('Error deleting collection:', error);
      toast.error(error.message || 'Error deleting collection');
    } finally {
      setDeleteCollectionTarget(null);
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
    const workflowLabel = getSidebarItemLabel(workflow.name, 46, 'Untitled workflow');
    const collectionName = workflow.collectionId
      ? collections.find((c) => c.collectionId === workflow.collectionId)?.name
      : null;
    const collectionLabel = collectionName
      ? getSidebarItemLabel(collectionName, 18, 'Collection')
      : null;
    const environmentLabel = envName
      ? getSidebarItemLabel(envName, 16, 'Environment')
      : null;

    const handleActivate = () => handleWorkflowClick(workflow);

    const handleKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleActivate();
      }
    };

    return (
      <li>
        <div
          role="button"
          tabIndex={0}
          aria-current={isActive ? 'page' : undefined}
          onClick={handleActivate}
          onKeyDown={handleKeyDown}
          className={[
            'group flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-sm transition-all duration-150 cursor-pointer border',
            isActive
              ? 'bg-primary/10 dark:bg-primary-light/10 border-primary/30 dark:border-primary-light/30 shadow-sm'
              : 'border-transparent hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:border-border/70 dark:hover:border-border-dark/70',
          ].join(' ')}
        >
          <FileText className="mt-0.5 h-4 w-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />

          <div className="min-w-0 flex-1 text-left overflow-hidden">
            <div
              className="font-medium text-text-primary dark:text-text-primary-dark truncate"
              title={workflowLabel.fullLabel}
            >
              {workflowLabel.label}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-text-secondary dark:text-text-secondary-dark overflow-hidden">
              <Badge variant="ghost" size="xs">{workflow.nodes?.length || 0} nodes</Badge>

              {collectionLabel && (
                <Badge
                  variant="info"
                  size="xs"
                  className="max-w-[9.5rem] truncate"
                  title={collectionLabel.fullLabel}
                >
                  {collectionLabel.label}
                </Badge>
              )}

              {environmentLabel && (
                <Badge
                  variant="secondary"
                  size="xs"
                  className="max-w-[9rem] truncate"
                  title={environmentLabel.fullLabel}
                >
                  <Globe className="w-2.5 h-2.5 mr-0.5" />
                  {environmentLabel.label}
                </Badge>
              )}
            </div>
          </div>

          <div className="ml-1 flex w-[64px] shrink-0 items-center justify-end gap-1">
            <button
              onClick={(event) => {
                event.stopPropagation();
                handleExportWorkflow(workflow);
              }}
              className="p-1.5 rounded-md text-text-muted dark:text-text-muted-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-all"
              title="Export workflow"
              aria-label="Export workflow"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={(event) => {
                event.stopPropagation();
                setDeleteWorkflowTarget({ workflowId: workflow.workflowId, name: workflow.name });
              }}
              className="p-1.5 rounded-md text-status-error/80 hover:bg-status-error/10 hover:text-status-error opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-all"
              title="Delete workflow permanently"
              aria-label="Delete workflow permanently"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </li>
    );
  };

  // --- Render: Workflows ---
  const renderWorkflowsContent = () => (
    <div className="h-full flex flex-col">
      <div
        ref={scrollContainerRef}
        className={[
          'flex-1 overflow-y-auto overflow-x-hidden transition-opacity duration-300',
          isRefreshing ? 'opacity-50' : 'opacity-100',
        ].join(' ')}
        style={{ scrollbarGutter: 'stable' }}
      >
        {filteredWorkflows.length === 0 && isRefreshing ? (
          /* Skeleton loading state */
          <div className="p-3 space-y-3" aria-label="Loading workflows">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton variant="circle" width={24} height={24} />
                <Skeleton variant="text" className="flex-1" height={14} />
                <Skeleton variant="text" width={32} height={14} />
              </div>
            ))}
          </div>
        ) : filteredWorkflows.length === 0 && !isLoadingMore ? (
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
            <ul className="w-full list-none p-2 space-y-1">
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
        'h-full overflow-y-auto overflow-x-hidden p-1.5 transition-opacity duration-300',
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
        <ul className="w-full list-none space-y-1 px-0.5">
          {filteredCollections.map((collection) => {
            const collectionWorkflows = Array.isArray(workflows)
              ? workflows.filter((wf) => wf.collectionId === collection.collectionId)
              : [];
            const isExpanded = expandedCollections.has(collection.collectionId);
            const collectionLabel = getSidebarItemLabel(collection.name, 40, 'Untitled collection');

            return (
              <li key={collection.collectionId}>
                {/* Collection header row */}
                <div
                  className="group flex items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 cursor-pointer transition-all hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:border-border/70 dark:hover:border-border-dark/70"
                  onClick={() => toggleCollection(collection.collectionId)}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />}
                    <FolderOpen className="w-4 h-4 text-primary dark:text-primary-light flex-shrink-0" />
                    <span
                      className="font-medium text-text-primary dark:text-text-primary-dark truncate"
                      title={collectionLabel.fullLabel}
                    >
                      {collectionLabel.label}
                    </span>
                    <Badge variant="ghost" size="xs">{collectionWorkflows.length}</Badge>
                  </div>

                  <div className="ml-1 flex w-[64px] shrink-0 items-center justify-end gap-1">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleExportCollection(collection);
                      }}
                      className="p-1.5 rounded-md text-text-muted dark:text-text-muted-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-all"
                      title="Export collection"
                      aria-label="Export collection"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteCollectionTarget({
                          collectionId: collection.collectionId,
                          name: collection.name,
                        });
                      }}
                      className="p-1.5 rounded-md text-status-error/80 hover:bg-status-error/10 hover:text-status-error opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-all"
                      title="Delete collection permanently"
                      aria-label="Delete collection permanently"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Nested workflows with indent guide */}
                {isExpanded && (
                  <ul className="relative ml-3 mt-0.5 space-y-1 pl-3 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-px before:bg-border dark:before:bg-border-dark">
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
    <div className="flex flex-col h-full w-full bg-surface-raised dark:bg-surface-dark-raised" role="complementary" aria-label="Sidebar">
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
          initialTab="export"
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

      <ConfirmDialog
        open={!!deleteWorkflowTarget}
        onClose={() => setDeleteWorkflowTarget(null)}
        onConfirm={handleDeleteWorkflow}
        title="Delete Workflow Permanently"
        message={
          <span>
            Permanently delete workflow{' '}
            <strong className="text-text-primary dark:text-text-primary-dark">"{deleteWorkflowTarget?.name || 'Untitled workflow'}"</strong>
            ? This removes its graph and run history links from this workspace and cannot be undone.
          </span>
        }
        confirmLabel="Delete Permanently"
        intent="error"
      />

      <ConfirmDialog
        open={!!deleteCollectionTarget}
        onClose={() => setDeleteCollectionTarget(null)}
        onConfirm={handleDeleteCollection}
        title="Delete Collection Permanently"
        message={
          <span>
            Permanently delete collection{' '}
            <strong className="text-text-primary dark:text-text-primary-dark">"{deleteCollectionTarget?.name || 'Untitled collection'}"</strong>
            ? Workflows will stay in your workspace but lose this collection assignment. This cannot be undone.
          </span>
        }
        confirmLabel="Delete Permanently"
        intent="error"
      />

      {/* New Workflow Prompt */}
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

export default Sidebar;
