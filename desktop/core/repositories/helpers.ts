/**
 * Small mapping utilities shared by every repository. Repositories translate
 * the rich camelCase domain aggregates (shared/types) onto the generic SQLite
 * columns (core/db/migrations/001_init.sql) and back — these helpers keep that
 * codec boilerplate in one place.
 */

import type { JsonValue } from "../../../shared/types/JsonValue"

/** Parse a JSON column into a known shape. The DB is local and only ever
 * is written by us, so we trust the stored JSON rather than re-validating here
 * (zod validation lives at the IPC boundary, Task 11). */
export function parseJson<T>(text: string): T {
  return JSON.parse(text) as T
}

export function toJson(value: unknown): string {
  return JSON.stringify(value)
}

/** Derive a NOT-NULL slug column from a display name. The schema keeps `slug`
 * for future routing/sync; the domain types don't expose it, so repositories
 * synthesize it. Falls back to the row id when a name has no slug-able chars. */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.length > 0 ? slug : fallback
}

/** A freshly inserted/updated row is read straight back; its absence is a
 * broken invariant, not a not-found the caller should handle. */
export function mustExist<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new Error(message)
  }
  return row
}

// ──────────────────────────────────────────────────────────────────────────
// Canonical node-config normalisation
// ──────────────────────────────────────────────────────────────────────────
//
// `WorkflowNodeSchema` (shared/zod-schemas/WorkflowNodeSchema.ts) is strict:
// `http-request` nodes persist `headers`, `cookies`, `queryParams`,
// `pathVariables` as `KeyValuePair[]` ONLY. Before that contract landed,
// those fields were also written as:
//
//   - a multiline string            (curl/swagger importers, drag-and-drop defaults)
//   - a Record<string, string>      (older JSON-authoring paths)
//   - a raw object with extra keys  (a NodeModal editor edge case)
//
// Both the one-shot DB migration (`003_workflow_node_config_canonical.sql` +
// `canonicalizeExistingWorkflows`) and the per-write trust boundary
// (`WorkflowRepository.create/update`) reduce any of those shapes to the
// canonical `KeyValuePair[]` form via this one helper, so the schema can be
// strict and the runner can read ONE shape only.

export interface KeyValuePair {
  readonly key: string
  readonly value: string
  readonly active?: boolean
}

const KV_FIELDS = ["headers", "cookies", "queryParams", "pathVariables"] as const
type KvField = (typeof KV_FIELDS)[number]

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isCanonicalPair(v: unknown): v is KeyValuePair {
  if (!isPlainObject(v)) return false
  const { key, value, active } = v as { key: unknown; value: unknown; active?: unknown }
  if (typeof key !== "string" || typeof value !== "string") return false
  if (active !== undefined && typeof active !== "boolean") return false
  return true
}

function isCanonicalKvArray(v: unknown): boolean {
  return Array.isArray(v) && v.every(isCanonicalPair)
}

/** Split a `"key=value"` / `"key:value"` / multiline string into pairs.
 * Keeps insert order; drops blank lines and entries with no separator. */
function stringToPairs(text: string): readonly KeyValuePair[] {
  const pairs: KeyValuePair[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const eq = line.indexOf("=")
    const colon = line.indexOf(":")
    let sep = -1
    if (eq >= 0 && (colon < 0 || eq < colon)) sep = eq
    else if (colon >= 0) sep = colon
    if (sep < 0) {
      pairs.push({ key: line, value: "" })
      continue
    }
    pairs.push({
      key: line.slice(0, sep).trim(),
      value: line.slice(sep + 1).trim(),
    })
  }
  return pairs
}

/** Coerce a non-canonical value (string | record | mixed array) to
 * `KeyValuePair[]`. Unknown / undefined returns an empty array. */
function toKeyValuePairs(value: unknown): readonly KeyValuePair[] {
  if (typeof value === "string") return stringToPairs(value)
  if (isPlainObject(value)) {
    return Object.entries(value).map(([key, val]) => ({
      key,
      value: val === null || val === undefined ? "" : String(val),
      ...(typeof val === "object" ? {} : {}),
    }))
  }
  if (Array.isArray(value)) {
    const pairs: KeyValuePair[] = []
    for (const entry of value) {
      if (isCanonicalPair(entry)) {
        pairs.push(entry)
        continue
      }
      if (isPlainObject(entry)) {
        const { key, value: val, active } = entry as {
          key: unknown
          value: unknown
          active?: unknown
        }
        pairs.push({
          key: key === null || key === undefined ? "" : String(key),
          value: val === null || val === undefined ? "" : String(val),
          ...(typeof active === "boolean" ? { active } : {}),
        })
      }
    }
    return pairs
  }
  return []
}

/**
 * Return a new node with `config.{headers,cookies,queryParams,pathVariables}`
 * rewritten to canonical `KeyValuePair[]` form, or the SAME reference when
 * nothing needed to change (so the DB migration pass writes back only the
 * rows whose `graph_json` actually drifted — keeps the migration idempotent
 * and cheap to run on every startup).
 *
 * Non-http-request nodes are returned unchanged: only `http-request` nodes
 * carry those fields, and only those nodes' fields carry the legacy
 * string/Record shapes that need normalising.
 */
export function canonicalizeNodeConfig(node: unknown): unknown {
  if (!isPlainObject(node)) return node
  const n = node as { type?: unknown; config?: unknown }
  if (n.type !== "http-request") return node
  const cfg = n.config
  if (!isPlainObject(cfg)) return node

  let changed = false
  const nextConfig: Record<string, unknown> = { ...cfg }
  for (const field of KV_FIELDS) {
    const v = cfg[field]
    if (v === undefined) continue
    if (isCanonicalKvArray(v)) continue
    nextConfig[field] = toKeyValuePairs(v)
    changed = true
  }
  return changed ? { ...n, config: nextConfig } : node
}

/** Read-only array of the KV field names — exported for tests that want to
 * iterate exactly the field set the helper normalises. */
export const CANONICAL_KV_FIELDS: readonly KvField[] = KV_FIELDS

/** Same as {@link canonicalizeNodeConfig}, but typed for the workflow graph
 * shape the repository reads/writes (`{ nodes; edges }`). Returns the same
 * graph reference when no node changed; otherwise a shallow clone with the
 * touched nodes replaced. Pure — no JSON round-trip, so callers writing the
 * result can `JSON.stringify` with their own codec. */
export function canonicalizeWorkflowGraph(graph: unknown): JsonValue {
  if (!isPlainObject(graph)) return graph as JsonValue
  const nodes = (graph as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return graph as JsonValue

  let changed = false
  const nextNodes: JsonValue[] = nodes.map((node) => {
    const normalised = canonicalizeNodeConfig(node) as JsonValue
    if (normalised !== node) changed = true
    return normalised
  })
  return changed
    ? ({ ...(graph as Record<string, unknown>), nodes: nextNodes } as JsonValue)
    : (graph as JsonValue)
}