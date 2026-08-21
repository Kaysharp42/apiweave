import { useEffect, useState } from "react";
import { Button } from "../atoms/Button";
import { Spinner } from "../atoms/Spinner";
import { Modal } from "../molecules/Modal";
import { FormField } from "../molecules/FormField";
import { MOVE_DIALOG_SELECT_CLASS } from "./moveDialogClasses";
import { useAsyncOptions } from "../../hooks/useAsyncOptions";
import { apiweave } from "../../utils/apiweaveClient";
import type { MoveToProjectDialogProps, Project } from "../../types";

/** Sentinel for the "no project" option — `<option value="">` reads back as "". */
const UNASSIGNED = "";

/**
 * Reassign a workflow to a different project in the same workspace, or detach it
 * from every project.
 *
 * Cross-workspace moves are a different dialog (`MoveToWorkspaceDialog`), and not
 * only for wording: a project in another workspace is not a legal target at all —
 * `WorkflowService.assertCollectionInWorkspace` rejects it — so the two cannot
 * share one project list.
 *
 * The list is fetched here rather than taken from `SidebarStore`, whose project
 * state is only refreshed while the projects tab is the visible one: right-clicking
 * a row on the workflows tab would otherwise offer an empty set of projects.
 */
export function MoveToProjectDialog({
  open,
  workflowName,
  workspaceId,
  currentProjectId,
  onClose,
  onConfirm,
}: MoveToProjectDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    currentProjectId ?? UNASSIGNED,
  );
  const [isMoving, setIsMoving] = useState(false);

  const { options: projects, isLoading: isLoadingProjects } =
    useAsyncOptions<Project>(open ? workspaceId : null, (id) =>
      apiweave.projects.list(id).then((result) => result.items),
    );

  // Reopening on another row must not show the previous row's selection.
  useEffect(() => {
    if (!open) return;
    setSelectedProjectId(currentProjectId ?? UNASSIGNED);
    setIsMoving(false);
  }, [open, currentProjectId]);

  const isUnchanged =
    (selectedProjectId === UNASSIGNED ? null : selectedProjectId) ===
    currentProjectId;

  const handleConfirm = async (): Promise<void> => {
    setIsMoving(true);
    try {
      await onConfirm(
        selectedProjectId === UNASSIGNED ? null : selectedProjectId,
      );
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Move "${workflowName}" to project`}
      size="sm"
      footer={() => (
        <>
          <Button variant="ghost" onClick={onClose} disabled={isMoving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={isMoving}
            disabled={isUnchanged || isLoadingProjects}
            onClick={() => void handleConfirm()}
          >
            Move
          </Button>
        </>
      )}
    >
      <div className="p-5">
        <FormField
          label="Project"
          hint="Choose a project in this workspace, or no project at all."
        >
          {isLoadingProjects ? (
            <div className="flex items-center gap-2 py-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              <Spinner size="xs" /> Loading projects…
            </div>
          ) : (
            <select
              aria-label="Target project"
              className={MOVE_DIALOG_SELECT_CLASS}
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              disabled={isMoving}
            >
              <option value={UNASSIGNED}>No project</option>
              {projects.map((project) => {
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
      </div>
    </Modal>
  );
}
