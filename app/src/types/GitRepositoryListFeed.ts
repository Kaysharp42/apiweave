import type { GitRepository } from "@shared/types/GitRepository";

/** An account's repositories, as `useGitRepositoryList` reads and caches them. */
export interface GitRepositoryListFeed {
  readonly repositories: readonly GitRepository[];
  /** One line per owner that could not be listed, list cut at its cap, or the list that could not be read at all. */
  readonly problems: readonly string[];
  /** The list could not be read at all, as against read and empty. */
  readonly failed: boolean;
  readonly loading: boolean;
  /** Ask the host again, past the cache. */
  readonly refresh: () => void;
}
