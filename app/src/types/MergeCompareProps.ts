import type { JsonValue } from "@shared/types/JsonValue";

/** A read-only diff of both copies' values at one field, for a long body or script. */
export interface MergeCompareProps {
  /** What the diff is called: the field and its record. */
  readonly label: string;
  readonly ours: JsonValue | undefined;
  readonly theirs: JsonValue | undefined;
}
