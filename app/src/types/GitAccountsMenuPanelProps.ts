import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitProvider } from "@shared/types/GitProvider";

export interface GitAccountsMenuPanelProps {
  /** The account the current workspace reaches its remote as; null when it has none. */
  readonly current: GitAccountRef | null;
  /** Sign in to another account with the provider's tool. */
  readonly onAdd: (provider: GitProvider) => void;
  readonly onOpenSettings: () => void;
}
