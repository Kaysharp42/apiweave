import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";

/** What `useWorkspaceGitStatus` hands back for the workspace it was asked about. */
export interface WorkspaceGitStatusFeed {
  /** Null while loading, when the bridge is missing, or when the load failed. */
  readonly status: WorkspaceGitStatus | null;
  /** Why the first load failed. */
  readonly error: string | null;
  /** Take a status a call resolved with, ahead of the push that announces the same one. */
  readonly apply: (status: WorkspaceGitStatus) => void;
}
