import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";

/** The merge picker, opened for a workspace that stopped at `merging`. */
export interface GitMergeDialogProps {
  readonly status: WorkspaceGitStatus;
  readonly onClose: () => void;
  /** The status a resolve or an abandon left, so the header changes without waiting for the announcement. */
  readonly onStatus: (next: WorkspaceGitStatus) => void;
}
