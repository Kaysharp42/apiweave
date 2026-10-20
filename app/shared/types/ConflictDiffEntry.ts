import type { JsonValue } from "./JsonValue"

/** How one place differs between two copies of a record: there only after (`add`), only before (`remove`), or in both with different values (`change`). */
export type ConflictDiffKind = "add" | "remove" | "change"

/** One structural change between two copies of a record, at a path the merge also uses (`workspace-repo/paths.ts`). An absent side is `undefined`. */
export type ConflictDiffEntry = {
  readonly path: string
  readonly kind: ConflictDiffKind
  readonly before: JsonValue | undefined
  readonly after: JsonValue | undefined
  readonly label: string
}
