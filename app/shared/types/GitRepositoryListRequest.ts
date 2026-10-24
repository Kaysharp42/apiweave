/**
 * Which of an account's repositories to list. `tagged`: only those with the
 * `apiweave-workspace` topic, the ones Open from git offers by default.
 * `emptyOnly`: only empty ones the account can push to, the ones a workspace
 * can be connected to.
 */
export interface GitRepositoryListRequest {
  readonly tagged: boolean
  readonly emptyOnly: boolean
}
