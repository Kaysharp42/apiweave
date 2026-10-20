import type { JsonValue } from "../types/JsonValue"
import type { WorkspacePendingChangeKind } from "../types/WorkspacePendingChangeKind"

/**
 * How a place inside one record file is named: what a merge conflict, a pick
 * and a field diff all say, so a pick made on a diff row settles that conflict.
 *
 * A path is the keys from the record's top level down, joined by `.`. An item
 * of an array the format keys (below) is named by its key, never its index,
 * so the same item has the same path in every copy of the record whatever
 * order its array is in: `nodes.n1.config.method`, `edges.e7`,
 * `workflowOrder.<workflowId>.enabled`, `variables.baseUrl`. Every other
 * array is one value: `nodes.n1.config.headers`, `nodeTemplates`. A `.` or a
 * `\` inside a key is escaped with `\` (`variables.api\.key`), so any key
 * survives the round trip. The empty path is the whole record.
 */

/** Where the items of an array the format keys get their key from. */
interface KeyedArray {
  readonly keyOf: (item: JsonValue) => string | undefined
  /** Whether the array's order is part of what it says; nodes and edges are written sorted by id, so theirs is not. */
  readonly ordered: boolean
}

const byField = (field: string) => (item: JsonValue): string | undefined => {
  const key = typeof item === "object" && item !== null && !Array.isArray(item) && Object.hasOwn(item, field) ? item[field] : undefined
  return typeof key === "string" ? key : undefined
}

/** A tag is its own key: the tags are a set, written in the order they were added. */
const itself = (item: JsonValue): string | undefined => (typeof item === "string" ? item : undefined)

const KEYED_ARRAYS: Readonly<Partial<Record<WorkspacePendingChangeKind, Readonly<Record<string, KeyedArray>>>>> = {
  project: { workflowOrder: { keyOf: byField("workflowId"), ordered: true } },
  workflow: {
    nodes: { keyOf: byField("nodeId"), ordered: false },
    edges: { keyOf: byField("edgeId"), ordered: false },
    tags: { keyOf: itself, ordered: true },
  },
}

/** The array at a record's top-level `field` whose items a path names by key; undefined for an array that is one value. */
export function keyedArray(kind: WorkspacePendingChangeKind, field: string): KeyedArray | undefined {
  const arrays = KEYED_ARRAYS[kind]
  return arrays !== undefined && Object.hasOwn(arrays, field) ? arrays[field] : undefined
}

/**
 * A keyed array's items by key, in its order; an absent array has none.
 * Undefined when an item has no key or two share one: such an array cannot be
 * told apart item by item, so it is one value.
 */
export function itemsByKey(value: JsonValue | undefined, keyOf: KeyedArray["keyOf"]): Map<string, JsonValue> | undefined {
  const items = new Map<string, JsonValue>()
  if (value === undefined) return items
  if (!Array.isArray(value)) return undefined
  for (const item of value) {
    const key = keyOf(item)
    if (key === undefined || items.has(key)) return undefined
    items.set(key, item)
  }
  return items
}

/** The path that names `segments`. */
export function joinPath(segments: readonly string[]): string {
  return segments.map((segment) => segment.replace(/[\\.]/g, (character) => `\\${character}`)).join(".")
}

/** The segments a path names; the inverse of {@link joinPath}. */
export function splitPath(path: string): string[] {
  if (path === "") return []
  const segments = [""]
  for (let index = 0; index < path.length; index += 1) {
    const character = path[index]!
    if (character === "\\" && index + 1 < path.length) segments[segments.length - 1] += path[++index]!
    else if (character === ".") segments.push("")
    else segments[segments.length - 1] += character
  }
  return segments
}
