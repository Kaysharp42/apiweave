import type { MergeSideCommit } from "./MergeSideCommit"

/**
 * The commits both sides last made to one conflicted record, so the merge
 * picker can name who wrote each copy. A side that does not hold the record —
 * it deleted it, or never had it — has no commit: null.
 */
export interface MergeRecordCommits {
  /** The conflict's record id; for a `file` conflict, its path. */
  readonly recordId: string
  /** Your copy's commit: this device's side of the merge. */
  readonly ours: MergeSideCommit | null
  /** The remote copy's commit. */
  readonly theirs: MergeSideCommit | null
}
