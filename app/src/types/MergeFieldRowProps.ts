import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { JsonValue } from "@shared/types/JsonValue";

/** One conflicted field in the merge view: both copies, the result, and the ways to settle it. */
export interface MergeFieldRowProps {
  readonly conflict: GitMergeConflict;
  /** The conflicted record's (or file's) name, so every control names where it acts. */
  readonly recordName: string;
  /** What settles it now, exactly or from a whole-record pick above it. */
  readonly resolution: GitMergePick | undefined;
  readonly disabled: boolean;
  /** Called when anything in the row takes focus, so Next/Previous knows where the user is. */
  readonly onFocus: () => void;
  readonly onSide: (side: GitMergeSide) => void;
  readonly onValue: (value: JsonValue) => void;
  /** Empty or unparseable text: this field decides nothing again. */
  readonly onClear: () => void;
  /** Whether the result's text parses, so closing can ask before losing it. */
  readonly onInvalidChange: (invalid: boolean) => void;
}
