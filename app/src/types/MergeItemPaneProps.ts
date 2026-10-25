import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { JsonValue } from "@shared/types/JsonValue";
import type { MergeRecordCommits } from "@shared/types/MergeRecordCommits";
import type { MergeConflictGroup } from "./MergeConflictGroup";

/** The selected record or file in the merge view: who wrote each copy, and one row per conflicted field. */
export interface MergeItemPaneProps {
  readonly group: MergeConflictGroup;
  /** Every decision so far, so each row shows what settles it. */
  readonly picks: ReadonlyMap<string, GitMergePick>;
  readonly commits: MergeRecordCommits | undefined;
  readonly commitDetailsFailed: boolean;
  readonly disabled: boolean;
  readonly onAcceptItem: (side: GitMergeSide) => void;
  readonly onSide: (path: string, side: GitMergeSide) => void;
  readonly onValue: (path: string, value: JsonValue) => void;
  readonly onFocus: (conflict: GitMergeConflict) => void;
}
