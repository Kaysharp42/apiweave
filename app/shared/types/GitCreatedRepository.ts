import type { GitRepository } from "./GitRepository"

/**
 * A repository just created, empty. `problem` is a step after the creation
 * that did not happen — tagging it `apiweave-workspace` — which leaves the
 * repository usable, so it is said rather than thrown.
 */
export interface GitCreatedRepository {
  readonly repository: GitRepository
  readonly problem: string | null
}
