/** Why the first load of one workspace's git status failed. */
export interface GitStatusLoadFailure {
  readonly workspaceId: string;
  readonly message: string;
}
