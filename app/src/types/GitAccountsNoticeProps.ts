export interface GitAccountsNoticeProps {
  /** The tools have answered (or failed to): until then, a spinner says they are being asked. */
  readonly loaded: boolean;
  /** No account is signed in. */
  readonly empty: boolean;
  /** What to say once loaded when no account is signed in; null when the caller shows something else in its place. */
  readonly emptyText: string | null;
  /** One line each: a tool that could not answer, a list that could not be read. */
  readonly problems: readonly string[];
}
