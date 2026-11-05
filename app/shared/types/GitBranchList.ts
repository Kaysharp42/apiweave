/** The branches a remote has, and which one its HEAD names by default. */
export interface GitBranchList {
  /** Branch names without `refs/heads/`, sorted. */
  readonly branches: readonly string[]
  /** The branch the remote's HEAD points at, when it names one; null for an empty or unborn remote. */
  readonly defaultBranch: string | null
}
