import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "../atoms/Button";
import { Modal } from "../molecules/Modal";
import { MoveToWorkspaceFields } from "./MoveToWorkspaceFields";
import { useAsyncOptions } from "../../hooks/useAsyncOptions";
import { apiweave } from "../../utils/apiweaveClient";
import type {
  MoveToWorkspaceDialogProps,
  Project,
  Workspace,
} from "../../types";

/** Sentinel for the "no project" option — `<option value="">` reads back as "". */
const UNASSIGNED = "";

/** Only a workflow picks a project, and only once a destination is chosen. */
function projectsFetchKey(
  open: boolean,
  itemKind: "project" | "workflow",
  targetWorkspaceId: string,
): string | null {
  if (!open || itemKind !== "workflow") return null;
  return targetWorkspaceId === "" ? null : targetWorkspaceId;
}

/** The project id to send: null for a project move, or for "No project". */
function chosenProjectId(
  itemKind: "project" | "workflow",
  targetProjectId: string,
): string | null {
  if (itemKind !== "workflow" || targetProjectId === UNASSIGNED) return null;
  return targetProjectId;
}

/**
 * Move a project or a workflow into another workspace.
 *
 * Both lists are fetched here rather than passed in. The sidebar only ever holds
 * the *current* workspace's projects, and the destination's are needed exactly
 * when a workspace is picked; the workspace list is fetched for the same reason
 * it is not read from `WorkspaceContext` — the sidebar's tests render it without
 * that provider, and a dialog that only opens on a right-click has no business
 * adding a provider requirement to its host. A workflow may land in one of the
 * destination's projects or stay unassigned; a project brings its own workflows,
 * so it has no such choice to make.
 *
 * `warnings` is the honest part of this dialog. A workspace is the scope an
 * environment selection and a Call Workflow target resolve in, so those cannot
 * follow the item across and the server clears them — the user gets told which
 * ones before they confirm, not after.
 */
export function MoveToWorkspaceDialog({
  open,
  itemKind,
  itemName,
  currentWorkspaceId,
  warnings,
  onClose,
  onConfirm,
}: MoveToWorkspaceDialogProps) {
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>("");
  const [targetProjectId, setTargetProjectId] = useState<string>(UNASSIGNED);
  const [isMoving, setIsMoving] = useState(false);

  const { options: workspaces, isLoading: isLoadingWorkspaces } =
    useAsyncOptions<Workspace>(open ? "all" : null, () =>
      apiweave.workspaces.list(),
    );

  const { options: targetProjects, isLoading: isLoadingProjects } =
    useAsyncOptions<Project>(
      projectsFetchKey(open, itemKind, targetWorkspaceId),
      (workspaceId) =>
        apiweave.projects.list(workspaceId).then((result) => result.items),
    );

  // Memoised so the reset effect below fires on opening rather than on every
  // render — a fresh array each time would clear the selection continuously.
  const candidates = useMemo(
    () =>
      workspaces.filter(
        (workspace) => workspace.workspaceId !== currentWorkspaceId,
      ),
    [workspaces, currentWorkspaceId],
  );

  // Default to the first destination once the list lands, and never show the
  // previous row's selection when the dialog reopens.
  useEffect(() => {
    if (!open) return;
    setTargetWorkspaceId(candidates[0]?.workspaceId ?? "");
    setIsMoving(false);
  }, [open, candidates]);

  // A project list belongs to one destination; switching destination invalidates
  // the choice made against the previous one.
  useEffect(() => {
    setTargetProjectId(UNASSIGNED);
  }, [targetWorkspaceId]);

  const handleConfirm = async (): Promise<void> => {
    setIsMoving(true);
    try {
      await onConfirm(
        targetWorkspaceId,
        chosenProjectId(itemKind, targetProjectId),
      );
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Move ${itemKind} "${itemName}" to another workspace`}
      size="sm"
      footer={() => (
        <>
          <Button variant="ghost" onClick={onClose} disabled={isMoving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={isMoving}
            disabled={targetWorkspaceId === ""}
            onClick={() => void handleConfirm()}
          >
            Move
          </Button>
        </>
      )}
    >
      <div className="space-y-4 p-5">
        <MoveToWorkspaceFields
          itemKind={itemKind}
          candidates={candidates}
          isLoadingWorkspaces={isLoadingWorkspaces}
          targetWorkspaceId={targetWorkspaceId}
          onSelectWorkspace={setTargetWorkspaceId}
          targetProjects={targetProjects}
          isLoadingProjects={isLoadingProjects}
          targetProjectId={targetProjectId}
          onSelectProject={setTargetProjectId}
          disabled={isMoving}
          unassignedValue={UNASSIGNED}
        />

        {warnings.length > 0 && <MoveWarnings warnings={warnings} />}
      </div>
    </Modal>
  );
}

/** The "what you lose" block. Split out to keep the dialog body readable. */
function MoveWarnings({ warnings }: { readonly warnings: readonly string[] }) {
  return (
    <div className="rounded-sm border border-status-warning/40 bg-status-warning/10 p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle
          className="h-3.5 w-3.5 flex-shrink-0 text-status-warning dark:text-[var(--aw-status-warning)]"
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-text-primary dark:text-text-primary-dark">
          This move cannot be undone by moving it back
        </span>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-8 text-xs text-text-secondary dark:text-text-secondary-dark">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}
