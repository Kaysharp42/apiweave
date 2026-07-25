import type { JsonValue } from "./JsonValue"

/** One structural change between a conflict's cloud copy and local copy. */
export type ConflictDiffKind = "add" | "remove" | "change"

/**
 * `before`/`after` follow the Local-becomes-authoritative convention used
 * throughout the conflict system: `before` is the current Cloud value,
 * `after` is the incoming Local value. `add` means present in Local only,
 * `remove` means present in Cloud only.
 */
export type ConflictDiffEntry = {
  readonly path: string
  readonly kind: ConflictDiffKind
  readonly before: JsonValue | undefined
  readonly after: JsonValue | undefined
  readonly label: string
}
