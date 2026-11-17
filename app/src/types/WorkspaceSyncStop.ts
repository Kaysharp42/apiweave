import type { UnfinishedWorkspaceSync } from "./UnfinishedWorkspaceSync";
import type { WorkspaceSyncTarget } from "./WorkspaceSyncTarget";

/** Where a new workspace's sync stopped, if it did. */
export interface WorkspaceSyncStop {
  /** A workspace whose sync waits for git to be told who makes its commits. */
  readonly awaitingAuthor: WorkspaceSyncTarget | null;
  /** A workspace whose sync stopped: what to say, and Version history to finish it. */
  readonly unfinished: UnfinishedWorkspaceSync | null;
  /** Why the author just given did not do. */
  readonly authorError: string | null;
}
