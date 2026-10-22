import type { OpenWorkspaceFromGitResult } from "./OpenWorkspaceFromGitResult"
import type { WorkspaceGitCommitRequest } from "./WorkspaceGitCommitRequest"
import type { WorkspaceGitMode } from "./WorkspaceGitMode"
import type { WorkspaceGitStatus } from "./WorkspaceGitStatus"
import type { WorkspacePendingChange } from "./WorkspacePendingChange"

/**
 * The `window.__APIWEAVE_GIT__` contract: a workspace's version history.
 * Off the IPC router, so no local agent can reach it over MCP — git writes
 * files and, once a remote is connected, decides where the workspace is pushed.
 * Every call but `openFromGit` resolves to the workspace's status after it.
 */
export interface GitBridge {
  readonly status: (workspaceId: string) => Promise<WorkspaceGitStatus>
  /** Like `syncNow`, a missing author resolves: the workspace is tracked, and its status asks for one. */
  readonly track: (workspaceId: string) => Promise<WorkspaceGitStatus>
  readonly untrack: (workspaceId: string) => Promise<WorkspaceGitStatus>
  readonly setMode: (workspaceId: string, mode: WorkspaceGitMode) => Promise<WorkspaceGitStatus>
  /**
   * Commit what changed and, with a remote, fetch, integrate and push. Resolves
   * to the status the cycle left behind: a missing author, a divergence, a
   * refused push, every other git failure and a remote tree that does not
   * import are that status's `state` and `lastError`, not a rejection. It
   * rejects for an id that is not a workspace id, an untracked workspace, and
   * an unexpected failure. The retry that names an author passes
   * `request.identity`.
   */
  readonly syncNow: (workspaceId: string, request?: WorkspaceGitCommitRequest) => Promise<WorkspaceGitStatus>
  /**
   * What the next commit would add, change or delete, as records with their
   * names. Rejects for an untracked workspace. Read-only for the workspace's
   * history: nothing is committed, and the status does not change.
   */
  readonly pendingChanges: (workspaceId: string) => Promise<readonly WorkspacePendingChange[]>
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
  /**
   * Reset the workspace to the remote's branch and re-import it, throwing away
   * every local commit and uncommitted change. The remote is fetched first.
   * Rejects when the workspace has no remote, the remote has no branch for it
   * yet, the fetch fails, or the remote's tree does not import — in the last
   * case the workspace is left as it was.
   */
  readonly discardLocalChanges: (workspaceId: string) => Promise<WorkspaceGitStatus>
  /**
   * Clone the repository at `url` and open the workspace it holds, tracked in
   * auto mode and bound to that remote. Resolves `duplicate`, creating
   * nothing, when the repository's workspace is already in this app; `opened`
   * carries the import's warnings for the caller to show before switching.
   * Rejects, and leaves nothing behind, when the URL is not an accepted form,
   * the repository cannot be reached, or it is not an APIWeave workspace.
   */
  readonly openFromGit: (url: string) => Promise<OpenWorkspaceFromGitResult>
}
