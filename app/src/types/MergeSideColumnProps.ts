import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { JsonValue } from "@shared/types/JsonValue";

/** One side's column in a conflicted field: its heading, its value, and (when the columns are stacked) its choice. */
export interface MergeSideColumnProps {
  readonly side: GitMergeSide;
  /** The field and its record, for the control's name. */
  readonly label: string;
  readonly value: JsonValue | undefined;
  readonly chosen: boolean;
  /** Whether the five columns sit side by side; below that the choice is a labelled button here. */
  readonly wide: boolean;
  readonly disabled: boolean;
  readonly onChoose: () => void;
}
