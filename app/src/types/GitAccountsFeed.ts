import type { GitAccount } from "@shared/types/GitAccount";
import type { GitHostCli } from "@shared/types/GitHostCli";

/**
 * What `gh` and `glab` are signed in to, as `useGitAccounts` reads it: held
 * once by a dialog's owner and handed to every part of it, so a sign-in made
 * in one place is seen by the others.
 */
export interface GitAccountsFeed {
  readonly accounts: readonly GitAccount[];
  readonly clis: readonly GitHostCli[];
  /** One line each: a tool's own problem, and a list that could not be read at all. */
  readonly problems: readonly string[];
  /** Why the list could not be read at all; null when it could. */
  readonly failure: string | null;
  /** The tools have answered at least once. */
  readonly loaded: boolean;
  /** An ask, a reload's included, is under way. */
  readonly loading: boolean;
  readonly reload: () => void;
}
