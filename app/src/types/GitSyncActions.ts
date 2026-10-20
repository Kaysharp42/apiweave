import type { GitSyncDialog } from "./GitSyncDialog";

/** The sync actions of one workspace, shared by the header control and the settings panel. */
export interface GitSyncActions {
  readonly busy: boolean;
  /** The last action's failure, as the bridge worded it. */
  readonly error: string | null;
  readonly dialog: GitSyncDialog | null;
  /**
   * Sync now, and Retry after a failure: the same action. In manual mode with
   * edits waiting it asks for a commit message first.
   */
  readonly sync: () => void;
  readonly askToDiscard: () => void;
  /** Commit what is pending under `message` (empty: the generated one), and sync. */
  readonly commit: (message: string) => void;
  readonly discard: () => void;
  readonly closeDialog: () => void;
}
