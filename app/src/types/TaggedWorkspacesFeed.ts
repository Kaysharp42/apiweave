import type { GitRepository } from "@shared/types/GitRepository";
import type { TaggedWorkspaceOutcome } from "./TaggedWorkspaceOutcome";

/**
 * The workspaces a signed-in account keeps in its `apiweave-workspace`
 * repositories that are not here yet, which of them the user has ticked, and
 * how opening each went. Keyed by the repository's `fullName`.
 */
export interface TaggedWorkspacesFeed {
  readonly loading: boolean;
  /** Why the repositories could not be listed, or null. */
  readonly failure: string | null;
  readonly repositories: readonly GitRepository[];
  /** The host's own list problems: an owner it could not list, a list cut at its cap. */
  readonly problems: readonly string[];
  readonly selected: ReadonlySet<string>;
  readonly toggle: (fullName: string, checked: boolean) => void;
  readonly outcomes: ReadonlyMap<string, TaggedWorkspaceOutcome>;
  /** The repository being opened now, or null. */
  readonly opening: string | null;
  /** Every ticked repository has been tried. */
  readonly finished: boolean;
  /** Open the ticked repositories, one at a time. */
  readonly openSelected: () => Promise<void>;
}
