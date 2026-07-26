// fallow-ignore-file code-duplication -- record-kind canonicalizers intentionally share the same normalization shape
import type { JsonValue } from "../types/JsonValue"
import type { CanonicalConflictPayload } from "../types/CanonicalConflictPayload"

/**
 * Sync conflict record kinds understood by the canonicalizer. The value is the
 * lowercase kind string used on the wire (`workspace` | `project` | `workflow` |
 * `environment`). The desktop conflict bridge additionally recognizes a legacy
 * `collection` alias which maps to `project`.
 */
export type ConflictRecordKind = "workspace" | "project" | "workflow" | "environment"

/** Neutral placeholder substituted for identity fields that differ per side. */
export const IDENTITY_PLACEHOLDER = "<id>"

const VOLATILE_TOP_LEVEL_KEYS = new Set(["rev", "updatedAt"])

// Desktop-only denormalized fields that the cloud schema does not carry. The
// canonical form drops them so a desktop local copy does not appear to differ
// from a cloud copy purely because the desktop attached the extra view.
const DESKTOP_ONLY_COLLECTION_KEYS = new Set(["workflowOrderItems"])

/**
 * Normalize a conflict record kind aliased on some surfaces (`collection`) to
 * the canonical wire kind (`project`). Returns `null` for an unknown kind so
 * callers can fall back to a generic deep compare rather than crashing.
 */
export function normalizeConflictKind(kind: string): ConflictRecordKind | null {
  switch (kind) {
    case "workspace":
    case "project":
    case "collection":
    case "workflow":
    case "environment":
      return kind === "collection" ? "project" : (kind as ConflictRecordKind)
    default:
      return null
  }
}

/**
 * Canonicalize a conflict payload to the single comparison schema. Both the
 * local (incoming) and cloud (current) snapshots are passed through this so a
 * diff compares the same shape.
 *
 * The transformation is intentionally tolerant: for a known kind it applies
 * the kind-specific normalization (drop volatile keys, neutralize per-side
 * identity remaps, drop desktop-only denormalized fields), and passes every
 * other field through unchanged. An unknown kind (or malformed payload) falls
 * back to the generic transform, which only strips the always-volatile
 * `rev`/`updatedAt` keys — so a future field still surfaces as a diff without
 * the canonicalizer needing an update.
 *
 * This never throws on structurally unexpected input; it deep-copies the input
 * through JSON-safe primitives only.
 */
export function canonicalizeSyncPayload(
  kind: string,
  payload: JsonValue | Record<string, unknown>,
): CanonicalConflictPayload {
  const record = toJsonObject(payload)
  if (record === null) {
    return {}
  }
  const normalizedKind = normalizeConflictKind(kind)
  if (normalizedKind === null) {
    return canonicalizeGeneric(record)
  }
  switch (normalizedKind) {
    case "workspace":
      return canonicalizeWorkspace(record)
    case "project":
      return canonicalizeProject(record)
    case "workflow":
      return canonicalizeWorkflow(record)
    case "environment":
      return canonicalizeEnvironment(record)
  }
}

function canonicalizeWorkspace(record: JsonObject): CanonicalConflictPayload {
  const out: MutablePayload = {}
  for (const [key, value] of Object.entries(record)) {
    if (VOLATILE_TOP_LEVEL_KEYS.has(key)) continue
    if (key === "workspaceId") {
      out[key] = IDENTITY_PLACEHOLDER
      continue
    }
    out[key] = cloneJson(value)
  }
  return out
}

function canonicalizeProject(record: JsonObject): CanonicalConflictPayload {
  const out: MutablePayload = {}
  for (const [key, value] of Object.entries(record)) {
    if (VOLATILE_TOP_LEVEL_KEYS.has(key)) continue
    if (DESKTOP_ONLY_COLLECTION_KEYS.has(key)) continue
    if (key === "workspaceId") {
      out[key] = IDENTITY_PLACEHOLDER
      continue
    }
    out[key] = cloneJson(value)
  }
  return out
}

function canonicalizeWorkflow(record: JsonObject): CanonicalConflictPayload {
  const out: MutablePayload = {}
  for (const [key, value] of Object.entries(record)) {
    if (VOLATILE_TOP_LEVEL_KEYS.has(key)) continue
    if (key === "workspaceId") {
      out[key] = IDENTITY_PLACEHOLDER
      continue
    }
    out[key] = cloneJson(value)
  }
  return out
}

function canonicalizeEnvironment(record: JsonObject): CanonicalConflictPayload {
  const out: MutablePayload = {}
  const scopeType = typeof record["scopeType"] === "string" ? record["scopeType"] : ""
  const isWorkspaceScoped = scopeType.toLowerCase() === "workspace"
  for (const [key, value] of Object.entries(record)) {
    if (VOLATILE_TOP_LEVEL_KEYS.has(key)) continue
    if (key === "workspaceId") {
      out[key] = IDENTITY_PLACEHOLDER
      continue
    }
    if (key === "scopeId" && isWorkspaceScoped) {
      out[key] = IDENTITY_PLACEHOLDER
      continue
    }
    if (key === "secrets") {
      out[key] = canonicalizeEnvironmentSecrets(value)
      continue
    }
    out[key] = cloneJson(value)
  }
  return out
}

/**
 * Workspace-scoped secret references embed the workspace id in their
 * `reference` (`workspace:<workspaceId>:<name>`). The id differs per surface
 * (local vs cloud), so for `workspace:`-scoped references only the
 * `scopeType:name` tail is meaningful for comparison. Project/workflow/
 * environment-scoped references carry a stable record id and pass through
 * untouched.
 */
function canonicalizeEnvironmentSecrets(value: unknown): JsonValue {
  if (!isPlainObject(value)) return cloneJson(value)
  const out: Record<string, JsonValue> = {}
  for (const [name, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) {
      out[name] = cloneJson(entry)
      continue
    }
    const reference = typeof entry["reference"] === "string" ? (entry["reference"] as string) : null
    let normalizedEntry: Record<string, JsonValue> = {}
    for (const [ek, ev] of Object.entries(entry)) {
      normalizedEntry[ek] = cloneJson(ev)
    }
    if (reference !== null) {
      normalizedEntry["reference"] = canonicalizeSecretReference(reference)
    }
    out[name] = normalizedEntry
  }
  return out
}

function canonicalizeSecretReference(reference: string): string {
  const parts = reference.split(":")
  if (parts.length >= 3 && parts[0]!.toLowerCase() === "workspace") {
    return `workspace:${IDENTITY_PLACEHOLDER}:${parts.slice(2).join(":")}`
  }
  return reference
}

function canonicalizeGeneric(record: JsonObject): CanonicalConflictPayload {
  const out: MutablePayload = {}
  for (const [key, value] of Object.entries(record)) {
    if (VOLATILE_TOP_LEVEL_KEYS.has(key)) continue
    out[key] = cloneJson(value)
  }
  return out
}

type JsonObject = Record<string, unknown>
type MutablePayload = { [key: string]: JsonValue }

function toJsonObject(value: unknown): JsonObject | null {
  if (isPlainObject(value)) {
    return value as JsonObject
  }
  return null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cloneJson(value: unknown): JsonValue {
  if (value === null) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(cloneJson)
  }
  if (isPlainObject(value)) {
    const out: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = cloneJson(v)
    }
    return out
  }
  return null
}
