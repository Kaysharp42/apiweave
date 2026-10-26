import type { JsonValue } from "./JsonValue"

/**
 * A value of the user's own that settles the conflict at exactly `path` in
 * record `recordId`, replacing whatever either copy holds there — so it names
 * one listed conflict, and settles nothing below it. A value that names no
 * conflict changes nothing, like a copy pick that does.
 *
 * For a `file` conflict (the record is the file's path) the value is the text
 * to keep.
 */
export interface GitMergeValuePick {
  readonly recordId: string
  readonly path: string
  readonly value: JsonValue
}
