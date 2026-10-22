import type { GitMergeConflict } from "@shared/types/GitMergeConflict";

/** One record's (or file's) conflicts, in the merge's order: the picker shows one card per group. */
export interface MergeConflictGroup {
  readonly kind: GitMergeConflict["kind"];
  readonly recordId: string;
  /** The record's name, or a file's path. */
  readonly name: string;
  readonly conflicts: readonly GitMergeConflict[];
}
