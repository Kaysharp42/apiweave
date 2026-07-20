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
 *     retry_count INTEGER NOT NULL,  -- terminal at CLOUD_OUTBOX_MAX_RETRIES
 *     next_retry_at INTEGER NOT NULL,-- ms epoch, exponential backoff deadline
 *     failure_reason TEXT,           -- latest redacted transport/server diagnostic
 *     created_at INTEGER NOT NULL    -- ms epoch, for ordering
 *   )
 *
 * Lifecycle:
 *   1. Enqueue(row) — writes to outbox (synchronous, in the same transaction as the local write)
 *   2. push() reads pending rows, sends them to the server
 *   3. MarkApplied(id) — deletes the row on success
 *   4. MarkFailed(id, reason) — leaves the row; retries up to the dead-letter ceiling
 *   5. Clear() — reserved for confirmed account cleanup; full resync preserves rows
 *
 * Re-application is idempotent because the server uses expected_rev precondition.
 */

import type { KVStore } from "../../core/db"
import { CloudSyncRepository, type CloudOutboxKind, type CloudOutboxOp, type CloudOutboxRow } from "../../core/repositories"

export type OutboxKind = CloudOutboxKind
export type OutboxOp = CloudOutboxOp

export type OutboxRow = CloudOutboxRow
export type OutboxInput = Omit<
  OutboxRow,
  "id" | "created_at" | "retry_count" | "next_retry_at" | "failure_reason" | "is_baseline"
> & { readonly is_baseline?: boolean }

export class Outbox {
  private readonly repository: CloudSyncRepository

  public constructor(store: KVStore | CloudSyncRepository) {
    this.repository = store instanceof CloudSyncRepository ? store : new CloudSyncRepository(store)
  }

  public ensureTable(): void {
    // Created by 005_cloud_sync.sql. Kept for compatibility with older callers.
  }

  public enqueue(row: OutboxInput): string {
    return this.repository.enqueueOutbox(row)
  }

  public markApplied(id: string, serverRev: number): void {
    this.repository.markOutboxApplied(id, serverRev)
  }

  public markFailed(id: string, reason: string): void {
    this.repository.markOutboxFailed(id, reason)
  }

  public markDeadLetter(id: string, reason: string): void {
    this.repository.markOutboxDeadLetter(id, reason)
  }

  public clear(): void {
    this.repository.clearOutbox()
  }

  public count(): number {
    return this.repository.countOutbox()
  }

  public countDeadLetters(): number {
    return this.repository.countDeadLetterOutbox()
  }
}
