import type { GitAccount } from "@shared/types/GitAccount";
import type { GitRepository } from "@shared/types/GitRepository";
import type { GitRepositoryListFeed } from "./GitRepositoryListFeed";

export interface GitRepositoryFieldProps {
  /** `connect`: empty repositories, with Create repository… first. `open`: tagged ones, with Show all repositories. */
  readonly mode: "connect" | "open";
  /** The account whose list this is. */
  readonly account: GitAccount;
  readonly list: GitRepositoryListFeed;
  /** The chosen repository's `fullName`; empty while none is. */
  readonly picked: string;
  readonly onPick: (repository: GitRepository | null) => void;
  /** `connect` only: Create repository… was chosen. */
  readonly onCreateRepository?: (account: GitAccount) => void;
  /** `open` only: the list holds every repository, not just the tagged ones. */
  readonly showAll: boolean;
  readonly onToggleShowAll: () => void;
  readonly onUseUrl: () => void;
  readonly disabled: boolean;
}
