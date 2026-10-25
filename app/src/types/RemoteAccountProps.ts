import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitAccountsFeed } from "./GitAccountsFeed";

export interface RemoteAccountProps {
  readonly remoteUrl: string;
  readonly value: GitAccountRef | null;
  readonly onChange: (account: GitAccountRef | null) => void;
  readonly busy: boolean;
  /** The accounts, held by the panel so a sign-in anywhere on it is seen everywhere. */
  readonly accounts: GitAccountsFeed;
}
