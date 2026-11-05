import { Button } from "../atoms/Button";
import { ModalFormFooter } from "../molecules/ModalFormFooter";
import type { OpenWorkspaceFromGitFooterProps } from "../../types";

/**
 * The dialog's footer: the form's Cancel and Open workspace, or, once the clone
 * has answered, Back to the form (a duplicate) or Close (warnings to review),
 * beside the button that opens what was found.
 */
export function OpenWorkspaceFromGitFooter({
  outcome,
  busy,
  canSubmit,
  formId,
  onBack,
  onCancel,
  onConfirm,
}: OpenWorkspaceFromGitFooterProps) {
  if (outcome.kind === "duplicate") {
    return (
      <>
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button loading={busy} onClick={onConfirm}>
          Open it
        </Button>
      </>
    );
  }
  if (outcome.kind === "pending") {
    return (
      <>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Close
        </Button>
        <Button loading={busy} onClick={onConfirm}>
          Open workspace
        </Button>
      </>
    );
  }
  return (
    <ModalFormFooter
      formId={formId}
      submitLabel="Open workspace"
      onCancel={onCancel}
      busy={busy}
      canSubmit={canSubmit}
    />
  );
}
