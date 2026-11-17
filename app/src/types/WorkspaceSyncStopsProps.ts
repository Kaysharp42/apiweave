import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import type { WorkspaceSyncStop } from "./WorkspaceSyncStop";

export interface WorkspaceSyncStopsProps {
  readonly sync: WorkspaceSyncStop;
  readonly busy: boolean;
  /** Carry on with the author given; true when the dialog is done. */
  readonly onCommitAuthor: (request: WorkspaceGitCommitRequest) => Promise<boolean>;
}
