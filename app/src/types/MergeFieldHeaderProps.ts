/** The heading above one conflicted field: where it is, whether a decision settles it, and why a record cannot be written. */
export interface MergeFieldHeaderProps {
  readonly heading: string;
  readonly resolved: boolean;
  /** Set on a conflict whose merged fields do not make a valid record together. */
  readonly invalid: string | undefined;
}
