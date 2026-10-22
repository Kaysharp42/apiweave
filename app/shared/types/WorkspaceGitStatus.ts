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
  /** HEAD of the workspace's repository; null when untracked or before the first commit. */
  readonly lastCommit: WorkspaceGitCommit | null
}
