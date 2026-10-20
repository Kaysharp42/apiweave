import type { JsonValue } from "./JsonValue"
import type { WorkspacePendingChangeKind } from "./WorkspacePendingChangeKind"

/**
 * A place both copies changed differently, which the merge does not settle by
 * itself. The same three trees always give the same conflicts, so what is worth
 * keeping is the picks that settle them, each naming one by `recordId` and
 * `path`.
 */
export interface GitMergeConflict {
  /** What holds the conflict: one of the format's records, or (`file`) a file the format does not own, such as a README. */
  readonly kind: WorkspacePendingChangeKind | "file"
  /** The record's id; for a `file`, its path. */
  readonly recordId: string
  /** The record's name in your copy, or the remote's when yours has none; for a `file`, its path. */
  readonly name: string
  /** Where in the record, as `nodes.n1.config.method` (see `workspace-repo/paths.ts`); `""` is the whole record or file. */
  readonly path: string
  /** What the common ancestor held at `path`; absent where it held nothing. */
  readonly base?: JsonValue
  /** What your copy holds at `path`; absent where it holds nothing (it deleted or never added it). */
  readonly ours?: JsonValue
  /** What the remote copy holds at `path`; absent where it holds nothing. */
  readonly theirs?: JsonValue
  /** Only on a whole-record conflict whose two copies' changes do not make a valid record together: why not. Keeping one whole copy is the way out. */
  readonly invalid?: string
}
