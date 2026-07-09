import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import CollectionManager from "../CollectionManager";
import WebhookManager from "../WebhookManager";
import MCPManager from "../MCPManager";
import { SidebarHeader } from "./SidebarHeader";
import { WorkflowList } from "./sidebar/WorkflowList";
import { ProjectList } from "./sidebar/ProjectList";
import { SettingsContent } from "./sidebar/SettingsContent";
import WorkflowExportImport from "../WorkflowExportImport";
import CollectionExportImport from "../CollectionExportImport";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { PromptDialog } from "../molecules/PromptDialog";
import useSidebarStore from "../../stores/SidebarStore";
import useEnvironmentStore from "../../stores/EnvironmentStore";
import useTabStore from "../../stores/TabStore";
import {
  requestProjectDeletion,
  requestWorkflowDeletion,
} from "../../utils/apiweaveClient";
import type { Workflow } from "../../types/Workflow";
import type { Project } from "../../types/Project";
import { authenticatedFetch } from "../../utils/apiweaveClient";
import useNavigationStore from "../../stores/NavigationStore";
import API_BASE_URL from "../../utils/apiweaveClient";
import { useScopeContext } from "../../hooks/useScopeContext";
import {
  workflowUrl,
  workflowsUrl,
  workflowsCreateInProjectUrl,
  projectWorkflowAssignUrl,
} from "../../utils/apiweaveClient";

export function Sidebar() {
  const selectedNav = useNavigationStore((s) => s.selectedNavVal);
  const setNavState = useNavigationStore((s) => s.setNavState);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [showCollectionManager, setShowCollectionManager] = useState(false);
  const [exportingWorkflowId, setExportingWorkflowId] = useState<string | null>(
    null,
  );
  const [exportingWorkflowName, setExportingWorkflowName] = useState<
    string | null
  >(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(),
  );
  const [exportingCollectionId, setExportingCollectionId] = useState<
    string | null
  >(null);
  const [exportingCollectionName, setExportingCollectionName] = useState<
    string | null
  >(null);
  const [showNewWorkflowPrompt, setShowNewWorkflowPrompt] = useState(false);
  const [addWorkflowToProjectTarget, setAddWorkflowToProjectTarget] = useState<
    string | null
  >(null);
  const [deleteWorkflowTarget, setDeleteWorkflowTarget] = useState<{
    workflowId: string;
    name: string;
  } | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<{
    projectId: string;
    name: string;
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const handleScrollRef = useRef<() => void>(() => {});

  const workflows = useSidebarStore((s) => s.workflows);
  const allWorkflows = useSidebarStore((s) => s.allWorkflows);
  const projects = useSidebarStore((s) => s.projects);
  const collections = useSidebarStore((s) => s.collections);
  const environments = useEnvironmentStore((s) => s.environments);
  const pagination = useSidebarStore((s) => s.pagination);
  const isLoadingMore = useSidebarStore((s) => s.isLoadingMore);
  const isRefreshing = useSidebarStore((s) => s.isRefreshing);
  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const closeTab = useTabStore((s) => s.closeTab);
  const fetchWorkflows = useSidebarStore((s) => s.fetchWorkflows);
  const workflowVersion = useSidebarStore((s) => s.workflowVersion);
  const projectVersion = useSidebarStore((s) => s.projectVersion);
  const refreshAll = useSidebarStore((s) => s.refreshAll);
  const setIsLoadingMore = useSidebarStore((s) => s.setIsLoadingMore);
  const setActiveWorkspaceId = useSidebarStore((s) => s.setActiveWorkspaceId);
  const navigate = useNavigate();

  // Workspace context — scope sidebar data to the active workspace
  const { workspaceId, isReady: isScopeReady } = useScopeContext();

  // Sync workspace ID to the sidebar store so fetches are workspace-scoped
  useEffect(() => {
    setActiveWorkspaceId(isScopeReady ? workspaceId : null);
  }, [isScopeReady, setActiveWorkspaceId, workspaceId]);

  useEffect(() => {
    if (!isScopeReady || !workspaceId) return;
    void useEnvironmentStore.getState().fetchEnvironments(workspaceId);
  }, [isScopeReady, workspaceId]);

  // Refresh the CURRENT tab when a mutation signals a change. Routing through
  // refreshAll(nav) means the projects tab refetches projects + all workflows
  // (incl. project-attached), so newly added/assigned workflows show up. Read
  // the nav fresh so these don't re-run merely on tab switch.
  useEffect(() => {
    if (workflowVersion > 0) {
      void refreshAll(useNavigationStore.getState().selectedNavVal);
    }
  }, [workflowVersion, refreshAll]);

  useEffect(() => {
    if (projectVersion > 0) {
      void refreshAll(useNavigationStore.getState().selectedNavVal);
    }
  }, [projectVersion, refreshAll]);

  // Auto-refresh when the user returns to the tab/window after it was hidden
  // or unfocused — data may have changed elsewhere while they were away.
  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      void refreshAll(useNavigationStore.getState().selectedNavVal);
      const wsId = useSidebarStore.getState().activeWorkspaceId;
      if (wsId) void useEnvironmentStore.getState().fetchEnvironments(wsId);
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [refreshAll]);

  handleScrollRef.current = () => {
    if (scrollContainerRef.current && selectedNav === "workflows") {
      const { scrollTop, scrollHeight, clientHeight } =
        scrollContainerRef.current;
      if (
        scrollHeight - scrollTop <= clientHeight + 100 &&
        !isLoadingMore &&
        pagination.hasMore
      ) {
        setIsLoadingMore(true);
        void fetchWorkflows(pagination.skip + pagination.limit, true);
      }
    }
  };

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer && selectedNav === "workflows") {
      const onScroll = () => handleScrollRef.current();
      scrollContainer.addEventListener("scroll", onScroll, { passive: true });
      return () => scrollContainer.removeEventListener("scroll", onScroll);
    }
  }, [selectedNav]);

  const createNewWorkflow = () => {
    setShowNewWorkflowPrompt(true);
  };

  const handleCreateWorkflow = async (name: string) => {
    if (!isScopeReady || !workspaceId) {
      toast.error(
        "Workspace context is still loading. Please retry once a workspace is selected.",
      );
      return;
    }

    try {
      const response = await authenticatedFetch(workflowsUrl(workspaceId), {
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
      });

      if (response.ok) {
        const workflow = (await response.json()) as Workflow;
        void refreshAll(selectedNav);
        useTabStore.getState().openTab(workflow);
      }
    } catch (error) {
      console.error("Error creating workflow:", error);
    }
  };

  const handleCreateWorkflowInProject = async (name: string) => {
    if (!isScopeReady || !workspaceId || !addWorkflowToProjectTarget) {
      toast.error("Workspace or project context is not ready.");
      return;
    }

    try {
      const response = await authenticatedFetch(
        workflowsCreateInProjectUrl(workspaceId, addWorkflowToProjectTarget),
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
        void refreshAll("projects");
        useTabStore.getState().openTab(workflow);
        toast.success(`Workflow "${name}" created and added to project`);
      } else {
        const errBody = (await response.json()) as { detail?: string };
        toast.error(errBody.detail ?? "Failed to create workflow in project");
      }
    } catch (error) {
      console.error("Error creating workflow in project:", error);
      toast.error("Failed to create workflow in project");
    } finally {
      setAddWorkflowToProjectTarget(null);
    }
  };

  const handleAssignWorkflowToProject = async (
    projectId: string,
    workflowId: string,
  ) => {
    if (!isScopeReady || !workspaceId) {
      toast.error(
        "Workspace context is still loading. Please retry once a workspace is selected.",
      );
      return;
    }

    try {
      const response = await authenticatedFetch(
        projectWorkflowAssignUrl(workspaceId, projectId, workflowId),
        { method: "POST" },
      );

      if (response.ok) {
        toast.success("Workflow assigned to project");
        void refreshAll("projects");
      } else {
        const errBody = (await response.json()) as { detail?: string };
        toast.error(errBody.detail ?? "Failed to assign workflow to project");
      }
    } catch (error) {
      console.error("Error assigning workflow to project:", error);
      toast.error("Failed to assign workflow to project");
    }
  };

  const handleWorkflowClick = async (workflow: Workflow) => {
    if (!isScopeReady || !workspaceId) {
      toast.error("Select a workspace before opening workflows.");
      return;
    }

    setSelectedWorkflowId(workflow.workflowId);

    try {
      const response = await authenticatedFetch(
        workflowUrl(workspaceId, workflow.workflowId),
      );
      if (response.ok) {
        const fullWorkflow: Workflow = await response.json();
        if (selectedNav === "settings") {
          setNavState("workflows");
          navigate("/");
        }
        useTabStore.getState().openTab(fullWorkflow);
        return;
      }
      toast.error(
        `Unable to open workflow (${response.status}). Please retry.`,
      );
      console.error(
        `Failed to fetch full workflow payload (${response.status})`,
      );
    } catch (error) {
      toast.error("Unable to open workflow. Check your connection and retry.");
      console.error("Error fetching full workflow payload:", error);
    }
  };

  const handleExportWorkflow = (workflow: Workflow) => {
    setExportingWorkflowId(workflow.workflowId);
    setExportingWorkflowName(workflow.name);
  };

  const handleExportProject = (project: Project) => {
    setExportingCollectionId(project.projectId ?? project.collectionId);
    setExportingCollectionName(project.name);
  };

  const handleCreateNew = () => {
    if (selectedNav === "workflows") {
      createNewWorkflow();
    } else if (selectedNav === "projects") {
      setShowCollectionManager(true);
    }
  };

  const handleDeleteWorkflow = async () => {
    if (!isScopeReady || !workspaceId) {
      toast.error("Select a workspace before deleting workflows.");
      setDeleteWorkflowTarget(null);
      return;
    }

    try {
      const result = await requestWorkflowDeletion({
        target: deleteWorkflowTarget,
        apiBaseUrl: API_BASE_URL,
        workspaceId,
        fetchImpl: authenticatedFetch,
      });

      if (!result.deleted) return;

      const workflowId = result.workflowId;
      if (!workflowId) return;

      toast.success("Workflow deleted permanently");
      setSelectedWorkflowId((prev) => (prev === workflowId ? null : prev));
      closeTab(workflowId);
      await refreshAll(selectedNav);
    } catch (error) {
      console.error("Error deleting workflow:", error);
      toast.error((error as Error).message || "Error deleting workflow");
    } finally {
      setDeleteWorkflowTarget(null);
    }
  };

  const handleDeleteProject = async () => {
    if (!isScopeReady || !workspaceId) {
      toast.error("Select a workspace before deleting projects.");
      setDeleteProjectTarget(null);
      return;
    }

    try {
      const result = await requestProjectDeletion({
        target: deleteProjectTarget,
        apiBaseUrl: API_BASE_URL,
        workspaceId,
        fetchImpl: authenticatedFetch,
      });

      if (!result.deleted) return;

      const projectId = result.projectId;
      if (!projectId) return;

      toast.success("Project deleted permanently");
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      await refreshAll(selectedNav);
    } catch (error) {
      console.error("Error deleting project:", error);
      toast.error((error as Error).message || "Error deleting project");
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
      <aside
        className="flex h-full w-full flex-col bg-surface-raised text-text-primary dark:bg-surface-dark-raised dark:text-text-primary-dark"
        aria-label="Sidebar"
      >
        <SidebarHeader
          selectedNav={selectedNav}
          onCreateNew={handleCreateNew}
          isRefreshing={isRefreshing}
        />

        <div className="flex-1 overflow-hidden">
          <div
            className={`h-full flex flex-col ${
              selectedNav === "workflows" ? "" : "hidden"
            }`}
          >
            <div
              ref={scrollContainerRef}
                className={[
                  "flex-1 overflow-y-auto overflow-x-hidden transition-opacity duration-300",
                  isRefreshing ? "opacity-50" : "opacity-100",
                ].join(" ")}
                style={{ scrollbarGutter: "stable" }}
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
                  onDeleteWorkflow={(workflowId: string, name: string) =>
                    setDeleteWorkflowTarget({ workflowId, name })
                  }
                  onCreateWorkflow={createNewWorkflow}
                  onLoadMore={handleLoadMore}
                />
              </div>
            </div>
          <div
            className={[
              "h-full overflow-y-auto overflow-x-hidden p-2 transition-opacity duration-300 motion-reduce:transition-none",
              isRefreshing ? "opacity-50" : "opacity-100",
              selectedNav === "projects" ? "" : "hidden",
            ].join(" ")}
          >
              <ProjectList
                projects={filteredProjects}
                workflows={allWorkflows}
                environments={environments}
                selectedWorkflowId={selectedWorkflowId}
                isRefreshing={isRefreshing}
                searchQuery={searchQuery}
                expandedProjects={expandedProjects}
                onToggleProject={toggleProject}
                onWorkflowClick={handleWorkflowClick}
                onExportWorkflow={handleExportWorkflow}
                onDeleteWorkflow={(workflowId: string, name: string) =>
                  setDeleteWorkflowTarget({ workflowId, name })
                }
                onExportProject={handleExportProject}
                onDeleteProject={(projectId: string, name: string) =>
                  setDeleteProjectTarget({ projectId, name })
                }
                onCreateProject={() => setShowCollectionManager(true)}
                onAddWorkflowToProject={(projectId: string) => {
                  setAddWorkflowToProjectTarget(projectId);
                }}
                onAssignWorkflowToProject={handleAssignWorkflowToProject}
              />
            </div>
          {selectedNav === "webhooks" && <WebhookManager />}
          {selectedNav === "mcp" && <MCPManager className="h-full" />}
          {selectedNav === "settings" && (
            <SettingsContent
              onNavigate={(path: string) => navigate(path)}
              onSwitchNav={(section) => setNavState(section)}
            />
          )}
        </div>
      </aside>

      {showCollectionManager && (
        <CollectionManager
          open={true}
          onClose={() => setShowCollectionManager(false)}
        />
      )}

      {exportingWorkflowId && (
        <WorkflowExportImport
          workflowId={exportingWorkflowId}
          {...(exportingWorkflowName && {
            workflowName: exportingWorkflowName,
          })}
          initialTab="export"
          onClose={() => {
            setExportingWorkflowId(null);
            setExportingWorkflowName(null);
          }}
        />
      )}

      {exportingCollectionId && (
        <CollectionExportImport
          projectId={exportingCollectionId}
          {...(exportingCollectionName && {
            projectName: exportingCollectionName,
          })}
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
            Permanently delete workflow{" "}
            <strong className="text-text-primary dark:text-text-primary-dark">
              &quot;{deleteWorkflowTarget?.name ?? "Untitled workflow"}&quot;
            </strong>
            ? This removes its graph and run history links from this workspace
            and cannot be undone.
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
            Permanently delete project{" "}
            <strong className="text-text-primary dark:text-text-primary-dark">
              &quot;{deleteProjectTarget?.name ?? "Untitled project"}&quot;
            </strong>
            ? Workflows will stay in your workspace but lose this project
            assignment. This cannot be undone.
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

      <PromptDialog
        open={!!addWorkflowToProjectTarget}
        onClose={() => setAddWorkflowToProjectTarget(null)}
        onSubmit={handleCreateWorkflowInProject}
        title="New Workflow in Project"
        message="Enter a name for the new workflow. It will be automatically assigned to this project."
        placeholder="My Workflow"
        submitLabel="Create & Assign"
      />
    </>
  );
}
