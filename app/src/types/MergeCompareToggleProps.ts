import type { JsonValue } from "@shared/types/JsonValue";

/** The Compare toggle for a long value: opens a read-only diff of both copies. */
export interface MergeCompareToggleProps {
  /** The field and its record, for the button and the diff's name. */
  readonly label: string;
  readonly ours: JsonValue | undefined;
  readonly theirs: JsonValue | undefined;
  readonly disabled: boolean;
}
