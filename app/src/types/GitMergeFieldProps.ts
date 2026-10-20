import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergeSide } from "@shared/types/GitMergeSide";

/** One conflicted field: both copies' values, and the choice between them. */
export interface GitMergeFieldProps {
  readonly conflict: GitMergeConflict;
  /** The copy settled for this field, by its own pick or its record's. */
  readonly selected: GitMergeSide | undefined;
  readonly disabled: boolean;
  readonly onPick: (side: GitMergeSide) => void;
}
