import type { GitRepositoryOwner } from "./GitRepositoryOwner"

/** Where an account can create a repository. The account itself is always there; `problem` says why its organizations or groups could not be listed. */
export interface GitRepositoryOwnerList {
  readonly owners: readonly GitRepositoryOwner[]
  readonly problem: string | null
}
