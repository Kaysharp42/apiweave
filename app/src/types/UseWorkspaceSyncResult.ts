import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import type { GitRepositoryDraft } from "./GitRepositoryDraft";
import type { WorkspaceSyncResult } from "./WorkspaceSyncResult";
import type { WorkspaceSyncStop } from "./WorkspaceSyncStop";
import type { WorkspaceSyncTarget } from "./WorkspaceSyncTarget";

export interface UseWorkspaceSyncResult extends WorkspaceSyncStop {
  /** The repository to create: named after the workspace until its name is edited. */
  readonly draft: GitRepositoryDraft;
  readonly changeDraft: (draft: GitRepositoryDraft) => void;
  /** Track the workspace, create the draft's repository and connect to it. */
  readonly sync: (target: WorkspaceSyncTarget) => Promise<WorkspaceSyncResult>;
  /** Carry on a sync that waits for its author, as `request.identity`. */
  readonly commitAsAuthor: (request: WorkspaceGitCommitRequest) => Promise<WorkspaceSyncResult>;
  /** Go to the unfinished workspace's Version history, with the repository it was to be given. */
  readonly openVersionHistory: () => void;
  /** Forget everything: the draft, and any stop. */
  readonly reset: () => void;
}
