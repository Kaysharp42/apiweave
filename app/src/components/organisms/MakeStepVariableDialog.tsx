import { useState } from "react";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Select } from "../atoms/Select";
import { CheckboxOption } from "../molecules/CheckboxOption";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import {
  stepLiterals,
  stepsSharingLiteral,
  stepVariableNameError,
  suggestedStepVariableName,
} from "../../utils/makeStepVariable";
import type { MakeStepVariableDialogProps, StepLiteralField } from "../../types";

function preview(value: string): string {
  return value.length > 60 ? `${value.slice(0, 59)}…` : value;
}

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

  const literal = literals.find((candidate) => candidate.field === field);
  const trimmed = name.trim();
  const error = literal === undefined ? undefined : stepVariableNameError(trimmed, literal.value, variables);
  const others = node === undefined || literal === undefined ? 0 : stepsSharingLiteral(nodes, node.id, literal.field, literal.value);
  const reused = literal !== undefined && error === undefined && variables[trimmed] === literal.value;
  // "Everywhere" reaches the same family only: the value a step uses, or the text that finds its element.
  const family = literal !== undefined && literal.field.startsWith("locator.") ? "element text" : "value";

  const choose = (next: StepLiteralField): void => {
    setField(next);
    if (node !== undefined) setName(suggestedStepVariableName(node, next, variables));
  };

  const submit = (): void => {
    if (literal === undefined || error !== undefined) return;
    onSubmit({ field: literal.field, name: trimmed, everywhere: everywhere && others > 0 });
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
        {literals.length > 1 ? (
          <FormField label="Value">
            <Select
              aria-label="Value"
              value={field}
              onChange={(event) => {
                const picked = literals.find((candidate) => candidate.field === event.target.value);
                if (picked !== undefined) choose(picked.field);
              }}
            >
              {literals.map((candidate) => (
                <option key={candidate.field} value={candidate.field}>
                  {`${candidate.description}: ${preview(candidate.value)}`}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          literal !== undefined && (
            <FormField label={literal.description}>
              <p className="truncate font-mono text-sm text-text-primary dark:text-text-primary-dark">{preview(literal.value)}</p>
            </FormField>
          )
        )}
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
          {...(reused ? { helperText: `Reuses ${trimmed}, which already holds this value.` } : {})}
        />
        {others > 0 && (
          <CheckboxOption
            label={`Also replace the same ${family} in ${others} other ${others === 1 ? "step" : "steps"}`}
            checked={everywhere}
            onChange={setEverywhere}
          />
        )}
      </div>
    </Modal>
  );
}
