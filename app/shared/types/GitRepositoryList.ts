import type { GitRepository } from "./GitRepository"

/**
 * The repositories an account can see, as one picker lists them. `problems`
 * says, one line each, which owner could not be listed and why, and where a
 * list stops at its cap: a short list must never look like the whole one.
 */
export interface GitRepositoryList {
  readonly repositories: readonly GitRepository[]
  readonly problems: readonly string[]
}
