import {
  useState,
  useEffect,
  useCallback,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { toast } from "sonner";
import {
  Trash2,
  Plus,
  X,
  GripVertical,
  Eye,
  EyeOff,
  ArrowLeft,
  Pencil,
  ListOrdered,
} from "lucide-react";
import { Modal } from "./molecules/Modal";
import { ConfirmDialog } from "./molecules/ConfirmDialog";
import { PromptDialog } from "./molecules/PromptDialog";
import { Button } from "./atoms/Button";
import { IconButton } from "./atoms/IconButton";
import { Input } from "./atoms/Input";
import { TextArea } from "./atoms/TextArea";
import { Toggle } from "./atoms/Toggle";
import useSidebarStore from "../stores/SidebarStore";
import {
  DefaultCollectionColor,
  PresetCollectionColors,
} from "../constants/CollectionColors";
import { useScopeContext } from "../hooks/useScopeContext";
import {
  projectsUrl,
  workflowsUrl,
  workflowsCreateInProjectUrl,
} from "../utils/scopedApi";
import type { Project } from "../types/Project";
import type { Workflow } from "../types/Workflow";
import { authenticatedFetch } from "../utils/authenticatedApi";

interface ExtendedProject extends Project {
  color?: string;
  workflowOrder?: Array<{
    workflowId: string;
    order: number;
    enabled: boolean;
    continueOnFail: boolean;
  }>;
  continueOnFail?: boolean;
  workflowCount: number;
}

interface ProjectListResponse {
  projects: ExtendedProject[];
  total: number;
}

interface WorkflowOrderItem {
  workflowId: string;
  order: number;
  enabled: boolean;
  continueOnFail: boolean;
  workflow: Workflow | undefined;
}

interface ProjectFormData {
  name: string;
  description: string;
  color: string;
}

interface ProjectManagerState {
  projects: ExtendedProject[];
  workflows: Workflow[];
  selectedProject: ExtendedProject | null;
  isEditing: boolean;
  isManagingWorkflows: boolean;
  workflowOrder: WorkflowOrderItem[];
  draggedIndex: number | null;
  continueOnFail: boolean;
  formData: ProjectFormData;
  error: string;
  deleteTarget: string | null;
}

const createInitialState = (): ProjectManagerState => ({
  projects: [],
  workflows: [],
  selectedProject: null,
  isEditing: false,
  isManagingWorkflows: false,
  workflowOrder: [],
  draggedIndex: null,
  continueOnFail: true,
  formData: { name: "", description: "", color: DefaultCollectionColor },
  error: "",
  deleteTarget: null,
});

interface ProjectManagerProps {
  open: boolean;
  onClose: () => void;
}

export function CollectionManager({ open, onClose }: ProjectManagerProps) {
  const [state, setState] = useState<ProjectManagerState>(() =>
    createInitialState(),
  );
  const [showCreateWorkflowPrompt, setShowCreateWorkflowPrompt] =
    useState(false);
  const { workspaceId, isReady } = useScopeContext();

  const {
    projects,
    workflows,
    selectedProject,
    isEditing,
    isManagingWorkflows,
    workflowOrder,
    draggedIndex,
    continueOnFail,
    formData,
    error,
    deleteTarget,
  } = state;

  const getProjectId = useCallback(
    (project: ExtendedProject): string =>
      project.projectId ?? project.collectionId,
    [],
  );

  const fetchWorkflows = useCallback(async (): Promise<Workflow[]> => {
    if (!isReady || !workspaceId) {
      return [];
    }
    try {
      const response = await authenticatedFetch(
        workflowsUrl(workspaceId, { skip: 0, limit: 100 }),
      );
      if (response.ok) {
        const data: unknown = await response.json();
        const workflowArray: Workflow[] = Array.isArray(data)
          ? data
          : (data as { workflows: Workflow[] }).workflows || [];
        return workflowArray;
      }
    } catch (err: unknown) {
      console.error("Error fetching workflows:", err);
    }
    return [];
  }, [isReady, workspaceId]);

  const fetchProjects = useCallback(async (): Promise<ExtendedProject[]> => {
    if (!isReady || !workspaceId) {
      return [];
    }
    try {
      const response = await authenticatedFetch(projectsUrl(workspaceId));
      if (response.ok) {
        const data: ProjectListResponse = await response.json();
        return data.projects;
      }
    } catch (err: unknown) {
      console.error("Error fetching projects:", err);
    }
    return [];
  }, [isReady, workspaceId]);

  useEffect(() => {
    if (!isReady || !workspaceId) return;
    (async () => {
      const [nextProjects, nextWorkflows] = await Promise.all([
        fetchProjects(),
        fetchWorkflows(),
      ]);
      setState((prev) => ({
        ...prev,
        projects: nextProjects,
        workflows: nextWorkflows,
      }));
    })();
  }, [fetchProjects, fetchWorkflows, isReady, workspaceId]);

  const resetEditingState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isEditing: false,
      selectedProject: null,
      error: "",
    }));
  }, []);

  const resetManageState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isManagingWorkflows: false,
      selectedProject: null,
      workflowOrder: [],
    }));
  }, []);

  const updateFormData = useCallback((patch: Partial<ProjectFormData>) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, ...patch },
    }));
  }, []);

  const handleCreate = () => {
    setState((prev) => ({
      ...prev,
      isEditing: true,
      selectedProject: null,
      formData: { name: "", description: "", color: DefaultCollectionColor },
      error: "",
    }));
  };

  const handleEdit = (project: ExtendedProject) => {
    setState((prev) => ({
      ...prev,
      isEditing: true,
      selectedProject: project,
      formData: {
        name: project.name,
        description: project.description || "",
        color: project.color || DefaultCollectionColor,
      },
      error: "",
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setState((prev) => ({ ...prev, error: "Project name is required" }));
      return;
    }
    if (!workspaceId) {
      setState((prev) => ({ ...prev, error: "Workspace scope is not ready" }));
      return;
    }
    try {
      const url = selectedProject
        ? projectsUrl(workspaceId, getProjectId(selectedProject))
        : projectsUrl(workspaceId);
      const method = selectedProject ? "PATCH" : "POST";

      const response = await authenticatedFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast.success(selectedProject ? "Project updated" : "Project created");
        const nextProjects = await fetchProjects();
        setState((prev) => ({
          ...prev,
          projects: nextProjects,
          isEditing: false,
          selectedProject: null,
          error: "",
        }));
        useSidebarStore.getState().signalProjectsRefresh();
      } else {
        const errorData: { detail?: string } = await response.json();
        setState((prev) => ({
          ...prev,
          error: errorData.detail || "Failed to save project",
        }));
      }
    } catch (err: unknown) {
      console.error("Error saving project:", err);
      setState((prev) => ({ ...prev, error: "Error saving project" }));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    if (!workspaceId) {
      toast.error("Workspace scope is not ready");
      return;
    }
    try {
      const response = await authenticatedFetch(
        projectsUrl(workspaceId, deleteTarget),
        {
          method: "DELETE",
        },
      );
      if (response.ok) {
        toast.success("Project deleted");
        const nextProjects = await fetchProjects();
        if (selectedProject && getProjectId(selectedProject) === deleteTarget) {
          setState((prev) => ({
            ...prev,
            selectedProject: null,
            isEditing: false,
          }));
        }
        setState((prev) => ({ ...prev, projects: nextProjects }));
        useSidebarStore.getState().signalProjectsRefresh();
      } else {
        const errorData: { detail?: string } = await response.json();
        toast.error(errorData.detail || "Failed to delete project");
      }
    } catch (err: unknown) {
      console.error("Error deleting project:", err);
      toast.error("Error deleting project");
    } finally {
      setState((prev) => ({ ...prev, deleteTarget: null }));
    }
  };

  const handleCancel = () => {
    resetEditingState();
  };

  const handleManageWorkflows = (project: ExtendedProject) => {
    const projectId = getProjectId(project);
    setState((prev) => ({
      ...prev,
      selectedProject: project,
      isManagingWorkflows: true,
      continueOnFail:
        project.continueOnFail !== undefined ? project.continueOnFail : true,
    }));
    const projectWorkflows = workflows.filter(
      (w) => w.collectionId === projectId,
    );
    if (project.workflowOrder && project.workflowOrder.length > 0) {
      const sorted = project.workflowOrder.toSorted(
        (a: { order?: number }, b: { order?: number }) =>
          (a.order ?? 0) - (b.order ?? 0),
      );
      const orderedWorkflows: WorkflowOrderItem[] = sorted
        .map(
          (wo: {
            workflowId: string;
            order?: number;
            enabled?: boolean;
            continueOnFail?: boolean;
          }) => ({
            workflowId: wo.workflowId,
            order: wo.order ?? 0,
            enabled: wo.enabled ?? true,
            continueOnFail: wo.continueOnFail ?? true,
            workflow: projectWorkflows.find(
              (w) => w.workflowId === wo.workflowId,
            ),
          }),
        )
        .filter((wo: WorkflowOrderItem) => wo.workflow !== undefined);
      setState((prev) => ({ ...prev, workflowOrder: orderedWorkflows }));
    } else {
      setState((prev) => ({
        ...prev,
        workflowOrder: projectWorkflows.map((workflow, index) => ({
          workflowId: workflow.workflowId,
          order: index,
          enabled: true,
          continueOnFail: true,
          workflow,
        })),
      }));
    }
  };

  const handleBackFromWorkflows = () => {
    resetManageState();
  };

  const handleSaveWorkflowOrder = async () => {
    if (!selectedProject || !workspaceId) return;
    try {
      const orderData = workflowOrder.map((wo, index) => ({
        workflowId: wo.workflowId,
        order: index,
        enabled: wo.enabled,
        continueOnFail: wo.continueOnFail,
      }));
      const response = await authenticatedFetch(
        projectsUrl(workspaceId, getProjectId(selectedProject)),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowOrder: orderData, continueOnFail }),
        },
      );
      if (response.ok) {
        toast.success("Workflow order saved");
        const nextProjects = await fetchProjects();
        setState((prev) => ({
          ...prev,
          projects: nextProjects,
          isManagingWorkflows: false,
          selectedProject: null,
          workflowOrder: [],
        }));
        useSidebarStore.getState().signalProjectsRefresh();
      } else {
        const errorData: { detail?: string } = await response.json();
        toast.error(errorData.detail || "Failed to save workflow order");
      }
    } catch (err: unknown) {
      console.error("Error saving workflow order:", err);
      toast.error("Error saving workflow order");
    }
  };

  const handleDragStart = (index: number) =>
    setState((prev) => ({ ...prev, draggedIndex: index }));
  const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newOrder = [...workflowOrder];
    const draggedItem = newOrder[draggedIndex]!;
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);
    setState((prev) => ({
      ...prev,
      workflowOrder: newOrder,
      draggedIndex: index,
    }));
  };
  const handleDragEnd = () =>
    setState((prev) => ({ ...prev, draggedIndex: null }));

  const toggleWorkflowEnabled = (i: number) => {
    const n = [...workflowOrder];
    const item = n[i]!;
    n[i] = {
      workflowId: item.workflowId,
      order: item.order,
      enabled: !item.enabled,
      continueOnFail: item.continueOnFail,
      workflow: item.workflow,
    };
    setState((prev) => ({ ...prev, workflowOrder: n }));
  };

  const toggleWorkflowContinueOnFail = (i: number) => {
    const n = [...workflowOrder];
    const item = n[i]!;
    n[i] = {
      workflowId: item.workflowId,
      order: item.order,
      enabled: item.enabled,
      continueOnFail: !item.continueOnFail,
      workflow: item.workflow,
    };
    setState((prev) => ({ ...prev, workflowOrder: n }));
  };

  const removeWorkflowFromOrder = (i: number) => {
    const n = [...workflowOrder];
    n.splice(i, 1);
    setState((prev) => ({ ...prev, workflowOrder: n }));
  };

  const addWorkflowToOrder = (workflowId: string) => {
    const workflow = workflows.find((w) => w.workflowId === workflowId);
    if (!workflow) return;
    setState((prev) => ({
      ...prev,
      workflowOrder: [
        ...workflowOrder,
        {
          workflowId: workflow.workflowId,
          order: workflowOrder.length,
          enabled: true,
          continueOnFail: true,
          workflow,
        },
      ],
    }));
  };

  const handleSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "__new__") {
      setShowCreateWorkflowPrompt(true);
      e.target.value = "";
      return;
    }
    if (value) {
      addWorkflowToOrder(value);
      e.target.value = "";
    }
  };

  const handleCreateNewWorkflowInProject = async (
    name: string,
  ): Promise<void> => {
    if (!workspaceId || !selectedProject) return;
    const projectId = getProjectId(selectedProject);
    try {
      const response = await authenticatedFetch(
        workflowsCreateInProjectUrl(workspaceId, projectId),
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
        addWorkflowToOrder(workflow.workflowId);
        useSidebarStore.getState().signalWorkflowsRefresh();
        toast.success(`Workflow "${name}" created and added to project`);
      } else {
        const errBody = (await response.json()) as { detail?: string };
        toast.error(errBody.detail ?? "Failed to create workflow");
      }
    } catch {
      toast.error("Failed to create workflow in project");
    } finally {
      setShowCreateWorkflowPrompt(false);
    }
  };

  const availableWorkflows = workflows.filter(
    (w) =>
      w.collectionId !==
        (selectedProject ? getProjectId(selectedProject) : undefined) &&
      !workflowOrder.some((wo) => wo.workflowId === w.workflowId),
  );

  const modalTitle = isManagingWorkflows
    ? `Manage Workflows: ${selectedProject?.name}`
    : isEditing
      ? selectedProject
        ? "Edit Project"
        : "Create Project"
      : "Projects";

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title={modalTitle} size="lg">
        <div className="p-5 overflow-auto" style={{ maxHeight: "70vh" }}>
          {isManagingWorkflows ? (
            <div className="space-y-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackFromWorkflows}
                className="flex items-center gap-1 text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark"
              >
                <ArrowLeft className="w-4 h-4" /> Back to projects
              </Button>

              <div className="p-3 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded">
                <div className="flex items-center gap-2 cursor-pointer">
                  <Toggle
                    checked={continueOnFail}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        continueOnFail: e.target.checked,
                      }))
                    }
                    variant="primary"
                    size="sm"
                  />
                  <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                    Continue on Failure (Project-wide)
                  </span>
                </div>
                <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">
                  When enabled, execution continues even if a workflow fails
                </p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark mb-2">
                  Execution Order (drag to reorder)
                </h3>
                {workflowOrder.length === 0 ? (
                  <div className="text-center py-8 text-text-muted dark:text-text-muted-dark text-sm">
                    No workflows in this project yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workflowOrder.map((wo, index) => (
                      <div
                        key={wo.workflowId}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-2 p-3 border rounded transition-all ${
                          draggedIndex === index
                            ? "border-primary bg-primary/5 opacity-50"
                            : "border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised"
                        } ${!wo.enabled ? "opacity-60" : ""}`}
                      >
                        <div className="cursor-grab active:cursor-grabbing text-text-muted dark:text-text-muted-dark">
                          <GripVertical className="w-5 h-5" />
                        </div>
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-text-primary dark:text-text-primary-dark truncate">
                            {wo.workflow?.name || wo.workflowId}
                          </div>
                          <div className="text-xs text-text-muted dark:text-text-muted-dark">
                            {wo.workflow?.nodes?.length || 0} nodes
                          </div>
                        </div>
                        <IconButton
                          variant="ghost"
                          size="xs"
                          onClick={() => toggleWorkflowEnabled(index)}
                          className={
                            wo.enabled
                              ? "text-status-success hover:bg-status-success/10"
                              : "text-text-muted hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay"
                          }
                          tooltip={wo.enabled ? "Enabled" : "Disabled"}
                        >
                          {wo.enabled ? (
                            <Eye className="w-4 h-4" />
                          ) : (
                            <EyeOff className="w-4 h-4" />
                          )}
                        </IconButton>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => toggleWorkflowContinueOnFail(index)}
                          className={
                            wo.continueOnFail
                              ? "bg-primary/10 text-primary"
                              : "bg-status-error/10 text-status-error"
                          }
                          title={
                            wo.continueOnFail
                              ? "Continue on fail"
                              : "Stop on fail"
                          }
                        >
                          {wo.continueOnFail ? "Continue" : "Stop"}
                        </Button>
                        <IconButton
                          variant="ghost"
                          size="xs"
                          onClick={() => removeWorkflowFromOrder(index)}
                          className="text-status-error hover:bg-status-error/10"
                          tooltip="Remove"
                        >
                          <X className="w-4 h-4" />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(availableWorkflows.length > 0 || selectedProject) && (
                <div>
                  <h3 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark mb-2">
                    Add More Workflows
                  </h3>
                  <select
                    onChange={handleSelectChange}
                    className="w-full rounded border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select a workflow to add…</option>
                    <option value="__new__">+ Create New Workflow</option>
                    {availableWorkflows.map((w) => (
                      <option key={w.workflowId} value={w.workflowId}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-4 border-t border-border dark:border-border-dark">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBackFromWorkflows}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveWorkflowOrder}
                >
                  Save Order
                </Button>
              </div>
            </div>
          ) : isEditing ? (
            <div className="space-y-4">
              {error && (
                <div className="p-3 bg-status-error/5 border border-status-error/20 rounded text-sm text-status-error">
                  {error}
                </div>
              )}
              <div>
                <label
                  htmlFor="project-name"
                  className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1"
                >
                  Project Name *
                </label>
                <Input
                  id="project-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => updateFormData({ name: e.target.value })}
                  size="sm"
                  className="w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                  placeholder="e.g., Staging Tests"
                />
              </div>
              <div>
                <label
                  htmlFor="project-description"
                  className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1"
                >
                  Description
                </label>
                <TextArea
                  id="project-description"
                  value={formData.description}
                  onChange={(e) =>
                    updateFormData({ description: e.target.value })
                  }
                  size="sm"
                  className="w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark resize-none"
                  placeholder="Optional description..."
                  rows={3}
                />
              </div>
              <div>
                <div className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                  Project Color
                </div>
                <div className="flex gap-2 flex-wrap">
                  {PresetCollectionColors.map((color) => (
                    <button
                      type="button"
                      key={color}
                      onClick={() => updateFormData({ color })}
                      className={`w-8 h-8 rounded-full border-2 transition-all p-0 ${formData.color === color ? "border-text-primary dark:border-text-primary-dark scale-110" : "border-border dark:border-border-dark"}`}
                      style={{ backgroundColor: color }}
                      title={color}
                      aria-label={`Select color ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-4">
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={handleSave}>
                  {selectedProject ? "Update" : "Create"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.length === 0 ? (
                <div className="text-center py-8 text-text-muted dark:text-text-muted-dark">
                  <p>No projects yet</p>
                  <p className="text-sm mt-2">
                    Create one to organize your workflows
                  </p>
                </div>
              ) : (
                projects.map((project) => (
                  <div
                    key={getProjectId(project)}
                    className="p-3 border border-border dark:border-border-dark rounded hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {project.color && (
                          <div
                            className="w-4 h-4 rounded-full flex-shrink-0"
                            style={{ backgroundColor: project.color }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-text-primary dark:text-text-primary-dark truncate">
                            {project.name}
                          </div>
                          {project.description && (
                            <div className="text-xs text-text-secondary dark:text-text-secondary-dark truncate">
                              {project.description}
                            </div>
                          )}
                          <div className="text-xs text-text-muted dark:text-text-muted-dark mt-1">
                            {project.workflowCount} workflow
                            {project.workflowCount !== 1 ? "s" : ""}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleManageWorkflows(project)}
                          title="Manage workflow order"
                        >
                          <ListOrdered className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleEdit(project)}
                          title="Edit project"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <IconButton
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              deleteTarget: getProjectId(project),
                            }))
                          }
                          className="text-status-error hover:bg-status-error/10"
                          tooltip="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                ))
              )}

              <div className="pt-4 border-t border-border dark:border-border-dark">
                <Button variant="primary" size="sm" onClick={handleCreate}>
                  <Plus className="w-4 h-4 mr-1" /> New Project
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setState((prev) => ({ ...prev, deleteTarget: null }))}
        onConfirm={handleDeleteConfirm}
        title="Delete Project"
        message="Are you sure you want to delete this project? All workflows will be unassigned. This action cannot be undone."
        confirmLabel="Delete"
        intent="error"
      />

      <PromptDialog
        open={showCreateWorkflowPrompt}
        onClose={() => setShowCreateWorkflowPrompt(false)}
        onSubmit={handleCreateNewWorkflowInProject}
        title="New Workflow in Project"
        message="Enter a name for the new workflow. It will be created and added to this project."
        placeholder="My Workflow"
        submitLabel="Create & Add"
      />
    </>
  );
}

export default CollectionManager;
