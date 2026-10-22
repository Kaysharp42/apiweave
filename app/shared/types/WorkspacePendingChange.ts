import type { WorkspacePendingChangeKind } from "./WorkspacePendingChangeKind"
import type { WorkspacePendingChangeType } from "./WorkspacePendingChangeType"

/** One record the next commit would add, change or delete: what the manual-mode dialog lists. */
export interface WorkspacePendingChange {
  readonly kind: WorkspacePendingChangeKind
  readonly change: WorkspacePendingChangeType
  /** The record's name: the database's for an added or changed one, the last commit's for a deleted one. */
  readonly name: string
  /** The repository file the change is to; for a record that moved, the file it is at now. */
  readonly path: string
}
