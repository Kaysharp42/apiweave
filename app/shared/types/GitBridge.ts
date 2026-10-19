import type { WorkspaceGitCommitRequest } from "./WorkspaceGitCommitRequest"
import type { WorkspaceGitMode } from "./WorkspaceGitMode"
import type { WorkspaceGitStatus } from "./WorkspaceGitStatus"

/**
 * The `window.__APIWEAVE_GIT__` contract: a workspace's version history.
 * Off the IPC router, so no local agent can reach it over MCP — git writes
 * files and, once a remote is connected, decides where the workspace is pushed.
 * Every call resolves to the workspace's status after it.
 */
export interface GitBridge {
  readonly status: (workspaceId: string) => Promise<WorkspaceGitStatus>
  /** Like `syncNow`, a missing author resolves: the workspace is tracked, and its status asks for one. */
  readonly track: (workspaceId: string) => Promise<WorkspaceGitStatus>
  readonly untrack: (workspaceId: string) => Promise<WorkspaceGitStatus>
  readonly setMode: (workspaceId: string, mode: WorkspaceGitMode) => Promise<WorkspaceGitStatus>
  /**
   * Commit what changed; the app never pushes or pulls on a commit. A missing
   * author resolves rather than rejects: the status's `lastError` is
   * `identity_missing`, and the retry passes `request.identity`.
   */
  readonly syncNow: (workspaceId: string, request?: WorkspaceGitCommitRequest) => Promise<WorkspaceGitStatus>
  readonly onStatusChanged: (callback: (status: WorkspaceGitStatus) => void) => () => void
  /**
   * Bind the workspace to a remote: a repository with no branches receives its
   * history, one that already holds this workspace's history is joined as it
   * is, and anything else is refused. Rejects, and leaves the workspace unbound, when
   * the URL is not an accepted form or the remote cannot be reached.
   */
  readonly connectRemote: (workspaceId: string, url: string) => Promise<WorkspaceGitStatus>
  /** Remove the connection. Every local commit stays; nothing on the remote is touched. */
  readonly disconnectRemote: (workspaceId: string) => Promise<WorkspaceGitStatus>
}
