import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { GitCommitDialog } from "./GitCommitDialog";
import { GitMergeDialog } from "./GitMergeDialog";
import type { GitSyncDialogsProps } from "../../types";

/**
 * The dialogs a sync action can wait on. Rendered by whoever owns the actions,
 * outside any popover: the popover closes the moment focus moves into a
 * dialog, and a dialog rendered inside it would close with it.
 */
export function GitSyncDialogs({ status, actions }: GitSyncDialogsProps) {
  return (
    <>
      {actions.dialog === "commit" && (
        <GitCommitDialog
          workspaceId={status.workspaceId}
          connected={status.remoteUrl !== null}
          onClose={actions.closeDialog}
          onConfirm={actions.commit}
        />
      )}
      {actions.dialog === "merge" && status.state === "merging" && (
        <GitMergeDialog
          status={status}
          onClose={actions.closeDialog}
          onStatus={actions.updateStatus}
        />
      )}
      <ConfirmDialog
        open={actions.dialog === "discard"}
        onClose={actions.closeDialog}
        onConfirm={actions.discard}
        title="Discard local changes?"
        message="Every local commit and every change not yet committed is thrown away, and the remote's version of this workspace is loaded in its place. This can't be undone."
        confirmLabel="Discard local changes"
        intent="error"
      />
    </>
  );
}
