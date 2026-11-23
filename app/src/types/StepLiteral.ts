import type { StepLiteralField } from "./StepLiteralField";

/** A literal in a browser step that can be moved into a workflow variable. */
export interface StepLiteral {
  readonly field: StepLiteralField;
  /** What the field is, for a reader: "Typed text", "Element name (option)". */
  readonly description: string;
  readonly value: string;
}
