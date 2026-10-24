import { Button } from "../atoms/Button";
import type { ModalFormFooterProps } from "../../types";

/** A form dialog's footer: Cancel, and the button that submits the form by its id. */
export function ModalFormFooter({ formId, submitLabel, onCancel, busy, canSubmit }: ModalFormFooterProps) {
  return (
    <>
      <Button variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={busy} disabled={!canSubmit}>
        {submitLabel}
      </Button>
    </>
  );
}
