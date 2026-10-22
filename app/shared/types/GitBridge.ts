import type { WorkspaceGitCommitRequest } from "./WorkspaceGitCommitRequest"
import type { WorkspaceGitMode } from "./WorkspaceGitMode"
import type { WorkspaceGitStatus } from "./WorkspaceGitStatus"

/**
 * The `window.__APIWEAVE_GIT__` contract: a workspace's version history.
 * Off the IPC router, so no local agent can reach it over MCP — git writes
 * files and, once a remote is bound, decides where the workspace is pushed.
 * Every call resolves to the workspace's status after it.
 */
export interface GitBridge {
  readonly status: (workspaceId: string) => Promise<WorkspaceGitStatus>
  /** Like `syncNow`, a missing author resolves: the workspace is tracked, and its status asks for one. */
  readonly track: (workspaceId: string) => Promise<WorkspaceGitStatus>
  readonly untrack: (workspaceId: string) => Promise<WorkspaceGitStatus>
  readonly setMode: (workspaceId: string, mode: WorkspaceGitMode) => Promise<WorkspaceGitStatus>
  /**
   * Commit what changed. With no remote bound, that is the whole cycle. A
   * missing author resolves rather than rejects: the status's `lastError` is
   * `identity_missing`, and the retry passes `request.identity`.
   */
  readonly syncNow: (workspaceId: string, request?: WorkspaceGitCommitRequest) => Promise<WorkspaceGitStatus>
  readonly onStatusChanged: (callback: (status: WorkspaceGitStatus) => void) => () => void
}
