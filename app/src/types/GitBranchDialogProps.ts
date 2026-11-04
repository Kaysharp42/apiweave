import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";

export interface GitBranchDialogProps {
  readonly workspaceId: string;
  /** The branch the workspace is on now; it is not offered as a switch target. */
  readonly currentBranch: string;
  readonly onClose: () => void;
  /** The status the switch left behind, for the panel to show. */
  readonly onSwitched: (status: WorkspaceGitStatus) => void;
}
