import { useState } from "react";
import { toast } from "sonner";
import { apiweave } from "../utils/apiweaveClient";
import useTabStore from "../stores/TabStore";
import type { Project } from "../types/Project";
import type { SidebarRowActions } from "../types/SidebarRowActions";
import type { SidebarRowActionsParams } from "../types/SidebarRowActionsParams";
import type { Workflow } from "../types/Workflow";

/**
 * Follow a moved workflow's open tab into its new workspace.
 *
 * A tab belongs to the workspace its workflow is in — `useWorkspaceTabs` filters
 * on that, and a tab left behind would pair the old workspace's id with a
 * workflow no longer in it, which main rejects as not found. Relocating beats
 * closing: the tab may hold unsaved edits, and `openTab`'s existing-tab branch
 * keeps `isDirty`. Guarded on a tab actually being open, because `openTab` would
 * otherwise *open* one — moving a row in the sidebar must not do that.
 */
function relocateOpenTab(workflow: Workflow, targetWorkspaceId: string): void {
  const tabStore = useTabStore.getState();
  if (!tabStore.tabs.some((tab) => tab.workflowId === workflow.workflowId)) {
    return;
  }
  tabStore.openTab({ ...workflow, workspaceId: targetWorkspaceId });
}

function reportFailure(context: string, error: unknown, fallback: string): void {
  console.error(context, error);
  toast.error((error as Error).message || fallback);
}

/**
 * The rename and move actions behind a sidebar row's context menu.
 *
 * Each action owns which row it is aimed at, so the sidebar itself only mounts
 * the dialogs (`SidebarRowDialogs`) and hands `open` to the rows. Keeping the
 * dialog state here rather than in `Sidebar` is what stops that component from
 * growing another five pieces of modal state and five request handlers.
 */
export function useSidebarRowActions(
  params: SidebarRowActionsParams,
): SidebarRowActions {
  const {
    workspaceId,
    isScopeReady,
    selectedNav,
    refreshAll,
    allWorkflows,
    onWorkflowLeft,
    onProjectLeft,
  } = params;
  const [renameProject, setRenameProject] = useState<Project | null>(null);
  const [renameWorkflow, setRenameWorkflow] = useState<Workflow | null>(null);
  const [moveWorkflowToProject, setMoveWorkflowToProject] =
    useState<Workflow | null>(null);
  const [moveWorkflowToWorkspace, setMoveWorkflowToWorkspace] =
    useState<Workflow | null>(null);
  const [moveProjectToWorkspace, setMoveProjectToWorkspace] =
    useState<Project | null>(null);

  /** A row action can only run against a workspace that has finished loading. */
  const scoped = (message: string): string | null => {
    if (!isScopeReady || !workspaceId) {
      toast.error(message);
      return null;
    }
    return workspaceId;
  };

  const submitRenameProject = async (name: string): Promise<void> => {
    const scope = scoped("Select a workspace before renaming projects.");
    if (!scope || !renameProject) return;
    const projectId = renameProject.projectId ?? renameProject.collectionId;
    try {
      await apiweave.projects.update(scope, projectId, { name });
      toast.success(`Project renamed to "${name}"`);
      await refreshAll(selectedNav);
    } catch (error) {
      reportFailure("Error renaming project:", error, "Failed to rename project");
    }
  };

  const submitRenameWorkflow = async (name: string): Promise<void> => {
    const scope = scoped("Select a workspace before renaming workflows.");
    if (!scope || !renameWorkflow) return;
    const { workflowId } = renameWorkflow;
    try {
      const updated = await apiweave.workflows.update(scope, workflowId, {
        name,
      });
      // An open tab carries its own copy of the name; without this the rename
      // shows in the sidebar and the tab keeps the old one.
      useTabStore.getState().updateTabWorkflow(workflowId, updated);
      toast.success(`Workflow renamed to "${name}"`);
      await refreshAll(selectedNav);
    } catch (error) {
      reportFailure(
        "Error renaming workflow:",
        error,
        "Failed to rename workflow",
      );
    }
  };

  const submitMoveWorkflowToProject = async (
    targetProjectId: string | null,
  ): Promise<void> => {
    const scope = scoped("Select a workspace before moving workflows.");
    if (!scope || !moveWorkflowToProject) {
      setMoveWorkflowToProject(null);
      return;
    }
    const { workflowId } = moveWorkflowToProject;
    try {
      await apiweave.workflows.attachToCollection(
        scope,
        workflowId,
        targetProjectId,
      );
      toast.success(
        targetProjectId
          ? "Workflow moved to project"
          : "Workflow removed from its project",
      );
      await refreshAll(selectedNav);
    } catch (error) {
      reportFailure(
        "Error moving workflow to project:",
        error,
        "Failed to move workflow",
      );
    } finally {
      setMoveWorkflowToProject(null);
    }
  };

  const submitMoveWorkflowToWorkspace = async (
    targetWorkspaceId: string,
    targetProjectId: string | null,
  ): Promise<void> => {
    const scope = scoped("Select a workspace before moving workflows.");
    if (!scope || !moveWorkflowToWorkspace) {
      setMoveWorkflowToWorkspace(null);
      return;
    }
    const { workflowId } = moveWorkflowToWorkspace;
    try {
      const moved = await apiweave.workflows.moveToWorkspace(
        scope,
        workflowId,
        targetWorkspaceId,
        targetProjectId,
      );
      relocateOpenTab(moved, targetWorkspaceId);
      onWorkflowLeft(workflowId);
      toast.success(`"${moved.name}" moved to the selected workspace`);
      await refreshAll(selectedNav);
    } catch (error) {
      reportFailure(
        "Error moving workflow to workspace:",
        error,
        "Failed to move workflow",
      );
    } finally {
      setMoveWorkflowToWorkspace(null);
    }
  };

  const submitMoveProjectToWorkspace = async (
    targetWorkspaceId: string,
  ): Promise<void> => {
    const scope = scoped("Select a workspace before moving projects.");
    if (!scope || !moveProjectToWorkspace) {
      setMoveProjectToWorkspace(null);
      return;
    }
    const projectId =
      moveProjectToWorkspace.projectId ?? moveProjectToWorkspace.collectionId;
    const { name } = moveProjectToWorkspace;
    // Read the members BEFORE the move, while they still answer to this
    // workspace's list — afterwards they are gone from it.
    const members = allWorkflows.filter(
      (workflow) => workflow.collectionId === projectId,
    );
    try {
      await apiweave.projects.moveToWorkspace(
        scope,
        projectId,
        targetWorkspaceId,
      );
      for (const member of members) {
        relocateOpenTab(member, targetWorkspaceId);
      }
      onProjectLeft(projectId);
      toast.success(`"${name}" moved to the selected workspace`);
      await refreshAll(selectedNav);
    } catch (error) {
      reportFailure(
        "Error moving project to workspace:",
        error,
        "Failed to move project",
      );
    } finally {
      setMoveProjectToWorkspace(null);
    }
  };

  return {
    targets: {
      renameProject,
      renameWorkflow,
      moveWorkflowToProject,
      moveWorkflowToWorkspace,
      moveProjectToWorkspace,
    },
    open: {
      renameProject: setRenameProject,
      renameWorkflow: setRenameWorkflow,
      moveWorkflowToProject: setMoveWorkflowToProject,
      moveWorkflowToWorkspace: setMoveWorkflowToWorkspace,
      moveProjectToWorkspace: setMoveProjectToWorkspace,
    },
    close: {
      renameProject: () => setRenameProject(null),
      renameWorkflow: () => setRenameWorkflow(null),
      moveWorkflowToProject: () => setMoveWorkflowToProject(null),
      moveWorkflowToWorkspace: () => setMoveWorkflowToWorkspace(null),
      moveProjectToWorkspace: () => setMoveProjectToWorkspace(null),
    },
    submit: {
      renameProject: submitRenameProject,
      renameWorkflow: submitRenameWorkflow,
      moveWorkflowToProject: submitMoveWorkflowToProject,
      moveWorkflowToWorkspace: submitMoveWorkflowToWorkspace,
      moveProjectToWorkspace: submitMoveProjectToWorkspace,
    },
  };
}
