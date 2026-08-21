import { PromptDialog } from "../../molecules/PromptDialog";
import { MoveToProjectDialog } from "../../organisms/MoveToProjectDialog";
import { MoveToWorkspaceDialog } from "../../organisms/MoveToWorkspaceDialog";
import {
  projectMoveWarnings,
  workflowMoveWarnings,
} from "../../../utils/workspaceMoveWarnings";
import type { SidebarRowDialogsProps } from "../../../types";

/**
 * The dialogs behind a sidebar row's rename and move actions.
 *
 * Mounted once by `Sidebar` and driven entirely by `useSidebarRowActions`, so a
 * row only has to say which action the user picked. The two move dialogs are
 * gated on a workspace being known because both send it as the source scope.
 */
export function SidebarRowDialogs({
  actions,
  workspaceId,
  projects,
  environments,
  allWorkflows,
}: SidebarRowDialogsProps) {
  const { targets, close, submit } = actions;
  const movingProjectId =
    targets.moveProjectToWorkspace === null
      ? null
      : (targets.moveProjectToWorkspace.projectId ??
        targets.moveProjectToWorkspace.collectionId);

  return (
    <>
      <PromptDialog
        open={!!targets.renameProject}
        onClose={close.renameProject}
        onSubmit={submit.renameProject}
        title="Rename Project"
        message="Enter a new name for this project."
        placeholder="My Project"
        defaultValue={targets.renameProject?.name ?? ""}
        submitLabel="Rename"
      />

      <PromptDialog
        open={!!targets.renameWorkflow}
        onClose={close.renameWorkflow}
        onSubmit={submit.renameWorkflow}
        title="Rename Workflow"
        message="Enter a new name for this workflow."
        placeholder="My Workflow"
        defaultValue={targets.renameWorkflow?.name ?? ""}
        submitLabel="Rename"
      />

      {targets.moveWorkflowToProject && workspaceId && (
        <MoveToProjectDialog
          open={true}
          workflowName={targets.moveWorkflowToProject.name}
          workspaceId={workspaceId}
          currentProjectId={targets.moveWorkflowToProject.collectionId ?? null}
          onClose={close.moveWorkflowToProject}
          onConfirm={submit.moveWorkflowToProject}
        />
      )}

      {targets.moveWorkflowToWorkspace && workspaceId && (
        <MoveToWorkspaceDialog
          open={true}
          itemKind="workflow"
          itemName={targets.moveWorkflowToWorkspace.name}
          currentWorkspaceId={workspaceId}
          warnings={workflowMoveWarnings(
            targets.moveWorkflowToWorkspace,
            projects,
            environments,
          )}
          onClose={close.moveWorkflowToWorkspace}
          onConfirm={submit.moveWorkflowToWorkspace}
        />
      )}

      {targets.moveProjectToWorkspace && workspaceId && (
        <MoveToWorkspaceDialog
          open={true}
          itemKind="project"
          itemName={targets.moveProjectToWorkspace.name}
          currentWorkspaceId={workspaceId}
          warnings={projectMoveWarnings(
            allWorkflows.filter(
              (workflow) => workflow.collectionId === movingProjectId,
            ),
            environments,
          )}
          onClose={close.moveProjectToWorkspace}
          onConfirm={submit.moveProjectToWorkspace}
        />
      )}
    </>
  );
}
