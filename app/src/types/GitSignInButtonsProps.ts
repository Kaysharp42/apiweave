import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitHostCli } from "@shared/types/GitHostCli";
import type { GitProvider } from "@shared/types/GitProvider";

export interface GitSignInButtonsProps {
  /** Told the account once its sign-in is done. */
  readonly onSignedIn: (account: GitAccountRef) => void;
  /** Each tool's state, once listed: a tool that is not installed offers no sign-in, and both missing say how to install them. */
  readonly clis?: readonly GitHostCli[];
  /** The host each sign-in starts on; the provider's own (github.com, gitlab.com) when not given. */
  readonly hostFor?: (provider: GitProvider) => string;
  readonly disabled?: boolean;
}
