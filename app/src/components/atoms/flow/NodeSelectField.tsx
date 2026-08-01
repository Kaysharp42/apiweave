import { NodeField } from "./NodeField";
import { NODE_SELECT_CLASS } from "./nodeControlClasses";
import type { NodeSelectFieldProps } from "../../../types/NodeSelectFieldProps";

/**
 * A labelled `<select>` driven by an options table.
 *
 * The pairing of a `NodeField` with a select and a hand-written run of
 * `<option>` elements was itself repeated once the fields were extracted, so
 * the options move into data too. `onChange` hands back the raw string; the
 * caller narrows it to its own union.
 */
export function NodeSelectField({
  id,
  label,
  value,
  onChange,
  options,
}: NodeSelectFieldProps) {
  return (
    <NodeField htmlFor={id} label={label}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={NODE_SELECT_CLASS}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </NodeField>
  );
}
