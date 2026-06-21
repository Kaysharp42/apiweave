import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FolderKanban, ArrowLeft, FileText, Plus } from "lucide-react";
import { Button } from "../components/atoms/Button";
import { Card } from "../components/molecules/Card";
import { Badge } from "../components/atoms/Badge";
import { Spinner } from "../components/atoms/Spinner";
import { EmptyState } from "../components/molecules/EmptyState";
import { PromptDialog } from "../components/molecules/PromptDialog";
import { useWorkspace } from "../contexts/WorkspaceContext";
import {
  authenticatedJson,
  authenticatedFetch,
} from "../utils/authenticatedApi";
import {
  workflowsCreateInProjectUrl,
  projectWorkflowAssignUrl,
} from "../utils/scopedApi";
import API_BASE_URL from "../utils/api";
import { toast } from "sonner";
import type { Project } from "../types/Project";
import type { Workflow } from "../types/Workflow";

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
  const {
    currentWorkspace,
    currentOrg,
    isLoading: isWorkspaceLoading,
  } = useWorkspace();

  const [data, setData] = useState<ProjectWithWorkflows | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreatePrompt, setShowCreatePrompt] = useState(false);
  const [allWorkflows, setAllWorkflows] = useState<Workflow[]>([]);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);

  const orgSlugValue = currentOrg?.slug ?? orgSlug ?? "personal";
  const wsSlugValue = currentWorkspace?.slug ?? workspaceSlug ?? "";

  const loadData = useCallback(async () => {
    if (!currentWorkspace?.workspaceId || !projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [projectRes, workflowsRes, allWorkflowsRes] = await Promise.all([
        authenticatedJson<Project>(
          `${API_BASE_URL}/api/workspaces/${currentWorkspace.workspaceId}/projects/${projectId}`,
        ),
        authenticatedJson<{ workflows: Workflow[]; total: number }>(
          `${API_BASE_URL}/api/workspaces/${currentWorkspace.workspaceId}/workflows?project_id=${projectId}&limit=100`,
        ),
        authenticatedJson<{ workflows: Workflow[]; total: number }>(
          `${API_BASE_URL}/api/workspaces/${currentWorkspace.workspaceId}/workflows?skip=0&limit=100`,
        ),
      ]);
      setData({ project: projectRes, workflows: workflowsRes.workflows });
      setAllWorkflows(allWorkflowsRes.workflows);
    } catch {
      setError(
        "Failed to load project. You may not have access to this workspace.",
      );
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
        <FolderKanban
          className="w-16 h-16 text-text-muted dark:text-text-muted-dark"
          strokeWidth={1.5}
        />
        <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
          Workspace not found
        </h2>
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark text-center max-w-md">
          The workspace &quot;{workspaceSlug}&quot; does not exist or you do not
          have access to it.
        </p>
        <Button
          variant="primary"
          intent="default"
          size="sm"
          onClick={() => navigate("/")}
        >
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
        <FolderKanban
          className="w-16 h-16 text-text-muted dark:text-text-muted-dark"
          strokeWidth={1.5}
        />
        <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
          Project not found
        </h2>
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark text-center max-w-md">
          {error ??
            "The project you are looking for does not exist or has been removed."}
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
  const wsId = currentWorkspace?.workspaceId ?? "";
  const unassignedWorkflows = allWorkflows.filter(
    (wf) => !wf.collectionId || wf.collectionId !== projectId,
  );

  const handleCreateWorkflowInProject = async (name: string): Promise<void> => {
    if (!wsId || !projectId) return;
    try {
      const response = await authenticatedFetch(
        workflowsCreateInProjectUrl(wsId, projectId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: "",
            nodes: [
              {
                nodeId: "start-1",
                type: "start",
                label: "Start",
                position: { x: 100, y: 100 },
                config: {},
              },
            ],
            edges: [],
            variables: {},
          }),
        },
      );
      if (response.ok) {
        const workflow = (await response.json()) as Workflow;
        toast.success(`Workflow "${name}" created and added to project`);
        navigate(
          `/${orgSlugValue}/${wsSlugValue}/workflows/${workflow.workflowId}`,
        );
      } else {
        const errBody = (await response.json()) as { detail?: string };
        toast.error(errBody.detail ?? "Failed to create workflow");
      }
    } catch {
      toast.error("Failed to create workflow in project");
    } finally {
      setShowCreatePrompt(false);
    }
  };

  const handleAssignWorkflow = async (workflowId: string): Promise<void> => {
    if (!wsId || !projectId) return;
    try {
      const response = await authenticatedFetch(
        projectWorkflowAssignUrl(wsId, projectId, workflowId),
        { method: "POST" },
      );
      if (response.ok) {
        toast.success("Workflow assigned to project");
        void loadData();
      } else {
        const errBody = (await response.json()) as { detail?: string };
        toast.error(errBody.detail ?? "Failed to assign workflow");
      }
    } catch {
      toast.error("Failed to assign workflow to project");
    } finally {
      setShowAssignDropdown(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-6 py-4 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
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
          {currentOrg?.name ?? "Personal"}
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
      <div className="px-6 py-8 border-b border-border dark:border-border-dark">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded flex items-center justify-center border border-border dark:border-border-dark"
            style={{
              backgroundColor: project.color
                ? `${project.color}20`
                : "var(--aw-primary)" + "20",
            }}
          >
            <FolderKanban
              className="w-5 h-5"
              style={{ color: project.color ?? "var(--aw-primary)" }}
            />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight text-text-primary dark:text-text-primary-dark">
              {project.name}
            </h1>
            {project.description && (
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark mt-0.5">
                {project.description}
              </p>
            )}
          </div>
          <Badge variant="ghost" size="sm" className="ml-auto">
            {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      {/* Workflow list */}
      <div className="px-6 pb-6">
        {workflows.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              icon={
                <FileText
                  className="w-12 h-12 text-text-muted dark:text-text-muted-dark"
                  strokeWidth={1.5}
                />
              }
              title="No workflows in this project"
              description="Create a workflow and assign it to this project to see it here."
              action={
                <div className="flex flex-col gap-2 items-center">
                  <Button
                    variant="primary"
                    intent="success"
                    size="sm"
                    icon={<Plus className="w-4 h-4" />}
                    onClick={() => setShowCreatePrompt(true)}
                  >
                    Create Workflow in Project
                  </Button>
                  {unassignedWorkflows.length > 0 && (
                    <div className="relative">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setShowAssignDropdown(!showAssignDropdown)
                        }
                      >
                        Assign Existing Workflow
                      </Button>
                      {showAssignDropdown && (
                        <div className="absolute top-full left-0 right-0 mt-1 rounded border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised max-h-60 overflow-y-auto z-10">
                          {unassignedWorkflows.map((wf) => (
                            <button
                              key={wf.workflowId}
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
                              onClick={() =>
                                void handleAssignWorkflow(wf.workflowId)
                              }
                            >
                              <FileText className="w-4 h-4 flex-shrink-0 text-text-muted dark:text-text-muted-dark" />
                              <span className="truncate text-text-primary dark:text-text-primary-dark">
                                {wf.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              }
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {workflows.map((workflow) => (
              <div
                key={workflow.workflowId}
                onClick={() =>
                  navigate(
                    `/${orgSlugValue}/${wsSlugValue}/workflows/${workflow.workflowId}`,
                  )
                }
                className="cursor-pointer"
              >
                <Card className="p-4 hover:border-primary dark:hover:border-primary-light transition-colors duration-200 motion-reduce:transition-none rounded">
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
              </div>
            ))}
          </div>
        )}
      </div>

      <PromptDialog
        open={showCreatePrompt}
        onClose={() => setShowCreatePrompt(false)}
        onSubmit={handleCreateWorkflowInProject}
        title="New Workflow in Project"
        message="Enter a name for the new workflow. It will be automatically assigned to this project."
        placeholder="My Workflow"
        submitLabel="Create & Assign"
      />
    </div>
  );
}

export default WorkspaceProjectPage;
