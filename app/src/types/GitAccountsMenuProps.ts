import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";

export interface GitAccountsMenuProps {
  /** The current workspace's git status, for its account and its sync badge; null while it loads or with no workspace. */
  readonly status: WorkspaceGitStatus | null;
}
