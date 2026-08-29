import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Spinner } from "../atoms/Spinner";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import { MOVE_DIALOG_SELECT_CLASS } from "./moveDialogClasses";
import { useAsyncOptions } from "../../hooks/useAsyncOptions";
import { apiweave } from "../../utils/apiweaveClient";
import type { ScopedEnvironment, Workspace } from "../../types";

interface DuplicateEnvironmentDialogProps {
  readonly open: boolean;
  readonly environment: ScopedEnvironment | null;
  /** The workspace the environment currently lives in — the default destination. */
  readonly sourceWorkspaceId: string;
  readonly onClose: () => void;
  readonly onConfirm: (
    name: string,
    targetWorkspaceId: string,
  ) => Promise<void>;
}

/**
 * Copy an environment, into its own workspace or another one.
 *
 * The destination defaults to the source, because duplicating in place is the
 * common case — a variant of an environment you already have. Choosing a
 * different workspace is the same operation, and the server drops what cannot
 * cross the border (see `EnvironmentService.duplicate`): the `isDefault` claim
 * always, and the base-environment link on a cross-workspace copy, since a base
 * must live in the same workspace as the environment extending it.
 *
 * The secrets notice is the honest part. Secrets are never copied — the copy
 * gets the variables and nothing sealed — so an environment whose requests
 * authenticate through a secret will not work until those are re-entered. Saying
 * so here beats a duplicate that looks complete and fails at run time.
 */
export function DuplicateEnvironmentDialog({
  open,
  environment,
  sourceWorkspaceId,
  onClose,
  onConfirm,
}: DuplicateEnvironmentDialogProps) {
  const [name, setName] = useState("");
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("");
  const [isCopying, setIsCopying] = useState(false);

  const { options: workspaces, isLoading: isLoadingWorkspaces } =
    useAsyncOptions<Workspace>(open ? "all" : null, () =>
      apiweave.workspaces.list(),
    );

  // Reset on open so the previous row's name and destination never carry over.
  useEffect(() => {
    if (!open) return;
    setName(environment ? `${environment.name} (copy)` : "");
    setTargetWorkspaceId(sourceWorkspaceId);
    setIsCopying(false);
  }, [open, environment, sourceWorkspaceId]);

  const handleConfirm = async (): Promise<void> => {
    setIsCopying(true);
    try {
      await onConfirm(name.trim(), targetWorkspaceId);
    } finally {
      setIsCopying(false);
    }
  };

  const crossWorkspace =
    targetWorkspaceId !== "" && targetWorkspaceId !== sourceWorkspaceId;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Duplicate environment "${environment?.name ?? ""}"`}
      size="sm"
      footer={() => (
        <>
          <Button variant="ghost" onClick={onClose} disabled={isCopying}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={isCopying}
            disabled={name.trim() === "" || targetWorkspaceId === ""}
            onClick={() => void handleConfirm()}
          >
            Duplicate
          </Button>
        </>
      )}
    >
      <div className="space-y-4 p-5">
        <FormField label="Name of the copy">
          <Input
            aria-label="Name of the copy"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isCopying}
            autoFocus
          />
        </FormField>

        <FormField
          label="Destination workspace"
          hint="Defaults to the workspace this environment is already in."
        >
          {isLoadingWorkspaces ? (
            <div className="flex items-center gap-2 py-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              <Spinner size="xs" /> Loading workspaces…
            </div>
          ) : (
            <select
              aria-label="Destination workspace"
              className={MOVE_DIALOG_SELECT_CLASS}
              value={targetWorkspaceId}
              onChange={(event) => setTargetWorkspaceId(event.target.value)}
              disabled={isCopying}
            >
              {workspaces.map((workspace) => (
                <option
                  key={workspace.workspaceId}
                  value={workspace.workspaceId}
                >
                  {workspace.name}
                  {workspace.workspaceId === sourceWorkspaceId
                    ? " (same workspace)"
                    : ""}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <div className="rounded-sm border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
          <div className="flex items-center gap-2">
            <Info
              className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark"
              aria-hidden="true"
            />
            <span className="text-xs font-semibold text-text-primary dark:text-text-primary-dark">
              What the copy gets
            </span>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-8 text-xs text-text-secondary dark:text-text-secondary-dark">
            <li>Variables and description are copied.</li>
            <li>
              Secrets are not — re-enter them on the copy before running against
              it.
            </li>
            <li>The copy is never the workspace default.</li>
            {crossWorkspace && (
              <li>
                It leaves its base environment behind — a base must live in the
                same workspace.
              </li>
            )}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
