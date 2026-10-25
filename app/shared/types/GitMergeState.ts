import type { GitMergeConflict } from "./GitMergeConflict"
import type { GitMergeNote } from "./GitMergeNote"
import type { GitMergePick } from "./GitMergePick"

/**
 * A waiting merge as the view reads it in one call: every conflict it has,
 * computed with no picks, so the list does not shrink as decisions are made;
 * the decisions stored so far; and what the merge settles by itself with the
 * picks the read was asked about (the stored set when it was asked about none).
 */
export interface GitMergeState {
  readonly conflicts: readonly GitMergeConflict[]
  readonly picks: readonly GitMergePick[]
  readonly notes: readonly GitMergeNote[]
}
