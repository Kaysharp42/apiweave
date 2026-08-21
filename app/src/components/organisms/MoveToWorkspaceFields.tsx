import { FormField } from "../molecules/FormField";
import { Spinner } from "../atoms/Spinner";
import { MOVE_DIALOG_SELECT_CLASS } from "./moveDialogClasses";
import type { Project, Workspace } from "../../types";

interface MoveToWorkspaceFieldsProps {
  readonly itemKind: "project" | "workflow";
  readonly candidates: readonly Workspace[];
  readonly isLoadingWorkspaces: boolean;
  readonly targetWorkspaceId: string;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  /** Empty for a project move — a project takes its own workflows with it. */
  readonly targetProjects: readonly Project[];
  readonly isLoadingProjects: boolean;
  readonly targetProjectId: string;
  readonly onSelectProject: (projectId: string) => void;
  readonly disabled: boolean;
  /** Value that means "no project" — shared with the parent's confirm logic. */
  readonly unassignedValue: string;
}

/**
 * The destination selects for `MoveToWorkspaceDialog`.
 *
 * Separate from the dialog so the dialog keeps the state, the confirm call and
 * the footer, and this keeps the three-way loading / nothing-to-choose / choose
 * branch. Both halves stay inside the cognitive-complexity budget that way, and
 * the branch that decides *what the user sees* reads in one place.
 */
export function MoveToWorkspaceFields({
  itemKind,
  candidates,
  isLoadingWorkspaces,
  targetWorkspaceId,
  onSelectWorkspace,
  targetProjects,
  isLoadingProjects,
  targetProjectId,
  onSelectProject,
  disabled,
  unassignedValue,
}: MoveToWorkspaceFieldsProps) {
  if (isLoadingWorkspaces) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-text-secondary dark:text-text-secondary-dark">
        <Spinner size="xs" /> Loading workspaces…
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
        There is no other workspace to move this {itemKind} into. Create one
        first from the workspace switcher.
      </p>
    );
  }

  return (
    <>
      <FormField label="Destination workspace">
        <select
          aria-label="Destination workspace"
          className={MOVE_DIALOG_SELECT_CLASS}
          value={targetWorkspaceId}
          onChange={(event) => onSelectWorkspace(event.target.value)}
          disabled={disabled}
        >
          {candidates.map((workspace) => (
            <option key={workspace.workspaceId} value={workspace.workspaceId}>
              {workspace.name}
            </option>
          ))}
        </select>
      </FormField>

      {itemKind === "workflow" && (
        <FormField
          label="Project in the destination"
          hint="Optional — the workflow can arrive without a project."
        >
          {isLoadingProjects ? (
            <div className="flex items-center gap-2 py-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              <Spinner size="xs" /> Loading projects…
            </div>
          ) : (
            <select
              aria-label="Project in the destination workspace"
              className={MOVE_DIALOG_SELECT_CLASS}
              value={targetProjectId}
              onChange={(event) => onSelectProject(event.target.value)}
              disabled={disabled}
            >
              <option value={unassignedValue}>No project</option>
              {targetProjects.map((project) => {
                const projectId = project.projectId ?? project.collectionId;
                return (
                  <option key={projectId} value={projectId}>
                    {project.name}
                  </option>
                );
              })}
            </select>
          )}
        </FormField>
      )}
    </>
  );
}
