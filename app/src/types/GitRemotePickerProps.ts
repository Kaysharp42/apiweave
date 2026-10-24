import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountsFeed } from "./GitAccountsFeed";
import type { GitRemoteSelection } from "./GitRemoteSelection";

export interface GitRemotePickerProps {
  /**
   * `connect`: an account's empty repositories it can push to, with Create
   * repository… above them. `open`: its `apiweave-workspace` repositories,
   * with a switch to show all.
   */
  readonly mode: "connect" | "open";
  /** What the picker starts on: a URL to fill in, and the account it goes with. */
  readonly initial: GitRemoteSelection | null;
  /** Told the remote whenever the choice changes; null while there is none. */
  readonly onChange: (selection: GitRemoteSelection | null) => void;
  /** The accounts, held by the dialog so a sign-in anywhere in it is seen here. */
  readonly accounts: GitAccountsFeed;
  /** `connect` only: the user chose Create repository… for this account. */
  readonly onCreateRepository?: (account: GitAccount) => void;
  readonly disabled?: boolean;
}
