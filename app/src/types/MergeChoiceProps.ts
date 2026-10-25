import type { GitMergeSide } from "@shared/types/GitMergeSide";

/** One side's choice for one field, as an arrow between the columns or a labelled button under the copy. */
export interface MergeChoiceProps {
  readonly side: GitMergeSide;
  readonly label: string;
  readonly chosen: boolean;
  readonly disabled: boolean;
  readonly onChoose: () => void;
}
