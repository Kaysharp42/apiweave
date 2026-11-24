import type { JsonValue } from "@shared/types/JsonValue";

/** The workflow's variables as a step reads them: a variable's value is JSON. */
export type StepVariables = Readonly<Record<string, JsonValue>>;
