import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FolderKanban, ArrowLeft, FileText } from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/molecules/Card';
import { Badge } from '../components/atoms/Badge';
import { Spinner } from '../components/atoms/Spinner';
import { EmptyState } from '../components/molecules/EmptyState';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { Project } from '../types/Project';
import type { Workflow } from '../types/Workflow';

interface ProjectWithWorkflows {
  project: Project;
  workflows: Workflow[];
}

/**
 * WorkspaceProjectPage — displays a project's workflows within a workspace.
 * Route: /:orgSlug/:workspaceSlug/projects/:projectId
 */
export function WorkspaceProjectPage() {
  const { orgSlug, workspaceSlug, projectId } = useParams<{
    orgSlug: string;
    workspaceSlug: string;
    projectId: string;
  }>();
  const navigate = useNavigate();
  const { currentWorkspace, currentOrg, isLoading: isWorkspaceLoading } = useWorkspace();

  const [data, setData] = useState<ProjectWithWorkflows | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const orgSlugValue = currentOrg?.slug ?? orgSlug ?? 'personal';
  const wsSlugValue = currentWorkspace?.slug ?? workspaceSlug ?? '';

  const loadData = useCallback(async () => {
    if (!currentWorkspace?.workspaceId || !projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [projectRes, workflowsRes] = await Promise.all([
        authenticatedJson<Project>(
          `${API_BASE_URL}/api/workspaces/${currentWorkspace.workspaceId}/projects/${projectId}`,
        ),
        authenticatedJson<{ workflows: Workflow[]; total: number }>(
          `${API_BASE_URL}/api/workspaces/${currentWorkspace.workspaceId}/workflows?project_id=${projectId}&limit=100`,
        ),
      ]);
      setData({ project: projectRes, workflows: workflowsRes.workflows });
    } catch {
      setError('Failed to load project. You may not have access to this workspace.');
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspace, projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // 404 / unauthorized: workspace not found or not accessible
  if (!isWorkspaceLoading && !currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <FolderKanban className="w-16 h-16 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
          Workspace not found
        </h2>
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark text-center max-w-md">
          The workspace &quot;{workspaceSlug}&quot; does not exist or you do not have access to it.
        </p>
        <Button variant="primary" intent="default" size="sm" onClick={() => navigate('/')}>
          Go to Home
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="md" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <FolderKanban className="w-16 h-16 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
          Project not found
        </h2>
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark text-center max-w-md">
          {error ?? 'The project you are looking for does not exist or has been removed.'}
        </p>
        <Button
          variant="primary"
          intent="default"
          size="sm"
          onClick={() => navigate(`/${orgSlugValue}/${wsSlugValue}/workflows`)}
        >
          Back to Workflows
        </Button>
      </div>
    );
  }

  const { project, workflows } = data;

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-6 py-4 border-b border-[var(--aw-border)]">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/${orgSlugValue}/${wsSlugValue}/workflows`)}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
        <span className="text-text-muted dark:text-text-muted-dark">/</span>
        <span className="text-sm text-text-secondary dark:text-text-secondary-dark">
          {currentOrg?.name ?? 'Personal'}
        </span>
        <span className="text-text-muted dark:text-text-muted-dark">/</span>
        <span className="text-sm text-text-secondary dark:text-text-secondary-dark">
          {currentWorkspace?.name ?? workspaceSlug}
        </span>
        <span className="text-text-muted dark:text-text-muted-dark">/</span>
        <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
          {project.name}
        </span>
      </div>

      {/* Project header */}
      <div className="px-6 py-5">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: project.color ? `${project.color}20` : 'var(--aw-primary)' + '20' }}
          >
            <FolderKanban
              className="w-5 h-5"
              style={{ color: project.color ?? 'var(--aw-primary)' }}
            />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary dark:text-text-primary-dark">
              {project.name}
            </h1>
            {project.description && (
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark mt-0.5">
                {project.description}
              </p>
            )}
          </div>
          <Badge variant="ghost" size="sm" className="ml-auto">
            {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
          </Badge>
        </div>
      </div>

      {/* Workflow list */}
      <div className="px-6 pb-6">
        {workflows.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              icon={<FileText className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
              title="No workflows in this project"
              description="Create a workflow and assign it to this project to see it here."
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {workflows.map((workflow) => (
              <Card
                key={workflow.workflowId}
                className="p-4 cursor-pointer hover:border-[var(--aw-primary)]/50 transition-colors"
                onClick={() => navigate(
                  `/${orgSlugValue}/${wsSlugValue}/workflows/${workflow.workflowId}`,
                )}
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-text-primary dark:text-text-primary-dark truncate">
                      {workflow.name}
                    </div>
                    {workflow.description && (
                      <div className="text-xs text-text-secondary dark:text-text-secondary-dark truncate mt-0.5">
                        {workflow.description}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-text-muted dark:text-text-muted-dark">
                    {workflow.nodes?.length ?? 0} nodes
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkspaceProjectPage;
