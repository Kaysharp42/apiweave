/** One side's latest commit for a record or file, as `git log -1 <rev> -- <path>` reports it. */
export interface MergeSideCommit {
  readonly sha: string
  readonly authorName: string
  /** Strict ISO 8601, as `GitLogEntry.authorDate` gives it. */
  readonly authorDate: string
  readonly subject: string
}
