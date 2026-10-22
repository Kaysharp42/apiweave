import type { JsonValue } from "@shared/types/JsonValue";

/** One side's value at a conflicted field, as the picker shows it. */
export interface GitMergeValueProps {
  /** Absent where that side deleted the field or never had it. */
  readonly value: JsonValue | undefined;
}
