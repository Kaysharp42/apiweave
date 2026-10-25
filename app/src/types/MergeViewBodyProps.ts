import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { JsonValue } from "@shared/types/JsonValue";
import type { MergeRecordCommits } from "@shared/types/MergeRecordCommits";
import type { MergeConflictGroup } from "./MergeConflictGroup";

/** The merge view's main area: the conflict inventory and the selected item's fields. */
export interface MergeViewBodyProps {
  /** Null until the first read lands. */
  readonly conflicts: readonly GitMergeConflict[] | null;
  readonly groups: readonly MergeConflictGroup[];
  readonly selected: MergeConflictGroup | undefined;
  readonly picks: ReadonlyMap<string, GitMergePick>;
  readonly commits: ReadonlyMap<string, MergeRecordCommits>;
  readonly commitDetailsFailed: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSelect: (group: MergeConflictGroup) => void;
  readonly onAcceptItem: (side: GitMergeSide) => void;
  readonly onSide: (path: string, side: GitMergeSide) => void;
  readonly onValue: (path: string, value: JsonValue) => void;
  readonly onFocus: (conflict: GitMergeConflict) => void;
}
