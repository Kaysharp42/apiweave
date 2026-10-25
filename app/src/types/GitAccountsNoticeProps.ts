export interface GitAccountsNoticeProps {
  /** The tools have answered (or failed to): until then, a spinner says they are being asked. */
  readonly loaded: boolean;
  /** No account is signed in; `emptyText` says so once loaded. */
  readonly empty: boolean;
  readonly emptyText: string;
  /** One line each: a tool that could not answer, a list that could not be read. */
  readonly problems: readonly string[];
}
