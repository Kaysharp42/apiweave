import { z } from "zod"
import type { KVStore, SqliteRow } from "../../core/db"
import { ConflictError, NotFoundError, ValidationError } from "../../core/ipc/errors"
import type { IpcRouter } from "../../core/ipc/router"
import { applyToRepositories, ChangeOp, RecordKind } from "./cloud-apply"

export const CLOUD_CONFLICT_DOMAIN = "cloud"
export const CONFLICT_LIST_ACTION = "conflict-list"
export const CONFLICT_GET_ACTION = "conflict-get"
export const CONFLICT_RESOLVE_ACTION = "conflict-resolve"
export const CONFLICT_FETCH_LOSER_ACTION = "conflict-fetch-loser"

type ConflictWinner = "local" | "cloud"
type ConflictKind = "workspace" | "project" | "collection" | "workflow" | "environment"
type JsonRecord = Record<string, unknown>

interface ConflictSnapshotRow extends SqliteRow {
  readonly id: string
  readonly workspace_id: string
  readonly kind: ConflictKind
  readonly record_id: string
  readonly local_payload: string | Buffer
  readonly cloud_payload: string | Buffer
  readonly local_rev: number
  readonly cloud_rev: number
  readonly winner: ConflictWinner | null
  readonly loser_payload: string | Buffer | null
  readonly created_at: string | number
  readonly resolved_at: string | number | null
}

export interface ResolveConflictInput {
  readonly conflict_id: string
  readonly winner: ConflictWinner
  readonly device_id: string
}

export interface SyncConflictResolver {
  readonly resolveConflict: (input: ResolveConflictInput) => Promise<void>
}

export interface ConflictUiBridgeOptions {
  readonly store: KVStore
  readonly syncService: SyncConflictResolver
}

const winnerSchema = z.enum(["local", "cloud"])
const kindSchema = z.enum(["workspace", "project", "collection", "workflow", "environment"])
const conflictListItemSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  kind: kindSchema,
  record_id: z.string(),
  local_rev: z.number(),
  cloud_rev: z.number(),
  winner: winnerSchema.nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable().optional(),
})
const conflictSchema = conflictListItemSchema.extend({
  local_payload: z.record(z.string(), z.unknown()),
  cloud_payload: z.record(z.string(), z.unknown()),
})

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS conflict_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('workspace', 'project', 'collection', 'workflow', 'environment')),
  record_id TEXT NOT NULL,
  local_payload BLOB NOT NULL,
  cloud_payload BLOB NOT NULL,
  local_rev INTEGER NOT NULL,
  cloud_rev INTEGER NOT NULL,
  winner TEXT CHECK (winner IN ('local', 'cloud')),
  loser_payload BLOB,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conflict_snapshots_unresolved ON conflict_snapshots (winner, created_at);
CREATE INDEX IF NOT EXISTS idx_conflict_snapshots_resolved ON conflict_snapshots (resolved_at);
`

export function registerConflictUiHandlers(router: IpcRouter, options: ConflictUiBridgeOptions): void {
  const bridge = new ConflictUiBridge(options)
  router.register(CLOUD_CONFLICT_DOMAIN, CONFLICT_LIST_ACTION, {
    input: z.object({ resolved: z.boolean().optional(), since_days: z.number().optional() }).optional().default({}),
    output: z.array(conflictListItemSchema),
    handle: (input) => bridge.list(input),
  })
  router.register(CLOUD_CONFLICT_DOMAIN, CONFLICT_GET_ACTION, {
    input: z.object({ conflict_id: z.string().min(1) }),
    output: conflictSchema,
    handle: ({ conflict_id }) => bridge.get(conflict_id),
  })
  router.register(CLOUD_CONFLICT_DOMAIN, CONFLICT_RESOLVE_ACTION, {
    input: z.object({ conflict_id: z.string().min(1), winner: winnerSchema, device_id: z.string().min(1) }),
    output: conflictSchema,
    handle: (input) => bridge.resolve(input),
  })
  router.register(CLOUD_CONFLICT_DOMAIN, CONFLICT_FETCH_LOSER_ACTION, {
    input: z.object({ conflict_id: z.string().min(1) }),
    output: z.record(z.string(), z.unknown()),
    handle: ({ conflict_id }) => bridge.fetchLoser(conflict_id),
  })
}

export class ConflictUiBridge {
  private initialized = false

  public constructor(private readonly options: ConflictUiBridgeOptions) {}

  public list(input: { readonly resolved?: boolean; readonly since_days?: number } = {}): readonly z.infer<typeof conflictListItemSchema>[] {
    this.ensureTable()
    const resolved = input.resolved ?? false
    const days = input.since_days ?? 30
    const rows = resolved
      ? this.options.store.query<ConflictSnapshotRow>(
          "SELECT * FROM conflict_snapshots WHERE winner IS NOT NULL AND datetime(resolved_at) >= datetime('now', ?) ORDER BY datetime(resolved_at) DESC",
          [`-${days} days`],
        )
      : this.options.store.query<ConflictSnapshotRow>(
          "SELECT * FROM conflict_snapshots WHERE winner IS NULL ORDER BY datetime(created_at) DESC",
        )
    return rows.map(rowToListItem)
  }

  public get(conflictId: string): z.infer<typeof conflictSchema> {
    this.ensureTable()
    const row = this.getRow(conflictId)
    return rowToConflict(row)
  }

  public async resolve(input: ResolveConflictInput): Promise<z.infer<typeof conflictSchema>> {
    this.ensureTable()
    const row = this.getRow(input.conflict_id)
    if (row.winner !== null) {
      throw new ConflictError("Conflict already resolved", { conflict_id: input.conflict_id })
    }

    await this.options.syncService.resolveConflict(input)

    const chosen = input.winner === "local" ? parsePayload(row.local_payload) : parsePayload(row.cloud_payload)
    const loser = input.winner === "local" ? parsePayload(row.cloud_payload) : parsePayload(row.local_payload)
    const rev = input.winner === "local" ? row.local_rev : row.cloud_rev

    this.options.store.transaction(() => {
      applyChosenPayload(this.options.store, row, chosen, rev)
      this.options.store.set(
        "UPDATE conflict_snapshots SET winner = ?, loser_payload = ?, resolved_at = ? WHERE id = ? AND winner IS NULL",
        [input.winner, Buffer.from(JSON.stringify(loser)), new Date().toISOString(), row.id],
      )
    })

    return this.get(input.conflict_id)
  }

  public fetchLoser(conflictId: string): JsonRecord {
    this.ensureTable()
    const row = this.getRow(conflictId)
    if (row.winner === null) {
      throw new ValidationError("Conflict is not resolved", { conflict_id: conflictId })
    }
    if (row.loser_payload !== null) {
      return parsePayload(row.loser_payload)
    }
    return row.winner === "local" ? parsePayload(row.cloud_payload) : parsePayload(row.local_payload)
  }

  private ensureTable(): void {
    if (this.initialized) return
    this.options.store.exec(CREATE_TABLE)
    this.initialized = true
  }

  private getRow(conflictId: string): ConflictSnapshotRow {
    const row = this.options.store.get<ConflictSnapshotRow>("SELECT * FROM conflict_snapshots WHERE id = ?", [conflictId])
    if (!row) throw new NotFoundError("Conflict not found", { conflict_id: conflictId })
    return row
  }
}

function rowToListItem(row: ConflictSnapshotRow): z.infer<typeof conflictListItemSchema> {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    kind: row.kind,
    record_id: row.record_id,
    local_rev: Number(row.local_rev),
    cloud_rev: Number(row.cloud_rev),
    winner: row.winner,
    created_at: normalizeDate(row.created_at),
    resolved_at: row.resolved_at === null ? null : normalizeDate(row.resolved_at),
  }
}

function rowToConflict(row: ConflictSnapshotRow): z.infer<typeof conflictSchema> {
  return {
    ...rowToListItem(row),
    local_payload: parsePayload(row.local_payload),
    cloud_payload: parsePayload(row.cloud_payload),
  }
}

function parsePayload(value: string | Buffer): JsonRecord {
  const text = typeof value === "string" ? value : Buffer.from(value).toString("utf8")
  const parsed = JSON.parse(text) as unknown
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError("Conflict payload must be a JSON object")
  }
  return parsed as JsonRecord
}

function normalizeDate(value: string | number): string {
  return typeof value === "number" ? new Date(value).toISOString() : value
}

function applyChosenPayload(store: KVStore, row: ConflictSnapshotRow, payload: JsonRecord, rev: number): void {
  if (row.kind === "project" || row.kind === "collection") {
    upsertCollection(store, row, payload, rev)
    return
  }
  applyToRepositories(store, {
    cursor: 0n,
    workspaceId: row.workspace_id,
    kind: toRecordKind(row.kind),
    recordId: row.record_id,
    rev: BigInt(rev),
    op: ChangeOp.UPSERT,
    payload: new TextEncoder().encode(JSON.stringify(payload)),
  })
}

function toRecordKind(kind: Exclude<ConflictKind, "project" | "collection">): RecordKind {
  switch (kind) {
    case "workspace": return RecordKind.WORKSPACE
    case "workflow": return RecordKind.WORKFLOW
    case "environment": return RecordKind.ENVIRONMENT
  }
}

function upsertCollection(store: KVStore, row: ConflictSnapshotRow, payload: JsonRecord, rev: number): void {
  const existing = store.get<{ id: string }>("SELECT id FROM collections WHERE id = ?", [row.record_id])
  const name = String(payload["name"] ?? "")
  const slug = String(payload["slug"] ?? `${name.toLowerCase().replace(/\s+/g, "-")}-${row.record_id.slice(-6)}`)
  const settingsJson = JSON.stringify({
    description: payload["description"] ?? null,
    color: payload["color"] ?? null,
    order: payload["order"] ?? [],
  })
  if (existing) {
    store.set(
      "UPDATE collections SET name = ?, slug = ?, settings_json = ?, rev = ?, updatedAt = datetime('now') WHERE id = ?",
      [name, slug, settingsJson, rev, row.record_id],
    )
  } else {
    store.set(
      "INSERT INTO collections (id, workspace_id, scopeId, name, slug, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [row.record_id, row.workspace_id, row.workspace_id, name, slug, settingsJson, rev],
    )
  }
}
