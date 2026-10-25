import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { GitMergeNote } from "@shared/types/GitMergeNote";
import type { GitMergeSide } from "@shared/types/GitMergeSide";

/** The merge view's header: what is being merged, how far it has come, and the bulk choices. */
export interface MergeViewHeaderProps {
  readonly status: WorkspaceGitStatus;
  readonly resolved: number;
  readonly total: number;
  readonly notes: readonly GitMergeNote[];
  readonly error: string | null;
  readonly disabled: boolean;
  /** Whether there is anything to accept all of. */
  readonly canAcceptAll: boolean;
  readonly onAcceptAll: (side: GitMergeSide) => void;
}
