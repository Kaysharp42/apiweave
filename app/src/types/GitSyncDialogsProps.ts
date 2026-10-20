import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { GitSyncActions } from "./GitSyncActions";

export interface GitSyncDialogsProps {
  readonly status: WorkspaceGitStatus;
  readonly actions: GitSyncActions;
}
