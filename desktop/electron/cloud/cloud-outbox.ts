/**
 * Durable outbox — writes are enqueued BEFORE the network call.
 *
 * Schema (auto-created on first use):
 *   cloud_outbox (
 *     id TEXT PRIMARY KEY,           -- ULID, unique per enqueue
 *     kind TEXT NOT NULL,            -- 'workspace' | 'project' | 'workflow' | 'environment'
 *     record_id TEXT NOT NULL,       -- ULID of the affected record
 *     workspace_id TEXT NOT NULL,    -- ULID of the owning workspace
 *     expected_rev INTEGER NOT NULL, -- optimistic concurrency precondition
 *     op TEXT NOT NULL,              -- 'upsert' | 'tombstone'
 *     payload BLOB,                  -- JSON-encoded record payload (null for tombstone)
 *     created_at INTEGER NOT NULL    -- ms epoch, for ordering
 *   )
 *
 * Lifecycle:
 *   1. Enqueue(row) — writes to outbox (synchronous, in the same transaction as the local write)
 *   2. push() reads pending rows, sends them to the server
 *   3. MarkApplied(id) — deletes the row on success
 *   4. MarkFailed(id, reason) — leaves the row; next push retries
 *   5. Clear() — used on full_resync_required (drops all pending rows)
 *
 * Re-application is idempotent because the server uses expected_rev precondition.
 */

import type { KVStore, SqliteRow } from "../../core/db"
import { generateId } from "../../core/id"

export type OutboxKind = "workspace" | "project" | "workflow" | "environment"
export type OutboxOp = "upsert" | "tombstone"

export interface OutboxRow {
  readonly id: string
  readonly kind: OutboxKind
  readonly record_id: string
  readonly workspace_id: string
  readonly expected_rev: number
  readonly op: OutboxOp
  readonly payload: Uint8Array | null
  readonly created_at: number
}

interface OutboxDbRow extends SqliteRow {
  readonly id: string
  readonly kind: string
  readonly record_id: string
  readonly workspace_id: string
  readonly expected_rev: number
  readonly op: string
  readonly payload: Buffer | null
  readonly created_at: number
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS cloud_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('workspace', 'project', 'workflow', 'environment')),
  record_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  expected_rev INTEGER NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'tombstone')),
  payload BLOB,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_outbox_created ON cloud_outbox (created_at);
`

export class Outbox {
  private initialized = false

  public constructor(private readonly store: KVStore) {}

  public ensureTable(): void {
    if (this.initialized) return
    this.store.exec(CREATE_TABLE)
    this.initialized = true
  }

  public enqueue(row: Omit<OutboxRow, "id" | "created_at">): string {
    this.ensureTable()
    const id = generateId()
    const createdAt = Date.now()
    const payloadBuffer = row.payload ? Buffer.from(row.payload) : null
    this.store.set(
      "INSERT INTO cloud_outbox (id, kind, record_id, workspace_id, expected_rev, op, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, row.kind, row.record_id, row.workspace_id, row.expected_rev, row.op, payloadBuffer, createdAt],
    )
    return id
  }

  public listPending(limit: number): OutboxRow[] {
    this.ensureTable()
    const rows = this.store.query<OutboxDbRow>(
      "SELECT id, kind, record_id, workspace_id, expected_rev, op, payload, created_at FROM cloud_outbox ORDER BY created_at ASC LIMIT ?",
      [limit],
    )
    return rows.map(dbRowToOutboxRow)
  }

  public markApplied(id: string): void {
    this.ensureTable()
    this.store.delete("DELETE FROM cloud_outbox WHERE id = ?", [id])
  }

  public markFailed(id: string, _reason: string): void {
    // ponytail: row stays in the outbox for retry. A future version could
    // increment a retry_count or set a next_retry_at column. For now, the
    // row is left as-is and the next push() picks it up again.
    this.ensureTable()
    // no-op: row stays pending
  }

  public clear(): void {
    this.ensureTable()
    this.store.delete("DELETE FROM cloud_outbox")
  }

  public count(): number {
    this.ensureTable()
    const row = this.store.get<{ total: number }>("SELECT COUNT(*) as total FROM cloud_outbox")
    return row?.total ?? 0
  }
}

function dbRowToOutboxRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    kind: row.kind as OutboxKind,
    record_id: row.record_id,
    workspace_id: row.workspace_id,
    expected_rev: row.expected_rev,
    op: row.op as OutboxOp,
    payload: row.payload ? new Uint8Array(row.payload) : null,
    created_at: row.created_at,
  }
}
