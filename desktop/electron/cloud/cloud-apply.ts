/**
 * Apply cloud changes to local repositories.
 *
 * Translates a ChangeEnvelope into repository calls. Rejects payloads with
 * forbidden fields (secrets, runs) to prevent a compromised cloud from
 * pushing secret material or runtime-derived data.
 *
 * The apply logic uses the KVStore directly because the existing repositories
 * do not expose upsert-with-specific-rev semantics needed for cloud sync.
 * The service-locator seam is used to obtain the KVStore.
 */

import type { KVStore } from "../../core/db"

// RecordKind mirrors the proto enum (apiweave.v1.RecordKind)
export enum RecordKind {
  UNSPECIFIED = 0,
  WORKSPACE = 1,
  PROJECT = 2,
  WORKFLOW = 3,
  ENVIRONMENT = 4,
}

// ChangeOp mirrors the proto enum (apiweave.v1.ChangeOp)
export enum ChangeOp {
  UNSPECIFIED = 0,
  UPSERT = 1,
  TOMBSTONE = 2,
}

export interface ChangeEnvelope {
  readonly cursor: bigint
  readonly workspaceId: string
  readonly kind: RecordKind
  readonly recordId: string
  readonly rev: bigint
  readonly op: ChangeOp
  readonly payload: Uint8Array
  readonly deletedAt?: string
}

export class ErrForbiddenPayload extends Error {
  constructor(public readonly field: string) {
    super(`forbidden field in cloud payload: ${field}`)
    this.name = "ErrForbiddenPayload"
  }
}

export class ErrUnknownKind extends Error {
  constructor(public readonly kind: RecordKind) {
    super(`unknown record kind: ${kind}`)
    this.name = "ErrUnknownKind"
  }
}

/**
 * Apply a single change to the local store.
 *
 * For UPSERT: parses the payload, validates no forbidden fields, then
 * inserts or updates the record. The rev is set to match the server's rev.
 *
 * For TOMBSTONE: deletes the record if it exists.
 *
 * Throws ErrForbiddenPayload if the payload contains secrets or runs.
 * Throws ErrUnknownKind for unsupported record kinds.
 */
export function applyToRepositories(store: KVStore, change: ChangeEnvelope): void {
  if (change.op === ChangeOp.TOMBSTONE) {
    applyTombstone(store, change)
    return
  }

  if (change.op !== ChangeOp.UPSERT) {
    return // ignore unknown ops
  }

  const payload = parsePayload(change.payload)
  validatePayload(payload)

  switch (change.kind) {
    case RecordKind.WORKSPACE:
      upsertWorkspace(store, change.recordId, change.rev, payload)
      break
    case RecordKind.WORKFLOW:
      upsertWorkflow(store, change.workspaceId, change.recordId, change.rev, payload)
      break
    case RecordKind.ENVIRONMENT:
      upsertEnvironment(store, change.workspaceId, change.recordId, change.rev, payload)
      break
    case RecordKind.PROJECT:
      // ponytail: projects map to collections in the desktop schema.
      // Skip for now — collections are not yet synced.
      break
    default:
      throw new ErrUnknownKind(change.kind)
  }
}

function applyTombstone(store: KVStore, change: ChangeEnvelope): void {
  switch (change.kind) {
    case RecordKind.WORKSPACE:
      store.delete("DELETE FROM workspaces WHERE id = ?", [change.recordId])
      break
    case RecordKind.WORKFLOW:
      store.delete("DELETE FROM workflows WHERE id = ?", [change.recordId])
      break
    case RecordKind.ENVIRONMENT:
      store.delete("DELETE FROM environments WHERE id = ?", [change.recordId])
      break
    case RecordKind.PROJECT:
      store.delete("DELETE FROM collections WHERE id = ?", [change.recordId])
      break
  }
}

function parsePayload(data: Uint8Array): Record<string, unknown> {
  if (data.length === 0) {
    return {}
  }
  const text = new TextDecoder().decode(data)
  return JSON.parse(text) as Record<string, unknown>
}

function validatePayload(payload: Record<string, unknown>): void {
  if (payload["secrets"] !== undefined) {
    const secrets = payload["secrets"]
    if (secrets !== null && typeof secrets === "object" && Object.keys(secrets as object).length > 0) {
      throw new ErrForbiddenPayload("secrets")
    }
  }

  if (payload["runs"] !== undefined) {
    const runs = payload["runs"]
    if (Array.isArray(runs) && runs.length > 0) {
      throw new ErrForbiddenPayload("runs")
    }
  }
}

function upsertWorkspace(store: KVStore, id: string, rev: bigint, payload: Record<string, unknown>): void {
  const existing = store.get<{ id: string }>("SELECT id FROM workspaces WHERE id = ?", [id])
  const name = String(payload["name"] ?? "")
  const slug = String(payload["slug"] ?? name.toLowerCase().replace(/\s+/g, "-"))
  const origin = String(payload["origin"] ?? "cloud")
  const syncMode = String(payload["syncMode"] ?? "bi-directional")
  const settingsJson = JSON.stringify({
    description: payload["description"] ?? null,
    isPersonal: payload["isPersonal"] ?? false,
    deletedAt: null,
  })

  if (existing) {
    store.set(
      "UPDATE workspaces SET name = ?, slug = ?, origin = ?, syncMode = ?, settings_json = ?, rev = ?, updatedAt = datetime('now') WHERE id = ?",
      [name, slug, origin, syncMode, settingsJson, Number(rev), id],
    )
  } else {
    store.set(
      "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, name, slug, origin, syncMode, settingsJson, Number(rev)],
    )
  }
}

function upsertWorkflow(
  store: KVStore,
  workspaceId: string,
  id: string,
  rev: bigint,
  payload: Record<string, unknown>,
): void {
  const existing = store.get<{ id: string }>("SELECT id FROM workflows WHERE id = ?", [id])
  const name = String(payload["name"] ?? "")
  const slug = name.toLowerCase().replace(/\s+/g, "-") + "-" + id.slice(-6)
  const graphJson = JSON.stringify(payload["graph"] ?? { nodes: [], edges: [] })
  const variablesJson = JSON.stringify(payload["variables"] ?? {})
  const settingsJson = JSON.stringify({
    description: payload["description"] ?? null,
    tags: payload["tags"] ?? [],
    collectionId: payload["collectionId"] ?? null,
    selectedEnvironmentId: payload["selectedEnvironmentId"] ?? null,
    nodeTemplates: payload["nodeTemplates"] ?? [],
  })

  if (existing) {
    store.set(
      "UPDATE workflows SET name = ?, slug = ?, graph_json = ?, variables_json = ?, settings_json = ?, rev = ?, updatedAt = datetime('now') WHERE id = ?",
      [name, slug, graphJson, variablesJson, settingsJson, Number(rev), id],
    )
  } else {
    store.set(
      "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, workspaceId, workspaceId, name, slug, graphJson, variablesJson, settingsJson, Number(rev)],
    )
  }
}

function upsertEnvironment(
  store: KVStore,
  workspaceId: string,
  id: string,
  rev: bigint,
  payload: Record<string, unknown>,
): void {
  const existing = store.get<{ id: string }>("SELECT id FROM environments WHERE id = ?", [id])
  const name = String(payload["name"] ?? "")
  const slug = name.toLowerCase().replace(/\s+/g, "-") + "-" + id.slice(-6)
  const variablesJson = JSON.stringify(payload["variables"] ?? {})
  const settingsJson = JSON.stringify({
    description: payload["description"] ?? null,
    swaggerDocUrl: payload["swaggerDocUrl"] ?? null,
    secrets: {},
    isDefault: payload["isDefault"] ?? false,
  })

  if (existing) {
    store.set(
      "UPDATE environments SET name = ?, slug = ?, variables_json = ?, settings_json = ?, rev = ?, updatedAt = datetime('now') WHERE id = ?",
      [name, slug, variablesJson, settingsJson, Number(rev), id],
    )
  } else {
    store.set(
      "INSERT INTO environments (id, workspace_id, scopeId, name, slug, variables_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, workspaceId, workspaceId, name, slug, variablesJson, settingsJson, Number(rev)],
    )
  }
}
