export interface ModalFormFooterProps {
  /** The id of the form the submit button submits. */
  readonly formId: string;
  readonly submitLabel: string;
  /** What declining says, when it is not a plain Cancel: "Not now" for a question the app asks. */
  readonly cancelLabel?: string;
  readonly onCancel: () => void;
  /** The form is being submitted: Cancel waits, and the submit button shows it is working. */
  readonly busy: boolean;
  readonly canSubmit: boolean;
}
