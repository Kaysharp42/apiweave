/** The text a result editor holds for a value, and the decision its edits come to. */
export interface MergeValueDraft {
  readonly text: string;
  /** Why the text is not a value, or null when it is one (or empty). */
  readonly error: string | null;
  readonly commit: (text: string) => void;
}
