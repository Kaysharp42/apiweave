import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { MergeRecordCommits } from "@shared/types/MergeRecordCommits";
import type { MergeConflictGroup } from "./MergeConflictGroup";

/** One conflicted record or file in the merge picker: its conflicts, its sides' commits, and its choices. */
export interface GitMergeRecordProps {
  readonly group: MergeConflictGroup;
  /** Each listed conflict's chosen copy, keyed by `pickKey`. */
  readonly picks: ReadonlyMap<string, GitMergeSide>;
  /** The commits both sides last made to this record; undefined until they arrive. */
  readonly commits: MergeRecordCommits | undefined;
  /** The commits could not be read: say so in place of the authors, and keep the choices usable. */
  readonly commitDetailsFailed: boolean;
  readonly disabled: boolean;
  readonly onWholeRecord: (side: GitMergeSide) => void;
  readonly onPath: (path: string, side: GitMergeSide) => void;
}
