import type { GitMergeSide } from "@shared/types/GitMergeSide";

/** One whole-record choice on a conflicted record: which copy it settles, and whether it is the chosen one. */
export interface GitMergeWholeButtonProps {
  readonly label: string;
  /** The record or file's name, so the button says which card it belongs to. */
  readonly name: string;
  readonly side: GitMergeSide;
  readonly chosen: GitMergeSide | undefined;
  readonly disabled: boolean;
  readonly onChoose: (side: GitMergeSide) => void;
}
