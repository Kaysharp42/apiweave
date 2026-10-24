// fallow-ignore-file code-duplication -- a bridge interface is a list of parallel one-line method signatures; the run is the interface's shape, not shared behaviour to extract.
import type { GitAccountList } from "./GitAccountList"
import type { GitAccountRef } from "./GitAccountRef"
import type { GitCreatedRepository } from "./GitCreatedRepository"
import type { GitCreateRepositoryRequest } from "./GitCreateRepositoryRequest"
import type { GitProvider } from "./GitProvider"
import type { GitRepositoryOwnerList } from "./GitRepositoryOwnerList"
import type { GitSignInPrompt } from "./GitSignInPrompt"
import type { OpenWorkspaceFromGitResult } from "./OpenWorkspaceFromGitResult"
import type { GitMergeConflict } from "./GitMergeConflict"
import type { GitMergePick } from "./GitMergePick"
import type { MergeRecordCommits } from "./MergeRecordCommits"
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
  /**
   * Every tracked workspace's status, for the switcher's icon on each row; an
   * untracked workspace is not in the list. Read-only: nothing is committed or
   * fetched.
   */
  readonly statusAll: () => Promise<readonly WorkspaceGitStatus[]>
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
  /**
   * What a merge is waiting on: every place your copy and the remote copy
   * changed differently, recomputed from the merge's three commits and the
   * picks persisted so far. Empty when the workspace is not merging. Rejects
   * for an untracked workspace or one whose clone cannot be read.
   */
  readonly mergeConflicts: (workspaceId: string) => Promise<readonly GitMergeConflict[]>
  /**
   * The decisions already stored for the waiting merge, so a picker reopened
   * after a partial resolve starts where it left off. Empty when the workspace
   * is not merging. Rejects for an untracked workspace.
   */
  readonly mergePicks: (workspaceId: string) => Promise<readonly GitMergePick[]>
  /**
   * The commit each side last made to each conflicted record or file, from
   * `git log -1 <rev> -- <path>` — who wrote each copy, for the picker. A record
   * a side does not hold has no commit there. Read-only, and display only:
   * nothing is committed or moved. Rejects for an untracked workspace or one
   * that is not merging.
   */
  readonly mergeRecordCommits: (
    workspaceId: string,
    recordIds: readonly string[],
  ) => Promise<readonly MergeRecordCommits[]>
  /**
   * Settle conflicts with picks and, when none are left, commit the merge,
   * import it and push. Resolves to the status afterwards — still `merging`
   * when conflicts remain, which is not an error. Resolves, rather than
   * rejects, for a refused push and every other classified failure; it rejects
   * only for an untracked workspace, one that is not merging, a pick that is
   * not a pick, and an unexpected failure.
   */
  readonly resolveMerge: (
    workspaceId: string,
    picks: readonly GitMergePick[],
    request?: WorkspaceGitCommitRequest,
  ) => Promise<WorkspaceGitStatus>
  /**
   * Give up on the merge: abort it, put the clone back on this device's own
   * commits, import nothing and leave the workspace `diverged`. Every local
   * commit stays.
   */
  readonly abandonMerge: (workspaceId: string) => Promise<WorkspaceGitStatus>
  readonly onStatusChanged: (callback: (status: WorkspaceGitStatus) => void) => () => void
  /**
   * Bind the workspace to a remote: a repository with no branches receives its
   * history, one that already holds this workspace's history is joined as it
   * is, and anything else is refused. Rejects, and leaves the workspace unbound, when
   * the URL is not an accepted form or the remote cannot be reached.
   * `account` is the `gh`/`glab` account to reach it as, from `listAccounts`;
   * null or absent, the user's own credential helper or SSH key. An account
   * on another host than the remote's is refused.
   */
  readonly connectRemote: (workspaceId: string, url: string, account?: GitAccountRef | null) => Promise<WorkspaceGitStatus>
  /**
   * Reach the connected remote as another account, or with null as the user's
   * own credentials. Nothing is fetched: the next sync is the first call made
   * as it. Rejects for a workspace with no remote, or an account on another host.
   */
  readonly setAccount: (workspaceId: string, account: GitAccountRef | null) => Promise<WorkspaceGitStatus>
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
   * `account`, as for `connectRemote`, is what the clone and every later sync
   * reach the remote as.
   */
  readonly openFromGit: (url: string, account?: GitAccountRef | null) => Promise<OpenWorkspaceFromGitResult>
  /**
   * Every account `gh` and `glab` are signed in to, and whether each tool is
   * installed. A missing tool lists no accounts rather than rejecting. No
   * token ever crosses this bridge: the tools keep them.
   */
  readonly listAccounts: () => Promise<GitAccountList>
  /**
   * Sign in to `host` with `gh` or `glab`, in the browser: main runs the tool,
   * pushes its one-time code through `onSignInPrompt`, opens the host's page,
   * and resolves with the account once the code has been entered there. One
   * at a time. Rejects with the tool's reason, and when cancelled. gh makes
   * the new account its active one on the host, as `gh auth login` does in a
   * terminal; glab replaces the one account it keeps for the host. Neither
   * changes git's configuration.
   */
  readonly signIn: (provider: GitProvider, host: string) => Promise<GitAccountRef>
  /** Stop the sign-in in progress: its tool is killed, and `signIn` rejects. */
  readonly cancelSignIn: () => Promise<void>
  /** Open the sign-in in progress's page in the browser again. Only main's own copy of it is opened. */
  readonly openSignInPage: () => Promise<void>
  readonly onSignInPrompt: (callback: (prompt: GitSignInPrompt) => void) => () => void
  /**
   * Where `account` can create a repository: itself, and its GitHub
   * organizations or the GitLab groups where it is at least a Developer.
   * Rejects when its tool cannot hand over the account.
   */
  readonly listOwners: (account: GitAccountRef) => Promise<GitRepositoryOwnerList>
  /**
   * Create an empty, `apiweave-workspace`-tagged repository as `account`.
   * Rejects, naming it, for a repository that already exists — it is never
   * adopted — and with the host's reason for any other refusal. Nothing it
   * created is ever deleted; connecting to it is the caller's next call.
   */
  readonly createRepository: (account: GitAccountRef, request: GitCreateRepositoryRequest) => Promise<GitCreatedRepository>
}
