import type { OpenWorkspaceOutcome } from "./OpenWorkspaceOutcome";

/** The footer of the open-from-git dialog: one pair of buttons per outcome. */
export interface OpenWorkspaceFromGitFooterProps {
  readonly outcome: OpenWorkspaceOutcome;
  /** A clone is under way, so no button may start another action. */
  readonly busy: boolean;
  /** A remote is chosen, so the form can be submitted. */
  readonly canSubmit: boolean;
  /** The form's id, so the form branch's submit button submits it. */
  readonly formId: string;
  /** From a duplicate, back to the form it came from. */
  readonly onBack: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}
