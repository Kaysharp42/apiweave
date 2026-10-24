import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitProvider } from "@shared/types/GitProvider";

export interface GitAccountsMenuPanelProps {
  /** The id of the panel's title, which labels the popover. */
  readonly titleId: string;
  /** The account the current workspace reaches its remote as; null when it has none. */
  readonly current: GitAccountRef | null;
  /** Sign in to another account with the provider's tool. */
  readonly onAdd: (provider: GitProvider) => void;
  readonly onOpenSettings: () => void;
  /** Go to the current workspace's version history to track it or connect it; null when it already syncs with a remote. */
  readonly onSetUpSync: (() => void) | null;
}
