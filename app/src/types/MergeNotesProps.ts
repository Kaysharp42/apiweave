import type { GitMergeNote } from "@shared/types/GitMergeNote";

/** What the merge settled by itself, collapsed above the conflicts. */
export interface MergeNotesProps {
  readonly notes: readonly GitMergeNote[];
}
