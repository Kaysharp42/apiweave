import { useState } from "react";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { git } from "../utils/apiweaveClient";
import type { GitSyncActions, GitSyncDialog } from "../types";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * What the header control and the settings panel do to one workspace's
 * history. A call's resolved status goes to `apply`, so the shown status is
 * right even before the announcement that carries the same one arrives; a
 * call that rejects is `error`, which is not the same as a cycle that ran and
 * recorded its own failure in the status.
 *
 * The dialogs are state here and markup elsewhere (`GitSyncDialogs`): they
 * must outlive the popover the action was started from.
 */
export function useGitSyncActions(
  status: WorkspaceGitStatus,
  apply: (next: WorkspaceGitStatus) => void,
): GitSyncActions {
  const { workspaceId } = status;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<GitSyncDialog | null>(null);

  const run = async (
    action: () => Promise<WorkspaceGitStatus>,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      apply(await action());
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    dialog,
    sync: () => {
      if (status.mode === "manual" && status.uncommitted) setDialog("commit");
      else void run(() => git.syncNow(workspaceId));
    },
    askToResolveMerge: () => setDialog("merge"),
    askToDiscard: () => setDialog("discard"),
    commit: (message) => {
      setDialog(null);
      const subject = message.trim();
      void run(() =>
        subject === ""
          ? git.syncNow(workspaceId)
          : git.syncNow(workspaceId, { message: subject }),
      );
    },
    discard: () => {
      setDialog(null);
      void run(() => git.discardLocalChanges(workspaceId));
    },
    updateStatus: apply,
    closeDialog: () => setDialog(null),
  };
}
