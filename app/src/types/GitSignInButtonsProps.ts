import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitProvider } from "@shared/types/GitProvider";

export interface GitSignInButtonsProps {
  /** Told the account once its sign-in is done. */
  readonly onSignedIn: (account: GitAccountRef) => void;
  /** The host each sign-in starts on; the provider's own (github.com, gitlab.com) when not given. */
  readonly hostFor?: (provider: GitProvider) => string;
  readonly disabled?: boolean;
}
