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
 * Export and delete repeat the hover buttons on purpose — a user who has found
 * the menu should not have to leave it again to finish.
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
      label: "Delete",
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
      label: "Delete",
      destructive: true,
      onSelect: () => actions.onDeleteProject(projectId, project.name),
    },
  ];
}
