import type { JsonValue } from "@shared/types/JsonValue";

/** The Result cell of one conflicted field: the value the merge would write, editable as a value of the user's own. */
export interface MergeResultEditorProps {
  /** What the controls are called, without the direction: `Name in Checkout`. */
  readonly label: string;
  /** The value the merge would write now, or absent where it writes nothing. */
  readonly value: JsonValue | undefined;
  /** Whether a decision settles this field; an unsettled value is the remote's standing in. */
  readonly resolved: boolean;
  readonly disabled: boolean;
  /** A value that parses: JSON text is checked before anything is decided. */
  readonly onChange: (value: JsonValue) => void;
}
