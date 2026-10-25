import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { MergeRecordCommits } from "@shared/types/MergeRecordCommits";
import type { MergeConflictGroup } from "./MergeConflictGroup";
import type { MergeFieldCallbacks } from "./MergeFieldCallbacks";

/** The selected record or file in the merge view: who wrote each copy, and one row per conflicted field. */
export interface MergeItemPaneProps extends MergeFieldCallbacks {
  readonly group: MergeConflictGroup;
  /** Every decision so far, so each row shows what settles it. */
  readonly picks: ReadonlyMap<string, GitMergePick>;
  readonly commits: MergeRecordCommits | undefined;
  /** Whether the authors cannot be shown: the read failed, or this record is past the count it covers. */
  readonly commitDetailsUnavailable: boolean;
  readonly disabled: boolean;
  readonly onAcceptItem: (side: GitMergeSide) => void;
}
