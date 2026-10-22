import type { WorkspaceGitCommit } from "./WorkspaceGitCommit"
import type { WorkspaceGitError } from "./WorkspaceGitError"
import type { WorkspaceGitMode } from "./WorkspaceGitMode"
import type { WorkspaceGitState } from "./WorkspaceGitState"

/** A workspace's version history, as `__APIWEAVE_GIT__` reports it. An untracked workspace is `tracked: false` with the defaults a track would start from. */
export interface WorkspaceGitStatus {
  readonly workspaceId: string
  readonly tracked: boolean
  readonly mode: WorkspaceGitMode
  /** The remote the workspace is connected to; null while its history is local only. */
  readonly remoteUrl: string | null
  /** The branch the workspace's history lives on, locally and on the remote. */
  readonly branch: string
  readonly state: WorkspaceGitState
  /** The last cycle's failure; null once a cycle succeeds. `identity_missing` asks the user who the author is. */
  readonly lastError: WorkspaceGitError | null
  /** The host refused this user's pushes: commits stay local until one succeeds. */
  readonly readOnly: boolean
  /** Commits the remote's branch has that this workspace does not; 0 while there is no remote. */
  readonly incoming: number
  /** Commits this workspace has that the remote's branch does not; 0 while there is no remote. */
  readonly outgoing: number
  /**
   * The database holds an edit the repository's last commit does not. Cheap and
   * correct across restarts, but a flag, not a count: how many records changed
   * is what `pendingChanges` reads, because it takes serializing the workspace.
   */
  readonly uncommitted: boolean
  /** When the workspace and its remote last agreed (an ISO timestamp); null while they never have, or there is no remote. */
  readonly lastSyncedAt: string | null
  /** HEAD of the workspace's repository; null when untracked or before the first commit. */
  readonly lastCommit: WorkspaceGitCommit | null
}
