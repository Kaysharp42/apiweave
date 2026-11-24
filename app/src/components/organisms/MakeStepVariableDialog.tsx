import { useEffect, useState } from "react";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { CheckboxOption } from "../molecules/CheckboxOption";
import { Modal } from "../molecules/Modal";
import { StepLiteralPicker } from "../molecules/StepLiteralPicker";
import { stepLiterals, stepVariableDraft, suggestedStepVariableName } from "../../utils/makeStepVariable";
import type { MakeStepVariableDialogProps, StepLiteralField } from "../../types";

/**
 * **Make value a variable**: pick one of the step's literals, name the
 * variable it moves into, and choose whether the workflow's other steps with
 * the same text use it too. Mounted per opening (keyed by node), so each
 * opening starts from that step's suggestion.
 */
export function MakeStepVariableDialog({ open, node, nodes, variables, onClose, onSubmit }: MakeStepVariableDialogProps) {
  const literals = node === undefined ? [] : stepLiterals(node);
  const [field, setField] = useState<StepLiteralField | undefined>(literals[0]?.field);
  const [name, setName] = useState(() =>
    node === undefined || field === undefined ? "" : suggestedStepVariableName(node, field, variables),
  );
  const [everywhere, setEverywhere] = useState(true);

  const draft = stepVariableDraft(nodes, node, field, name, variables);
  const { literal, error, others } = draft;

  // The literal this opening is for can be taken away while the dialog is
  // open — an agent edit, a live update, a recorder update templating the
  // field. Close rather than sit hidden on a choice that no longer exists:
  // releasing the target is what lets the menu open the dialog again.
  const literalGone = open && literal === undefined;
  useEffect(() => {
    if (literalGone) onClose();
  }, [literalGone, onClose]);

  const choose = (next: StepLiteralField): void => {
    setField(next);
    if (node !== undefined) setName(suggestedStepVariableName(node, next, variables));
  };

  const submit = (): void => {
    if (literal === undefined || error !== undefined) return;
    onSubmit({ field: literal.field, name: draft.name, everywhere: everywhere && others > 0 });
  };

  return (
    <Modal
      isOpen={open && literal !== undefined}
      onClose={onClose}
      title="Make value a variable"
      size="sm"
      footer={() => (
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={error !== undefined} onClick={submit}>
            Make variable
          </Button>
        </>
      )}
    >
      <div className="space-y-4 p-5">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          The value moves into a workflow variable and the step reads it as {"{{variables.NAME}}"}. Change the variable to try other data.
        </p>
        <StepLiteralPicker literals={literals} literal={literal} onChoose={choose} />
        <Input
          label="Variable name"
          aria-label="Variable name"
          className="font-mono"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }}
          autoFocus
          {...(error !== undefined ? { error } : {})}
          {...(draft.reused ? { helperText: `Reuses ${draft.name}, which already holds this value.` } : {})}
        />
        {others > 0 && (
          <CheckboxOption
            label={`Also replace the same ${draft.family} in ${others} other ${others === 1 ? "step" : "steps"}`}
            checked={everywhere}
            onChange={setEverywhere}
          />
        )}
      </div>
    </Modal>
  );
}
