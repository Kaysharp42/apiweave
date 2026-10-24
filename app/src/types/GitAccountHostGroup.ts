import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitProvider } from "@shared/types/GitProvider";

/** The accounts signed in to one host with one provider's tool, as the accounts menu and Settings > Git accounts list them. */
export interface GitAccountHostGroup {
  readonly provider: GitProvider;
  readonly host: string;
  readonly accounts: readonly GitAccount[];
  /** A workspace's account on this host that no tool lists any more; null when there is none. */
  readonly signedOut: GitAccountRef | null;
}
