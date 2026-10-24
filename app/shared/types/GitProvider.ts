/**
 * A git host APIWeave can sign in to through its own command-line tool:
 * `github` through `gh`, `gitlab` through `glab`.
 */
export type GitProvider = "github" | "gitlab"

/** Narrows an arbitrary value (an IPC argument, a stored column) back to a provider. */
export function isGitProvider(value: unknown): value is GitProvider {
  return value === "github" || value === "gitlab"
}
