import type { ReactNode } from "react";

export interface NodeFieldProps {
  /** Ties the label to the control; the caller puts the same id on the child. */
  htmlFor: string;
  label: ReactNode;
  /** The parenthetical aside — `(key=value)`, `(Use :varName in URL)`. */
  hint?: ReactNode;
  /** Validation message. Present means the control renders as invalid. */
  error?: string | undefined;
  children: ReactNode;
}
