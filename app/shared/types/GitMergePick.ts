import type { GitMergeSidePick } from "./GitMergeSidePick"
import type { GitMergeValuePick } from "./GitMergeValuePick"

/**
 * What settles one conflict: one copy's value (a {@link GitMergeSidePick}), or
 * a value of the user's own (a {@link GitMergeValuePick}), told apart by
 * whether it carries `side` or `value`. The resolve request and the merge row
 * hold these alike; the conflicts themselves are recomputed from them.
 */
export type GitMergePick = GitMergeSidePick | GitMergeValuePick
