import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitAccountsFeed } from "./GitAccountsFeed";
import type { GitRemoteSelection } from "./GitRemoteSelection";

export interface RemoteSectionProps {
  readonly remoteUrl: string | null;
  readonly branch: string;
  readonly account: GitAccountRef | null;
  readonly busy: boolean;
  /** What the connect form starts with: a repository just created that could not be connected to. */
  readonly prefill: GitRemoteSelection | null;
  readonly onConnect: (url: string, account: GitAccountRef | null) => void;
  readonly onCreateRepository: (account: GitAccount) => void;
  readonly onChangeAccount: (account: GitAccountRef | null) => void;
  readonly onDisconnect: () => void;
  /** The accounts, held by the panel so a sign-in anywhere on it is seen everywhere. */
  readonly accounts: GitAccountsFeed;
}
