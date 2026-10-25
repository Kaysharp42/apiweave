import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitRepository } from "@shared/types/GitRepository";
import type { GitHostCli } from "@shared/types/GitHostCli";
import type { GitRepositoryListFeed } from "./GitRepositoryListFeed";

/** What `GitRemotePicker` shows and what its controls do, as `useGitRemotePicker` keeps them. */
export interface GitRemotePickerState {
  readonly accounts: readonly GitAccount[];
  /** Each tool's state, so a sign-in is offered only with the tool that runs it. */
  readonly clis: readonly GitHostCli[];
  readonly loaded: boolean;
  /** Why the accounts, or the shown account's repositories, could not all be listed. */
  readonly problems: readonly string[];
  /** The shown account's `gitAccountKey`, or the empty string for another host. */
  readonly accountKey: string;
  /** The shown account; null for another host. */
  readonly account: GitAccount | null;
  /** The account whose list is shown; null while the URL field stands in. */
  readonly listedAccount: GitAccount | null;
  readonly list: GitRepositoryListFeed;
  readonly picked: GitRepository | null;
  readonly url: string;
  readonly showAll: boolean;
  readonly chooseAccount: (key: string) => void;
  readonly signedIn: (account: GitAccountRef) => void;
  readonly pick: (repository: GitRepository | null) => void;
  readonly setUrl: (url: string) => void;
  readonly toggleShowAll: () => void;
  /** Show the URL field (true) or the account's list (false). */
  readonly showUrlField: (on: boolean) => void;
}
