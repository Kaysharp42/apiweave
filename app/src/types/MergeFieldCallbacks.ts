import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { JsonValue } from "@shared/types/JsonValue";

/** What a field row asks the view to do, passed down unchanged by the pane and body. */
export interface MergeFieldCallbacks {
  readonly onSide: (path: string, side: GitMergeSide) => void;
  readonly onValue: (path: string, value: JsonValue) => void;
  readonly onClear: (path: string) => void;
  readonly onInvalidChange: (path: string, invalid: boolean) => void;
  readonly onFocus: (conflict: GitMergeConflict) => void;
}
