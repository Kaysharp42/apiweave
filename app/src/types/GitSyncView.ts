import type { GitSyncIndicator } from "./GitSyncIndicator";

/** A workspace's sync status as the header control and the settings panel say it. */
export interface GitSyncView extends GitSyncIndicator {
  /** What it means and what to do about it. */
  readonly explanation: string;
  /** Git's own words for a failure, as detail under the explanation; null when there are none to add. */
  readonly detail: string | null;
  /** The failure is a missing git author, which only the settings panel's form can settle. */
  readonly needsAuthor: boolean;
}
