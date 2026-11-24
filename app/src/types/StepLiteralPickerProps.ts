import type { StepLiteral } from "./StepLiteral";
import type { StepLiteralField } from "./StepLiteralField";

export interface StepLiteralPickerProps {
  /** Every literal the step holds. */
  readonly literals: readonly StepLiteral[];
  /** The literal currently chosen, if the step holds any. */
  readonly literal: StepLiteral | undefined;
  readonly onChoose: (field: StepLiteralField) => void;
}
