import type { GitRepositoryOwner } from "@shared/types/GitRepositoryOwner";

/** Where an account can create a repository, as `useGitRepositoryOwners` reads it. */
export interface GitRepositoryOwnersFeed {
  readonly owners: readonly GitRepositoryOwner[];
  /** Why the list is short or empty: organizations or groups that could not be listed, or the account that could not be asked at all. */
  readonly problem: string | null;
  readonly loading: boolean;
}
