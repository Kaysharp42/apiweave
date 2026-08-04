import {
  NODE_ERROR_CLASS,
  NODE_HINT_CLASS,
  NODE_LABEL_CLASS,
} from "./nodeControlClasses";
import type { NodeFieldProps } from "../../../types/NodeFieldProps";

/**
 * Label, control, and validation message — the shape every config field inside
 * a node takes.
 *
 * The control is a child rather than a prop so each caller keeps its own
 * element and its own props; this owns only the parts that were identical
 * everywhere. Pair with the class strings in `nodeControlClasses`.
 */
export function NodeField({
  htmlFor,
  label,
  hint,
  error,
  children,
}: NodeFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className={NODE_LABEL_CLASS}>
        {label}
        {hint && (
          <>
            {" "}
            <span className={NODE_HINT_CLASS}>{hint}</span>
          </>
        )}
      </label>
      {children}
      {error && <div className={NODE_ERROR_CLASS}>{error}</div>}
    </div>
  );
}
