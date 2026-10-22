import type { GitAccountRef } from "./GitAccountRef"
import type { GitProtocol } from "./GitProtocol"

/** An account `gh` or `glab` is signed in to, as its own status command reports it. */
export interface GitAccount extends GitAccountRef {
  readonly gitProtocol: GitProtocol
  /** The account the CLI uses on its host when none is named. `glab` keeps one per host, so its account always is. */
  readonly active: boolean
  /** Why the CLI could not use the account just now (an expired or revoked token, no network); null when it can. */
  readonly problem: string | null
}
