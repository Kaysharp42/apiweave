import { ConfirmDialog } from "../molecules/ConfirmDialog";
import usePendingEditsStore from "../../stores/PendingEditsStore";

/** The Save / Discard / Cancel question asked before unsaved work is closed. */
export function UnsavedChangesDialog() {
  const promptFor = usePendingEditsStore((s) => s.promptFor);
  const answer = usePendingEditsStore((s) => s.answer);

  return (
    <ConfirmDialog
      open={promptFor !== null}
      onClose={() => answer("cancel")}
      onConfirm={() => answer("save")}
      onSecondary={() => answer("discard")}
      title="Unsaved changes"
      message={`"${promptFor ?? ""}" has changes that are not saved. Save them before closing?`}
      confirmLabel="Save"
      secondaryLabel="Discard"
      intent="warning"
    />
  );
}
