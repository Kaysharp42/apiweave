import type { JsonValue } from "@shared/types/JsonValue";

/** The control a result's value is typed or edited in: an inline input, or Monaco for a long value. */
export interface MergeValueControlProps {
  /** What the control is called, without the direction. */
  readonly label: string;
  /** The value the merge would write now, so the control knows what it is editing. */
  readonly value: JsonValue | undefined;
  readonly text: string;
  readonly long: boolean;
  /** Whether the value is text, in which case its text is the value and no quoting is needed. */
  readonly textValue: boolean;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onChange: (text: string) => void;
}
