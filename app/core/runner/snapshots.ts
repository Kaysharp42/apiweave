import { paths as jsonPathLocations } from "jsonpathly"
import type { JsonValue } from "@shared/types/JsonValue"

/** Where a response and its baseline differ, as a JSONPath location. */
export interface SnapshotDifference {
  readonly path: string
  readonly expected: JsonValue | undefined
  readonly actual: JsonValue | undefined
}

export interface SnapshotComparison {
  readonly equal: boolean
  /** The first differences, in document order, capped by {@link MAX_SNAPSHOT_DIFFERENCES}. */
  readonly differences: readonly SnapshotDifference[]
  /** How many places differ in total, including those beyond the cap. */
  readonly differenceCount: number
  /** How many locations an ignore path masked out. */
  readonly ignoredCount: number
}

/** The most differences one comparison reports; a huge diff is a moved subtree, which the count still conveys. */
export const MAX_SNAPSHOT_DIFFERENCES = 20

/** A baseline store: one recorded value per workflow, node and rule. */
export interface SnapshotStore {
  read(workflowId: string, nodeId: string, ruleIndex: number): { readonly value: JsonValue; readonly updatedAt: string } | undefined
  write(workflowId: string, nodeId: string, ruleIndex: number, value: JsonValue, updatedAt: string): void
}

/**
 * A location means "this value, and everything under it". Values that change
 * every run (times, ids, etags) are named this way so the comparison looks past
 * them; the masked values still count as equal even when both sides have a
 * different shape at that location.
 */
function ignoredLocations(value: JsonValue, ignorePaths: readonly string[]): Set<string> {
  const locations = new Set<string>()
  for (const path of ignorePaths) {
    for (const location of jsonPathLocations(value, path)) locations.add(location)
  }
  return locations
}

/** A location in the notation `jsonpathly`'s `paths()` returns, so ignore paths match the walk. */
function childLocation(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`
  return `${parent}['${key.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}']`
}

interface DiffState {
  readonly ignored: ReadonlySet<string>
  readonly differences: SnapshotDifference[]
  count: number
}

function walk(expected: JsonValue | undefined, actual: JsonValue | undefined, location: string, state: DiffState): void {
  if (state.ignored.has(location)) return
  if (expected === actual) return

  const bothArrays = Array.isArray(expected) && Array.isArray(actual)
  if (bothArrays) {
    const longer = Math.max(expected.length, actual.length)
    for (let index = 0; index < longer; index++) walk(expected[index], actual[index], childLocation(location, index), state)
    return
  }

  const bothObjects =
    typeof expected === "object" && expected !== null && !Array.isArray(expected) &&
    typeof actual === "object" && actual !== null && !Array.isArray(actual)
  if (bothObjects) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    for (const key of keys) walk(expected[key], actual[key], childLocation(location, key), state)
    return
  }

  state.count += 1
  if (state.differences.length < MAX_SNAPSHOT_DIFFERENCES) {
    state.differences.push({ path: location, expected, actual })
  }
}

/**
 * Compares a response against its baseline. `ignorePaths` are JSONPath
 * expressions; a location one selects is equal on both sides, whatever it
 * holds. Paths resolve against both values, so an ignore path that matches only
 * one side still masks the other's counterpart by location.
 */
export function compareSnapshot(expected: JsonValue, actual: JsonValue, ignorePaths: readonly string[] = []): SnapshotComparison {
  const ignored = new Set([...ignoredLocations(expected, ignorePaths), ...ignoredLocations(actual, ignorePaths)])
  const state: DiffState = { ignored, differences: [], count: 0 }
  walk(expected, actual, "$", state)
  return {
    equal: state.count === 0,
    differences: state.differences,
    differenceCount: state.count,
    ignoredCount: ignored.size,
  }
}

/**
 * A JSON value as a baseline stores it. A stored response body is already JSON;
 * a non-JSON body (XML, text) is kept as the string it is.
 */
export function snapshotValue(value: unknown): JsonValue {
  if (value === undefined) return null
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "function" || typeof value === "symbol") return String(value)
  return value as JsonValue
}

/** One line per difference, for a report that already printed the path: the two values. */
export function describeSnapshotDifference(difference: SnapshotDifference): string {
  return `expected ${JSON.stringify(difference.expected ?? null)}, received ${JSON.stringify(difference.actual ?? null)}`
}
