import type { GitProvider } from "./GitProvider"

/**
 * Which signed-in account to act as: the provider's CLI, the host it signed in
 * to, and the user name there. Never a token — `gh` and `glab` keep those, and
 * APIWeave asks them for one per operation.
 */
export interface GitAccountRef {
  readonly provider: GitProvider
  /** `github.com`, `gitlab.com`, or a self-hosted instance's host name. */
  readonly host: string
  readonly login: string
}
