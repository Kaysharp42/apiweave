import {
  Building2,
  Download,
  FolderInput,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  ContextMenuItem,
  Project,
  ProjectItemProps,
  Workflow,
  WorkflowItemProps,
} from "../../../types";

/**
 * The right-click actions for the two sidebar row types.
 *
 * Built here rather than inline in the JSX: an array of five action objects is
 * most of a row component's body by volume while being none of its rendering,
 * and both rows are otherwise plain enough to read at a glance.
 *
 * Rename and the two moves lead because they are the actions that need
 * something typed or picked, which is exactly what a hover button cannot offer.
 * Export repeats the hover button so a user who has found the menu need not
 * leave it to finish. Delete is menu-only: the one-click hover strip keeps to
 * non-destructive actions, so the destructive one is separated at the end and
 * reached deliberately.
 */

type WorkflowActions = Pick<
  WorkflowItemProps,
  | "onRenameWorkflow"
  | "onMoveWorkflowToProject"
  | "onMoveWorkflowToWorkspace"
  | "onExportWorkflow"
  | "onDeleteWorkflow"
>;

type ProjectActions = Pick<
  ProjectItemProps,
  | "onRenameProject"
  | "onMoveProjectToWorkspace"
  | "onAddWorkflowToProject"
  | "onExportProject"
  | "onDeleteProject"
>;

export function workflowRowMenuItems(
  workflow: Workflow,
  actions: WorkflowActions,
): ContextMenuItem[] {
  return [
    {
      key: "rename",
      icon: Pencil,
      label: "Rename…",
      onSelect: () => actions.onRenameWorkflow(workflow),
    },
    {
      key: "move-project",
      icon: FolderInput,
      label: "Move to project…",
      onSelect: () => actions.onMoveWorkflowToProject(workflow),
    },
    {
      key: "move-workspace",
      icon: Building2,
      label: "Move to workspace…",
      onSelect: () => actions.onMoveWorkflowToWorkspace(workflow),
    },
    {
      key: "export",
      icon: Download,
      label: "Export…",
      separated: true,
      onSelect: () => actions.onExportWorkflow(workflow),
    },
    {
      key: "delete",
      icon: Trash2,
      label: "Delete workflow…",
      separated: true,
      destructive: true,
      onSelect: () => actions.onDeleteWorkflow(workflow.workflowId, workflow.name),
    },
  ];
}

export function projectRowMenuItems(
  project: Project,
  projectId: string,
  actions: ProjectActions,
): ContextMenuItem[] {
  return [
    {
      key: "rename",
      icon: Pencil,
      label: "Rename…",
      onSelect: () => actions.onRenameProject(project),
    },
    {
      key: "move-workspace",
      icon: Building2,
      label: "Move to workspace…",
      onSelect: () => actions.onMoveProjectToWorkspace(project),
    },
    {
      key: "add-workflow",
      icon: Plus,
      label: "Add workflow…",
      separated: true,
      onSelect: () => actions.onAddWorkflowToProject(projectId),
    },
    {
      key: "export",
      icon: Download,
      label: "Export…",
      onSelect: () => actions.onExportProject(project),
    },
    {
      key: "delete",
      icon: Trash2,
      label: "Delete project…",
      separated: true,
      destructive: true,
      onSelect: () => actions.onDeleteProject(projectId, project.name),
    },
  ];
}
