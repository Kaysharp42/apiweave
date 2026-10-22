/** One commit of a workspace's history, as the settings page shows it. */
export interface WorkspaceGitCommit {
  readonly sha: string
  readonly subject: string
  /** Strict ISO 8601. */
  readonly authorDate: string
}
