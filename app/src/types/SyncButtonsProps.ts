import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { GitSyncActions } from "./GitSyncActions";
import type { GitSyncView } from "./GitSyncView";

export interface SyncButtonsProps {
  readonly status: WorkspaceGitStatus;
  readonly view: GitSyncView;
  readonly offerDiscard: boolean;
  readonly actions: GitSyncActions;
}
