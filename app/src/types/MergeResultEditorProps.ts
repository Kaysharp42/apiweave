import type { JsonValue } from "@shared/types/JsonValue";

/** The Result cell of one conflicted field: the value the merge would write, editable as a value of the user's own. */
export interface MergeResultEditorProps {
  /** What the controls are called, without the direction: `Name in Checkout`. */
  readonly label: string;
  /** The value the merge would write now, or absent where it writes nothing. */
  readonly value: JsonValue | undefined;
  /** Whether the field is edited as its text rather than as JSON. */
  readonly text: boolean;
  /** Whether the value is long enough to be edited in Monaco. */
  readonly long: boolean;
  /** Whether a decision settles this field; an unsettled value is the remote's standing in. */
  readonly resolved: boolean;
  readonly disabled: boolean;
  /** A value that parses: JSON text is checked before anything is decided. */
  readonly onChange: (value: JsonValue) => void;
  /** Empty or unparseable text: this field decides nothing again. */
  readonly onClear: () => void;
  /** Whether the text in the control parses, so closing can ask before losing it. */
  readonly onInvalidChange: (invalid: boolean) => void;
}
