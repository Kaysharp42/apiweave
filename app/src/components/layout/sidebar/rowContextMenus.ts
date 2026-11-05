import {
  Building2,
  Download,
  FolderInput,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type React from "react";
import type {
  ContextMenuItem,
  ContextMenuOrigin,
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

function renameItem(onSelect: () => void): ContextMenuItem {
  return { key: "rename", icon: Pencil, label: "Rename…", onSelect };
}

function moveToWorkspaceItem(onSelect: () => void): ContextMenuItem {
  return {
    key: "move-workspace",
    icon: Building2,
    label: "Move to workspace…",
    onSelect,
  };
}

function exportItem(
  onSelect: () => void,
  separated: boolean,
): ContextMenuItem {
  return { key: "export", icon: Download, label: "Export…", separated, onSelect };
}

/** Delete is menu-only and always separated at the end: never one click from the row. */
function deleteItem(label: string, onSelect: () => void): ContextMenuItem {
  return {
    key: "delete",
    icon: Trash2,
    label,
    separated: true,
    destructive: true,
    onSelect,
  };
}

export function workflowRowMenuItems(
  workflow: Workflow,
  actions: WorkflowActions,
): ContextMenuItem[] {
  return [
    renameItem(() => actions.onRenameWorkflow(workflow)),
    {
      key: "move-project",
      icon: FolderInput,
      label: "Move to project…",
      onSelect: () => actions.onMoveWorkflowToProject(workflow),
    },
    moveToWorkspaceItem(() => actions.onMoveWorkflowToWorkspace(workflow)),
    exportItem(() => actions.onExportWorkflow(workflow), true),
    deleteItem("Delete workflow…", () =>
      actions.onDeleteWorkflow(workflow.workflowId, workflow.name),
    ),
  ];
}

export function projectRowMenuItems(
  project: Project,
  projectId: string,
  actions: ProjectActions,
): ContextMenuItem[] {
  return [
    renameItem(() => actions.onRenameProject(project)),
    moveToWorkspaceItem(() => actions.onMoveProjectToWorkspace(project)),
    {
      key: "add-workflow",
      icon: Plus,
      label: "Add workflow…",
      separated: true,
      onSelect: () => actions.onAddWorkflowToProject(projectId),
    },
    exportItem(() => actions.onExportProject(project), false),
    deleteItem("Delete project…", () =>
      actions.onDeleteProject(projectId, project.name),
    ),
  ];
}

/**
 * The point a keyboard context-menu request (Shift+F10, or the dedicated
 * ContextMenu key) anchors to — the bottom-left of the row that has focus — or
 * null for any other key. Suppresses the browser's own menu on the two that
 * open ours.
 */
export function contextMenuKeyPoint(
  event: React.KeyboardEvent<HTMLElement>,
): ContextMenuOrigin | null {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
    return null;
  }
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}
