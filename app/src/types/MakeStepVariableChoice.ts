import type { StepLiteralField } from "./StepLiteralField";

/** What the user chose in the **Make value a variable** dialog. */
export interface MakeStepVariableChoice {
  readonly field: StepLiteralField;
  readonly name: string;
  /** Also replace the same literal in the workflow's other browser steps. */
  readonly everywhere: boolean;
}
