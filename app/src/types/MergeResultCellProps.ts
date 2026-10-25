import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { JsonValue } from "@shared/types/JsonValue";

/** The Result column of one conflicted field: what the merge would write, editable as a value of the user's own. */
export interface MergeResultCellProps {
  readonly conflict: GitMergeConflict;
  /** The field and its record, for the controls' names. */
  readonly label: string;
  readonly current: JsonValue | undefined;
  readonly resolution: GitMergePick | undefined;
  /** A whole-record or whole-file conflict, or an invalid one: only a copy settles it. */
  readonly sidesOnly: boolean;
  readonly disabled: boolean;
  readonly onValue: (value: JsonValue) => void;
  /** Empty or unparseable text: this field decides nothing again. */
  readonly onClear: () => void;
  readonly onInvalidChange: (invalid: boolean) => void;
}
