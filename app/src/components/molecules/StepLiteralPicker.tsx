import { Select } from "../atoms/Select";
import { FormField } from "./FormField";
import { previewStepLiteral } from "../../utils/makeStepVariable";
import type { StepLiteralPickerProps } from "../../types";

/**
 * The literal **Make value a variable** moves: a choice when the step holds
 * several, the value itself when it holds one.
 */
export function StepLiteralPicker({ literals, literal, onChoose }: StepLiteralPickerProps) {
  if (literals.length <= 1) {
    if (literal === undefined) return null;
    return (
      <FormField label={literal.description}>
        <p className="truncate font-mono text-sm text-text-primary dark:text-text-primary-dark">{previewStepLiteral(literal.value)}</p>
      </FormField>
    );
  }
  return (
    <FormField label="Value">
      <Select
        aria-label="Value"
        value={literal?.field}
        onChange={(event) => {
          const picked = literals.find((candidate) => candidate.field === event.target.value);
          if (picked !== undefined) onChoose(picked.field);
        }}
      >
        {literals.map((candidate) => (
          <option key={candidate.field} value={candidate.field}>
            {`${candidate.description}: ${previewStepLiteral(candidate.value)}`}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
