import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";

export interface GitAuthorFormProps {
  readonly busy: boolean;
  /** Resolves whether the commit went through. */
  readonly onCommit: (request: WorkspaceGitCommitRequest) => Promise<boolean>;
}
