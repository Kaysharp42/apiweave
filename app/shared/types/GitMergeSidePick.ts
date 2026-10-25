import type { GitMergeSide } from "./GitMergeSide"

/**
 * The copy that settles a conflict: the one at `path` in record `recordId`, and
 * every conflict below that path without a pick of its own, so a pick at `""`
 * gives one copy every conflict in its record. A pick that names no conflict
 * changes nothing; what both copies agree on, or only one changed, is never
 * overridden by one.
 */
export interface GitMergeSidePick {
  readonly recordId: string
  readonly path: string
  readonly side: GitMergeSide
}
