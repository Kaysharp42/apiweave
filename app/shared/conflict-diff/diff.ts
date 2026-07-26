import type { JsonValue } from "../types/JsonValue"
import type { CanonicalConflictPayload } from "../types/CanonicalConflictPayload"
import type { ConflictDiffEntry, ConflictDiffKind } from "../types/ConflictDiffEntry"
import { canonicalizeSyncPayload, normalizeConflictKind } from "./canonicalize"

const INDEXED_ARRAYS: Record<string, { idKey: string; label: string }> = {
  nodes: { idKey: "nodeId", label: "Node" },
  edges: { idKey: "edgeId", label: "Edge" },
}

/**
 * Computes the structural change set between a conflict's cloud and local
 * copies: both sides are canonicalized first (see `canonicalizeSyncPayload`),
 * then diffed. Workflow payloads get an id-aware diff over `nodes`/`edges`
 * (added/removed/changed by `nodeId`/`edgeId`); every other kind — and every
 * other workflow field — gets a generic deep key-by-key diff. Arrays outside
 * `nodes`/`edges` are compared as opaque values (report whole-array change),
 * not diffed element-by-element.
 */
export function computeConflictDiff(
  kind: string,
  localPayload: JsonValue | Record<string, unknown>,
  cloudPayload: JsonValue | Record<string, unknown>,
): ConflictDiffEntry[] {
  const local = canonicalizeSyncPayload(kind, localPayload)
  const cloud = canonicalizeSyncPayload(kind, cloudPayload)
  if (normalizeConflictKind(kind) === "workflow") {
    return diffWorkflow(cloud, local)
  }
  return deepDiff(cloud, local, "")
}

function diffWorkflow(
  cloud: CanonicalConflictPayload,
  local: CanonicalConflictPayload,
): ConflictDiffEntry[] {
  const entries: ConflictDiffEntry[] = []
  for (const [key, spec] of Object.entries(INDEXED_ARRAYS)) {
    entries.push(...diffIndexedArray(cloud[key], local[key], key, spec.idKey, spec.label))
  }
  const restCloud: Record<string, JsonValue> = {}
  const restLocal: Record<string, JsonValue> = {}
  for (const key of new Set([...Object.keys(cloud), ...Object.keys(local)])) {
    if (key in INDEXED_ARRAYS) continue
    if (key in cloud) restCloud[key] = cloud[key]!
    if (key in local) restLocal[key] = local[key]!
  }
  entries.push(...deepDiff(restCloud, restLocal, ""))
  return entries
}

function diffIndexedArray(
  cloudValue: JsonValue | undefined,
  localValue: JsonValue | undefined,
  basePath: string,
  idKey: string,
  label: string,
): ConflictDiffEntry[] {
  const cloudItems = indexById(cloudValue, idKey)
  const localItems = indexById(localValue, idKey)
  const entries: ConflictDiffEntry[] = []
  for (const id of new Set([...cloudItems.keys(), ...localItems.keys()])) {
    const cloudItem = cloudItems.get(id)
    const localItem = localItems.get(id)
    const path = `${basePath}.${id}`
    if (cloudItem === undefined) {
      entries.push({ path, kind: "add", before: undefined, after: localItem, label: `${label} "${id}" added` })
      continue
    }
    if (localItem === undefined) {
      entries.push({ path, kind: "remove", before: cloudItem, after: undefined, label: `${label} "${id}" removed` })
      continue
    }
    for (const fieldEntry of deepDiff(cloudItem, localItem, path)) {
      const relative = fieldEntry.path.slice(path.length + 1)
      entries.push({ ...fieldEntry, label: `${label} "${id}" · ${humanizePath(relative)}` })
    }
  }
  return entries
}

function indexById(value: JsonValue | undefined, idKey: string): Map<string, JsonValue> {
  const map = new Map<string, JsonValue>()
  if (!Array.isArray(value)) return map
  for (const item of value) {
    if (!isPlainRecord(item)) continue
    const id = item[idKey]
    if (typeof id === "string") map.set(id, item)
  }
  return map
}

function deepDiff(before: JsonValue | undefined, after: JsonValue | undefined, path: string): ConflictDiffEntry[] {
  if (deepEqualJson(before, after)) return []
  if (before === undefined) return [makeEntry(path, "add", before, after)]
  if (after === undefined) return [makeEntry(path, "remove", before, after)]
  if (isPlainRecord(before) && isPlainRecord(after)) {
    const entries: ConflictDiffEntry[] = []
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      entries.push(...deepDiff(before[key], after[key], path ? `${path}.${key}` : key))
    }
    return entries
  }
  return [makeEntry(path, "change", before, after)]
}

function makeEntry(
  path: string,
  kind: ConflictDiffKind,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
): ConflictDiffEntry {
  return { path, kind, before, after, label: humanizePath(path) }
}

/** Title-cases each dot-path segment and joins with " › ": `workflowCount` -> `Workflow count`, `secrets.apiKey.reference` -> `Secrets › Api key › Reference`. */
export function humanizePath(path: string): string {
  if (path === "") return "(entire record)"
  return path
    .split(".")
    .map((segment) => {
      const spaced = segment
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .toLowerCase()
      return spaced.charAt(0).toUpperCase() + spaced.slice(1)
    })
    .join(" › ")
}

function isPlainRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deepEqualJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqualJson(item, b[index]))
  }
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => key in b && deepEqualJson(a[key], b[key]))
  }
  return false
}
