import type { JsonValue } from "@shared/types/JsonValue";

/** What a result editor starts from and reports its edits to. */
export interface UseMergeValueDraftOptions {
  /** The text the merge would write now, as the draft starts from it. */
  readonly shown: string;
  /** Whether the field is text, in which case the text is the value. */
  readonly textValue: boolean;
  readonly onChange: (value: JsonValue) => void;
  readonly onClear: () => void;
  /** Whether the draft currently parses, so closing can ask before losing it. */
  readonly onInvalidChange: (invalid: boolean) => void;
}
