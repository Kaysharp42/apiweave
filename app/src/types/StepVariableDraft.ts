import type { StepLiteral } from "./StepLiteral";

/** What **Make value a variable** shows for the chosen literal and the name typed so far. */
export interface StepVariableDraft {
  /** The chosen literal, or undefined when the step holds none. */
  readonly literal: StepLiteral | undefined;
  /** The typed name, trimmed. */
  readonly name: string;
  /** Why the name cannot hold the literal, or undefined when it can. */
  readonly error: string | undefined;
  /** How many other steps hold the same text in the same family. */
  readonly others: number;
  /** Whether the name is an existing variable that already holds this value. */
  readonly reused: boolean;
  /** The family "everywhere" reaches: the value a step uses, or the text that finds its element. */
  readonly family: "value" | "element text";
}
