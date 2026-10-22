import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
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
  /** Open the picker for a merge that stopped on conflicts. */
  readonly askToResolveMerge: () => void;
  readonly askToDiscard: () => void;
  /** Commit what is pending under `message` (empty: the generated one), and sync. */
  readonly commit: (message: string) => void;
  readonly discard: () => void;
  /**
   * A status a dialog's own call resolved, so the header changes at once
   * instead of waiting for the announcement that carries the same status.
   */
  readonly updateStatus: (next: WorkspaceGitStatus) => void;
  readonly closeDialog: () => void;
}
