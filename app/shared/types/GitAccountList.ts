import type { GitAccount } from "./GitAccount"
import type { GitHostCli } from "./GitHostCli"

/** Every account `gh` and `glab` are signed in to, and the state of each tool: a missing tool lists no accounts rather than failing. */
export interface GitAccountList {
  readonly clis: readonly GitHostCli[]
  readonly accounts: readonly GitAccount[]
}
