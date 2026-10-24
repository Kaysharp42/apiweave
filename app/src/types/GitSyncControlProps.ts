import type { WorkspaceGitStatusFeed } from "./WorkspaceGitStatusFeed";

export interface GitSyncControlProps {
  /** The current workspace's status, as `useWorkspaceGitStatus` follows it. */
  readonly feed: WorkspaceGitStatusFeed;
}
