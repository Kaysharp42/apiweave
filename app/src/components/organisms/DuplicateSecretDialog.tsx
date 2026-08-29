import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Spinner } from "../atoms/Spinner";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import { MOVE_DIALOG_SELECT_CLASS } from "./moveDialogClasses";
import { useAsyncOptions } from "../../hooks/useAsyncOptions";
import { apiweave } from "../../utils/apiweaveClient";
import type { Secret, Workspace } from "../../types";

interface DuplicateSecretDialogProps {
  readonly open: boolean;
  readonly secret: Secret | null;
  /** The workspace whose scope currently holds the secret — the default destination. */
  readonly sourceWorkspaceId: string;
  readonly onClose: () => void;
  readonly onConfirm: (
    name: string,
    targetWorkspaceId: string,
  ) => Promise<void>;
}

/**
 * Copy a secret into another workspace's scope, or beside itself under a new name.
 *
 * The VALUE comes along. That is the difference from duplicating an environment
 * (which deliberately leaves secrets behind) and it is the whole reason this
 * dialog exists — a secret cannot be read back, so "duplicate" that copied only
 * the name would leave the user with nothing to retype from. The notice says so
 * plainly: a copy into another workspace means the credential now works in two
 * places, and deleting it from one does not revoke the other.
 */
export function DuplicateSecretDialog({
  open,
  secret,
  sourceWorkspaceId,
  onClose,
  onConfirm,
}: DuplicateSecretDialogProps) {
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
    setName(secret ? `${secret.name}_COPY` : "");
    setTargetWorkspaceId(sourceWorkspaceId);
    setIsCopying(false);
  }, [open, secret, sourceWorkspaceId]);

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
      title={`Duplicate secret "${secret?.name ?? ""}"`}
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
        <FormField
          label="Name of the copy"
          hint="Letters, digits, underscores — this is the {{secrets.NAME}} the copy answers to."
        >
          <Input
            aria-label="Name of the copy"
            className="font-mono"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isCopying}
            autoFocus
          />
        </FormField>

        <FormField
          label="Destination workspace"
          hint="Defaults to the workspace this secret is already in."
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
            <ShieldAlert
              className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark"
              aria-hidden="true"
            />
            <span className="text-xs font-semibold text-text-primary dark:text-text-primary-dark">
              The value is copied
            </span>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-8 text-xs text-text-secondary dark:text-text-secondary-dark">
            <li>
              The copy holds the same credential, still encrypted at rest.
            </li>
            {crossWorkspace && (
              <li>
                It will work in the destination workspace too — deleting one of
                the two does not revoke the other.
              </li>
            )}
            <li>
              A name already taken in the destination is refused rather than
              overwritten; nothing can read a secret back to undo that.
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}
