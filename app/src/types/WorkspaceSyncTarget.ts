/** A workspace that exists and is about to be given a repository. */
export interface WorkspaceSyncTarget {
  readonly workspaceId: string;
  readonly slug: string;
}
