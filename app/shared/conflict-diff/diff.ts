import type { ConflictDiffEntry, ConflictDiffKind } from "../types/ConflictDiffEntry"
import type { JsonValue } from "../types/JsonValue"
import type { WorkspacePendingChangeKind } from "../types/WorkspacePendingChangeKind"
import { itemsByKey, joinPath, keyedArray, splitPath } from "../workspace-repo/paths"

/** What one item of a keyed collection is called in a label: the item's key is quoted after it, as the user named it. */
const ITEM_LABELS: Readonly<Record<string, string>> = {
  nodes: "Node",
  edges: "Edge",
  workflowOrder: "Workflow",
  tags: "Tag",
  variables: "Variable",
}

/**
 * The structural change set between two copies of one record in the
 * repository format (`before` and `after` are its file documents, either
 * absent). An array the format keys (nodes, edges, a project's workflow order,
 * tags) is diffed item by item — added, removed or changed by key — and an
 * ordered one also reports a new order of the items both copies hold; every
 * object is diffed key by key; anything else, an array the format does not key
 * included, is one value. Each entry's path is the merge's (`workspace-repo/paths.ts`),
 * so a pick made on an entry settles the conflict at the same place.
 */
export function computeConflictDiff(
  kind: WorkspacePendingChangeKind,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
): ConflictDiffEntry[] {
  if (!isPlainRecord(before) || !isPlainRecord(after)) return deepDiff(before, after, [])
  return unionKeys(before, after).flatMap((field) => {
    const array = keyedArray(kind, field)
    return array === undefined
      ? deepDiff(own(before, field), own(after, field), [field])
      : diffKeyedArray(field, array, own(before, field), own(after, field))
  })
}

/** A path as a reader sees it: `nodes.n1.config.method` reads `Node "n1" · Config › Method`, and the empty path `(entire record)`. */
export function humanizePath(path: string): string {
  return segmentsLabel(splitPath(path))
}

function diffKeyedArray(
  field: string,
  array: NonNullable<ReturnType<typeof keyedArray>>,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
): ConflictDiffEntry[] {
  const left = itemsByKey(before, array.keyOf)
  const right = itemsByKey(after, array.keyOf)
  if (left === undefined || right === undefined) return deepDiff(before, after, [field])
  const entries = [...new Set([...left.keys(), ...right.keys()])].flatMap((key) => deepDiff(left.get(key), right.get(key), [field, key]))
  const common = (keys: Iterable<string>, other: ReadonlyMap<string, JsonValue>) => [...keys].filter((key) => other.has(key))
  const leftOrder = common(left.keys(), right)
  const rightOrder = common(right.keys(), left)
  if (array.ordered && leftOrder.some((key, index) => key !== rightOrder[index])) entries.push(entry([field], "change", leftOrder, rightOrder))
  return entries
}

function deepDiff(before: JsonValue | undefined, after: JsonValue | undefined, at: readonly string[]): ConflictDiffEntry[] {
  if (deepEqualJson(before, after)) return []
  if (before === undefined) return [entry(at, "add", before, after)]
  if (after === undefined) return [entry(at, "remove", before, after)]
  if (isPlainRecord(before) && isPlainRecord(after)) {
    return unionKeys(before, after).flatMap((key) => deepDiff(own(before, key), own(after, key), [...at, key]))
  }
  return [entry(at, "change", before, after)]
}

function entry(at: readonly string[], kind: ConflictDiffKind, before: JsonValue | undefined, after: JsonValue | undefined): ConflictDiffEntry {
  return { path: joinPath(at), kind, before, after, label: segmentsLabel(at) }
}

function segmentsLabel(segments: readonly string[]): string {
  if (segments.length === 0) return "(entire record)"
  const [field, key, ...rest] = segments
  const item = ITEM_LABELS[field!]
  if (item === undefined || key === undefined) return humanize(segments)
  const named = `${item} "${key}"`
  return rest.length === 0 ? named : `${named} · ${humanize(rest)}`
}

/** Each segment in words, capitalized, joined by " › ": `workflowCount` → `Workflow count`, `config.authType` → `Config › Auth type`. */
function humanize(segments: readonly string[]): string {
  return segments
    .map((segment) => {
      const spaced = segment
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .toLowerCase()
      return spaced.charAt(0).toUpperCase() + spaced.slice(1)
    })
    .join(" › ")
}

function unionKeys(left: Record<string, JsonValue>, right: Record<string, JsonValue>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
}

/** The value an object holds under `key` itself — never one it inherits, as `__proto__` or `toString` would be. */
export function own(value: Record<string, JsonValue>, key: string): JsonValue | undefined {
  return Object.hasOwn(value, key) ? value[key] : undefined
}

// fallow-ignore-next-line code-duplication -- the same two-line narrowing predicate is written out in ~25 modules across core and shared; it is too small to own a module, and this copy narrows to the JSON value its callers diff and merge.
export function isPlainRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Whether two JSON values are equal, an object's key order aside; undefined (absent) equals only itself. */
// fallow-ignore-next-line complexity -- recursive structural comparison necessarily branches by JSON value shape
export function deepEqualJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqualJson(item, b[index]))
  }
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const keysA = Object.keys(a)
    if (keysA.length !== Object.keys(b).length) return false
    return keysA.every((key) => Object.hasOwn(b, key) && deepEqualJson(a[key], b[key]))
  }
  return false
}
