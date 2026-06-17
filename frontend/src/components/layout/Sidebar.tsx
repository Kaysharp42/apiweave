import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { toast } from 'sonner';
import CollectionManager from '../CollectionManager';
import WebhookManager from '../WebhookManager';
import MCPManager from '../MCPManager';
import { SidebarHeader } from './SidebarHeader';
import { WorkflowList } from './sidebar/WorkflowList';
import { ProjectList } from './sidebar/ProjectList';
import { SettingsContent } from './sidebar/SettingsContent';
import WorkflowExportImport from '../WorkflowExportImport';
import CollectionExportImport from '../CollectionExportImport';
import { ConfirmDialog } from '../molecules/ConfirmDialog';
import { PromptDialog } from '../molecules/PromptDialog';
import useSidebarStore from '../../stores/SidebarStore';
import useTabStore from '../../stores/TabStore';
import { requestCollectionDeletion, requestWorkflowDeletion } from '../../utils/sidebarDeletion';
import type { Workflow } from '../../types/Workflow';
import type { Project } from '../../types/Project';
import { authenticatedFetch } from '../../utils/authenticatedApi';
import useNavigationStore from '../../stores/NavigationStore';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import API_BASE_URL from '../../utils/api';

export function Sidebar() {
  const selectedNav = useNavigationStore((s) => s.selectedNavVal);
  const setNavState = useNavigationStore((s) => s.setNavState);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [exportingWorkflowId, setExportingWorkflowId] = useState<string | null>(null);
  const [exportingWorkflowName, setExportingWorkflowName] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [exportingCollectionId, setExportingCollectionId] = useState<string | null>(null);
  const [exportingCollectionName, setExportingCollectionName] = useState<string | null>(null);
  const [showNewWorkflowPrompt, setShowNewWorkflowPrompt] = useState(false);
  const [deleteWorkflowTarget, setDeleteWorkflowTarget] = useState<{ workflowId: string; name: string } | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<{ collectionId: string; name: string } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const handleScrollRef = useRef<() => void>(() => {});

  const workflows = useSidebarStore((s) => s.workflows);
  const projects = useSidebarStore((s) => s.projects);
  const collections = useSidebarStore((s) => s.collections);
  const environments = useSidebarStore((s) => s.environments);
  const pagination = useSidebarStore((s) => s.pagination);
  const isLoadingMore = useSidebarStore((s) => s.isLoadingMore);
  const isRefreshing = useSidebarStore((s) => s.isRefreshing);
  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const closeTab = useTabStore((s) => s.closeTab);
  const fetchWorkflows = useSidebarStore((s) => s.fetchWorkflows);
  const fetchEnvironments = useSidebarStore((s) => s.fetchEnvironments);
  const refreshAll = useSidebarStore((s) => s.refreshAll);
  const setIsLoadingMore = useSidebarStore((s) => s.setIsLoadingMore);
  const setActiveWorkspaceId = useSidebarStore((s) => s.setActiveWorkspaceId);
  const { hasPermission } = useAuth();
  const navigate = useNavigate();

  // Workspace context — scope sidebar data to the active workspace
  const { currentWorkspace } = useWorkspace();

  // Sync workspace ID to the sidebar store so fetches are workspace-scoped
  useEffect(() => {
    setActiveWorkspaceId(currentWorkspace?.workspaceId ?? null);
  }, [currentWorkspace, setActiveWorkspaceId]);

  useEffect(() => {
    void fetchEnvironments();
  }, [fetchEnvironments]);

  handleScrollRef.current = () => {
    if (scrollContainerRef.current && selectedNav === 'workflows') {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      if (scrollHeight - scrollTop <= clientHeight + 100 && !isLoadingMore && pagination.hasMore) {
        setIsLoadingMore(true);
        void fetchWorkflows(pagination.skip + pagination.limit, true);
      }
    }
  };

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer && selectedNav === 'workflows') {
      const onScroll = () => handleScrollRef.current();
      scrollContainer.addEventListener('scroll', onScroll, { passive: true });
      return () => scrollContainer.removeEventListener('scroll', onScroll);
    }
  }, [selectedNav]);

  const createNewWorkflow = () => {
    setShowNewWorkflowPrompt(true);
  };

  const handleCreateWorkflow = async (name: string) => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/workflows`, {
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
        const workflow = await response.json() as Workflow;
        void refreshAll(selectedNav);
        useTabStore.getState().openTab(workflow);
      }
    } catch (error) {
      console.error('Error creating workflow:', error);
    }
  };

  const handleWorkflowClick = async (workflow: Workflow) => {
    setSelectedWorkflowId(workflow.workflowId);

    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/workflows/${workflow.workflowId}`);
      if (response.ok) {
        const fullWorkflow: Workflow = await response.json();
        if (selectedNav === 'settings') {
          setNavState('workflows');
          navigate('/');
        }
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

  const handleExportWorkflow = (workflow: Workflow) => {
    setExportingWorkflowId(workflow.workflowId);
    setExportingWorkflowName(workflow.name);
  };

  const handleExportProject = (project: Project) => {
    // Projects use collectionId for export (backward compat with .awecollection)
    setExportingCollectionId(project.collectionId);
    setExportingCollectionName(project.name);
  };

  const handleCreateNew = () => {
    if (selectedNav === 'workflows') {
      createNewWorkflow();
    } else if (selectedNav === 'projects') {
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
      if (!workflowId) return;

      toast.success('Workflow deleted permanently');
      setSelectedWorkflowId((prev) => (prev === workflowId ? null : prev));
      closeTab(workflowId);
      await refreshAll(selectedNav);
    } catch (error) {
      console.error('Error deleting workflow:', error);
      toast.error((error as Error).message || 'Error deleting workflow');
    } finally {
      setDeleteWorkflowTarget(null);
    }
  };

  const handleDeleteProject = async () => {
    try {
      const result = await requestCollectionDeletion({
        target: deleteProjectTarget,
        apiBaseUrl: API_BASE_URL,
      });

      if (!result.deleted) return;

      const collectionId = result.collectionId;
      if (!collectionId) return;

      toast.success('Project deleted permanently');
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.delete(collectionId);
        return next;
      });
      await refreshAll(selectedNav);
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error((error as Error).message || 'Error deleting project');
    } finally {
      setDeleteProjectTarget(null);
    }
  };

  const filteredWorkflows = useMemo(() => {
    if (!searchQuery) return workflows;
    const q = searchQuery.toLowerCase();
    return workflows.filter(
      (wf) =>
        wf.name?.toLowerCase().includes(q) ||
        wf.description?.toLowerCase().includes(q),
    );
  }, [workflows, searchQuery]);

  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects;
    const q = searchQuery.toLowerCase();
    return projects.filter((p) => p.name?.toLowerCase().includes(q));
  }, [projects, searchQuery]);

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.has(projectId) ? next.delete(projectId) : next.add(projectId);
      return next;
    });
  };

  const handleLoadMore = () => {
    if (!isLoadingMore && pagination.hasMore) {
      setIsLoadingMore(true);
      void fetchWorkflows(pagination.skip + pagination.limit, true);
    }
  };

  return (
    <>
      <aside className="flex flex-col h-full w-full bg-surface-raised dark:bg-surface-dark-raised" aria-label="Sidebar">
        <SidebarHeader
          selectedNav={selectedNav}
          onCreateNew={handleCreateNew}
          isRefreshing={isRefreshing}
        />

        <div className="flex-1 overflow-hidden">
          {selectedNav === 'workflows' && (
            <div className="h-full flex flex-col">
              <div
                ref={scrollContainerRef}
                className={[
                  'flex-1 overflow-y-auto overflow-x-hidden transition-opacity duration-300',
                  isRefreshing ? 'opacity-50' : 'opacity-100',
                ].join(' ')}
                style={{ scrollbarGutter: 'stable' }}
              >
                <WorkflowList
                  workflows={filteredWorkflows}
                  collections={collections}
                  environments={environments}
                  selectedWorkflowId={selectedWorkflowId}
                  isRefreshing={isRefreshing}
                  isLoadingMore={isLoadingMore}
                  searchQuery={searchQuery}
                  pagination={pagination}
                  onWorkflowClick={handleWorkflowClick}
                  onExportWorkflow={handleExportWorkflow}
                  onDeleteWorkflow={(workflowId: string, name: string) => setDeleteWorkflowTarget({ workflowId, name })}
                  onCreateWorkflow={createNewWorkflow}
                  onLoadMore={handleLoadMore}
                />
              </div>
            </div>
          )}
          {selectedNav === 'projects' && (
            <div
              className={[
                'h-full overflow-y-auto overflow-x-hidden p-1.5 transition-opacity duration-300',
                isRefreshing ? 'opacity-50' : 'opacity-100',
              ].join(' ')}
            >
              <ProjectList
                projects={filteredProjects}
                workflows={workflows}
                environments={environments}
                selectedWorkflowId={selectedWorkflowId}
                isRefreshing={isRefreshing}
                searchQuery={searchQuery}
                expandedProjects={expandedProjects}
                onToggleProject={toggleProject}
                onWorkflowClick={handleWorkflowClick}
                onExportWorkflow={handleExportWorkflow}
                onDeleteWorkflow={(workflowId: string, name: string) => setDeleteWorkflowTarget({ workflowId, name })}
                onExportProject={handleExportProject}
                onDeleteProject={(projectId: string, name: string) => setDeleteProjectTarget({ collectionId: projectId, name })}
                onCreateProject={() => setShowCollectionManager(true)}
              />
            </div>
          )}
          {selectedNav === 'webhooks' && <WebhookManager />}
          {selectedNav === 'mcp' && <MCPManager className="h-full" />}
          {selectedNav === 'settings' && (
            <SettingsContent
              hasPermission={hasPermission}
              onNavigate={(path: string) => navigate(path)}
            />
          )}
        </div>
      </aside>

      {showCollectionManager && (
        <CollectionManager open={true} onClose={() => setShowCollectionManager(false)} />
      )}

      {exportingWorkflowId && (
        <WorkflowExportImport
          workflowId={exportingWorkflowId}
          {...(exportingWorkflowName && { workflowName: exportingWorkflowName })}
          initialTab="export"
          onClose={() => {
            setExportingWorkflowId(null);
            setExportingWorkflowName(null);
          }}
        />
      )}

      {exportingCollectionId && (
        <CollectionExportImport
          collectionId={exportingCollectionId}
          {...(exportingCollectionName && { collectionName: exportingCollectionName })}
          isOpen={true}
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
            <strong className="text-text-primary dark:text-text-primary-dark">&quot;{deleteWorkflowTarget?.name ?? 'Untitled workflow'}&quot;</strong>
            ? This removes its graph and run history links from this workspace and cannot be undone.
          </span>
        }
        confirmLabel="Delete Permanently"
        intent="error"
      />

      <ConfirmDialog
        open={!!deleteProjectTarget}
        onClose={() => setDeleteProjectTarget(null)}
        onConfirm={handleDeleteProject}
        title="Delete Project Permanently"
        message={
          <span>
            Permanently delete project{' '}
            <strong className="text-text-primary dark:text-text-primary-dark">&quot;{deleteProjectTarget?.name ?? 'Untitled project'}&quot;</strong>
            ? Workflows will stay in your workspace but lose this project assignment. This cannot be undone.
          </span>
        }
        confirmLabel="Delete Permanently"
        intent="error"
      />

      <PromptDialog
        open={showNewWorkflowPrompt}
        onClose={() => setShowNewWorkflowPrompt(false)}
        onSubmit={handleCreateWorkflow}
        title="New Workflow"
        message="Enter a name for your workflow."
        placeholder="My Workflow"
        submitLabel="Create"
      />
    </>
  );
}
