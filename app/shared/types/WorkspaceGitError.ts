import type { GitErrorCode } from "./GitErrorCode"

/** Why a workspace's last sync cycle failed. `code` is null for a failure that is not git's (a record the format refused). */
export interface WorkspaceGitError {
  readonly code: GitErrorCode | null
  readonly message: string
}
