// fallow-ignore-file code-duplication -- persistence models and SQLite rows intentionally mirror each other
import type { KVStore, SqliteRow } from "../db"
import { generateId } from "../id"
import { slugify } from "./helpers"
import { sanitizeCloudSnapshotPayload } from "../sync/cloud-mutations"
import { containsCredentialMaterial, isSyncSensitiveKey, isWithheldSyncValue } from "../services/secret_utils"
import { ChangeOp, RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"
import type { WorkspaceOrigin } from "@shared/types/WorkspaceOrigin"
import { canonicalizeSyncPayload } from "@shared/conflict-diff"

export type CloudOutboxKind = "workspace" | "project" | "workflow" | "environment"
export type CloudOutboxOp = "upsert" | "tombstone"

export interface CloudCursorState {
  readonly cursor: bigint
  readonly lastRev: bigint
}

export interface CloudOutboxRow {
  readonly id: string
  readonly kind: CloudOutboxKind
  readonly record_id: string
  readonly workspace_id: string
  readonly expected_rev: number
  readonly op: CloudOutboxOp
  readonly payload: Uint8Array | null
  readonly retry_count: number
  readonly next_retry_at: number
  readonly failure_reason: string | null
  readonly created_at: number
  readonly is_baseline: boolean
}

/**
 * A dead-lettered outbox row, described for the UI. `recordName` is resolved
 * from the record's own table at read time so the user sees "Actor Module",
 * not a ULID; it is absent when the record was deleted locally after the push
 * was queued. `failureReason` is the same user-facing sentence the row already
 * stores — machine codes never reach it.
 */
export interface CloudFailedRecord {
  readonly outboxId: string
  readonly kind: CloudOutboxKind
  readonly recordId: string
  readonly recordName?: string
  readonly op: CloudOutboxOp
  readonly failureReason?: string
  readonly attempts: number
  readonly queuedAt: string
}

export interface CloudDeviceUpsert {
  readonly deviceId: string
  readonly label: string
  readonly clientVersion: string
  readonly publicKey: Uint8Array
  readonly createdAt: string
}

export interface CloudDevice {
  readonly deviceId: string
  readonly label: string
  readonly clientVersion: string
  readonly createdAt: string
}

export interface CloudWorkspaceBindingUpsert {
  readonly workspaceId: string
  readonly cloudWorkspaceId: string
  readonly cloudWorkspaceName: string
  readonly teamId?: string | null
  readonly teamName?: string | null
  readonly syncMode: string
  readonly localOrigin?: WorkspaceOrigin
  readonly deviceId?: string
  readonly initializationState: CloudBindingInitializationState
}

export type CloudBindingInitializationState = "pulling" | "pushing" | "initialized"

export interface CloudWorkspaceBinding {
  readonly workspaceId: string
  readonly cloudWorkspaceId: string
  readonly cloudWorkspaceName: string
  readonly teamId: string | null
  readonly teamName: string | null
  readonly syncMode: string
  readonly localOrigin: WorkspaceOrigin
  readonly deviceId: string | null
  readonly initializationState: CloudBindingInitializationState
  readonly boundAt: string
  readonly lastSyncedAt: string | null
  readonly initializedAt: string | null
  readonly lastError: string | null
}

export interface CloudChangeEnvelope {
  readonly cursor: bigint
  readonly workspaceId: string
  readonly kind: RecordKind
  readonly recordId: string
  readonly rev: bigint
  readonly op: ChangeOp
  readonly payload: Uint8Array
  readonly deletedAt?: string
}

export type CloudApplyResult = "applied" | "ignored" | "conflict"
// The stored resolution outcome. A server-side auto-merge is recorded as
// 'local' (local edits survived the merge); 'merged' is not a stored value on
// the desktop — see migration 011 and resolveConflictMerged.
export type CloudConflictWinner = "local" | "cloud"

// Cloud-side writer attribution (who wrote the cloud copy), resolved by the
// server and carried on a push-conflict outcome. Every field may be empty when
// the server could not attribute the write (legacy snapshot, deleted user).
export interface CloudConflictWriter {
  readonly userId: string
  readonly deviceId: string
  readonly name: string
  readonly deviceLabel: string
}

export interface CloudConflict {
  readonly conflictId: string
  readonly serverConflictId: string | null
  readonly workspaceId: string
  readonly kind: CloudOutboxKind
  readonly recordId: string
  readonly baseRev: number
  readonly localPayload: Uint8Array | null
  readonly cloudPayload: Uint8Array | null
  readonly localRev: number
  readonly cloudRev: number
  readonly localOp: CloudOutboxOp
  readonly cloudOp: CloudOutboxOp
  readonly winner: CloudConflictWinner | null
  readonly status: "pending" | "resolved"
  readonly createdAt: string
  readonly resolvedAt: string | null
  readonly cloudWriter: CloudConflictWriter | null
  // True when the server reported this conflict as cleanly 3-way auto-mergeable
  // (PushOutcome.auto_mergeable), so the UI can offer a one-click Auto-merge.
  readonly autoMergeable: boolean
  // Leaf paths both sides changed differently on an otherwise-mergeable conflict
  // (PushOutcome.merge_residual_paths). Non-empty => the UI offers per-field
  // picking; the merge completes with those picks server-side.
  readonly mergeResidualPaths: readonly string[]
}

export interface CloudPushConflictInput {
  readonly conflictId: string
  readonly outboxRow: CloudOutboxRow
  readonly cloudPayload: Uint8Array
  readonly cloudRev: number
  readonly cloudWriter?: CloudConflictWriter | null
  readonly autoMergeable?: boolean
  readonly mergeResidualPaths?: readonly string[]
}

interface SettingRow extends SqliteRow {
  readonly value: string
}

interface OutboxDbRow extends SqliteRow {
  readonly id: string
  readonly kind: string
  readonly record_id: string
  readonly workspace_id: string
  readonly expected_rev: number
  readonly op: string
  readonly payload: Buffer | null
  readonly retry_count: number
  readonly next_retry_at: number
  readonly failure_reason: string | null
  readonly created_at: number
  readonly is_baseline: number
}

interface CloudWorkspaceBindingDbRow extends SqliteRow {
  readonly workspace_id: string
  readonly cloud_workspace_id: string
  readonly cloud_workspace_name: string
  readonly team_id: string | null
  readonly team_name: string | null
  readonly sync_mode: string
  readonly local_origin: string
  readonly device_id: string | null
  readonly initialization_state: CloudBindingInitializationState
  readonly boundAt: string
  readonly lastSyncedAt: string | null
  readonly initializedAt: string | null
  readonly last_error: string | null
}

interface CloudDeviceDbRow extends SqliteRow {
  readonly device_id: string
  readonly label: string
  readonly client_version: string
  readonly createdAt: string
}

interface CloudRecordStateRow extends SqliteRow {
  readonly workspace_id: string
  readonly kind: CloudOutboxKind
  readonly record_id: string
  readonly server_rev: number
  readonly local_rev: number
  readonly dirty: number
  readonly conflict_id: string | null
}

interface CloudConflictDbRow extends SqliteRow {
  readonly conflict_id: string
  readonly server_conflict_id: string | null
  readonly workspace_id: string
  readonly kind: CloudOutboxKind
  readonly record_id: string
  readonly base_rev: number
  readonly local_payload: Buffer | null
  readonly cloud_payload: Buffer | null
  readonly local_rev: number
  readonly cloud_rev: number
  readonly local_op: CloudOutboxOp
  readonly cloud_op: CloudOutboxOp
  readonly winner: CloudConflictWinner | null
  readonly status: "pending" | "resolved"
  readonly createdAt: string
  readonly resolvedAt: string | null
  readonly cloud_writer_user_id: string | null
  readonly cloud_writer_device_id: string | null
  readonly cloud_writer_name: string | null
  readonly cloud_writer_device_label: string | null
  readonly auto_mergeable: number
  readonly merge_residual_paths: string
}

// Maps a conflict kind to the local table holding its display name.
// Table names are a fixed allowlist here — never interpolate untrusted input into SQL.
const RECORD_KIND_TABLES: Record<string, string> = {
  workspace: "workspaces",
  project: "collections",
  collection: "collections",
  workflow: "workflows",
  environment: "environments",
}
const KEY_CURSOR = "cloud.cursor."
const KEY_LAST_REV = "cloud.last_rev."
const KEY_LAST_FULL_SYNC = "cloud.last_full_sync."
const WORKSPACE_BINDING_SELECT = `SELECT workspace_id, cloud_workspace_id, cloud_workspace_name,
  team_id, team_name, sync_mode, local_origin, device_id, initialization_state, boundAt, lastSyncedAt,
  initializedAt, last_error FROM cloud_workspace_bindings`

export const CLOUD_OUTBOX_MAX_RETRIES = 10

export class ErrForbiddenCloudPayload extends Error {
  public constructor(public readonly field: string) {
    super(`forbidden field in cloud payload: ${field}`)
    this.name = "ErrForbiddenCloudPayload"
  }
}

export class ErrUnknownCloudKind extends Error {
  public constructor(public readonly kind: RecordKind) {
    super(`unknown record kind: ${kind}`)
    this.name = "ErrUnknownCloudKind"
  }
}

export class CloudSyncRepository {
  public constructor(private readonly store: KVStore) {}

  public transaction<T>(fn: (repository: CloudSyncRepository) => T): T {
    return this.store.transaction((tx) => fn(new CloudSyncRepository(tx)))
  }

  public getSetting(key: string): string | undefined {
    return this.store.get<SettingRow>("SELECT value FROM app_settings WHERE key = ?", [key])?.value
  }

  public setSetting(key: string, value: string): void {
    this.store.set("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [key, value])
  }

  public deleteSetting(key: string): void {
    this.store.delete("DELETE FROM app_settings WHERE key = ?", [key])
  }

  public getCursor(workspaceId: string): CloudCursorState | undefined {
    const cursor = this.getSetting(KEY_CURSOR + workspaceId)
    if (cursor === undefined) {
      return undefined
    }
    const lastRev = this.getSetting(KEY_LAST_REV + workspaceId)
    return {
      cursor: BigInt(cursor),
      lastRev: lastRev === undefined ? 0n : BigInt(lastRev),
    }
  }

  public setCursor(workspaceId: string, cursor: bigint, lastRev: bigint): void {
    this.setSetting(KEY_CURSOR + workspaceId, cursor.toString())
    this.setSetting(KEY_LAST_REV + workspaceId, lastRev.toString())
  }

  public setFullSync(workspaceId: string, timestampMs: number): void {
    this.setSetting(KEY_LAST_FULL_SYNC + workspaceId, timestampMs.toString())
  }

  public getFullSync(workspaceId: string): number | undefined {
    const value = this.getSetting(KEY_LAST_FULL_SYNC + workspaceId)
    return value === undefined ? undefined : Number(value)
  }

  public resetCursor(workspaceId: string): void {
    this.deleteSetting(KEY_CURSOR + workspaceId)
    this.deleteSetting(KEY_LAST_REV + workspaceId)
    this.deleteSetting(KEY_LAST_FULL_SYNC + workspaceId)
  }

  public enqueueOutbox(
    row: Omit<CloudOutboxRow, "id" | "created_at" | "retry_count" | "next_retry_at" | "failure_reason" | "is_baseline">
      & { readonly is_baseline?: boolean },
  ): string {
    const id = generateId()
    const payloadBuffer = row.payload === null ? null : Buffer.from(row.payload)
    const existingConflictId = this.getRecordState(row.workspace_id, row.kind, row.record_id)?.conflict_id ?? null
    this.store.set(
      "INSERT INTO cloud_outbox (id, kind, record_id, workspace_id, expected_rev, op, payload, created_at, is_baseline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, row.kind, row.record_id, row.workspace_id, row.expected_rev, row.op, payloadBuffer, Date.now(), row.is_baseline ? 1 : 0],
    )
    this.upsertRecordState(row.workspace_id, row.kind, row.record_id, {
      serverRev: row.expected_rev,
      localRev: row.expected_rev + 1,
      dirty: true,
      conflictId: existingConflictId,
      preserveServerRev: true,
      preserveLocalRev: true,
    })
    return id
  }

  public enqueueBaselineOutbox(
    row: Omit<CloudOutboxRow, "id" | "created_at" | "retry_count" | "next_retry_at" | "failure_reason" | "is_baseline">,
  ): string {
    const existing = this.store.get<{ id: string } & SqliteRow>(
      "SELECT id FROM cloud_outbox WHERE workspace_id = ? AND kind = ? AND record_id = ? AND is_baseline = 1",
      [row.workspace_id, row.kind, row.record_id],
    )
    return existing?.id ?? this.enqueueOutbox({ ...row, is_baseline: true })
  }

  public listPendingOutbox(limit: number, nowMs = Date.now()): readonly CloudOutboxRow[] {
    return this.listPendingOutboxRows(undefined, limit, nowMs)
  }

  public listPendingOutboxForWorkspace(workspaceId: string, limit: number, nowMs = Date.now()): readonly CloudOutboxRow[] {
    return this.listPendingOutboxRows(workspaceId, limit, nowMs)
  }

  private listPendingOutboxRows(workspaceId: string | undefined, limit: number, nowMs: number): readonly CloudOutboxRow[] {
    const workspaceClause = workspaceId === undefined ? "" : "o.workspace_id = ? AND "
    const params = workspaceId === undefined
      ? [CLOUD_OUTBOX_MAX_RETRIES, nowMs, limit]
      : [workspaceId, CLOUD_OUTBOX_MAX_RETRIES, nowMs, limit]
    return this.store
      .query<OutboxDbRow>(
        `SELECT o.id, o.kind, o.record_id, o.workspace_id, o.expected_rev, o.op, o.payload,
                o.retry_count, o.next_retry_at, o.failure_reason, o.created_at, o.is_baseline
         FROM cloud_outbox o
         WHERE ${workspaceClause}o.retry_count < ? AND o.next_retry_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM cloud_outbox earlier
             WHERE earlier.workspace_id = o.workspace_id AND earlier.kind = o.kind
               AND earlier.record_id = o.record_id
               AND (earlier.created_at < o.created_at
                 OR (earlier.created_at = o.created_at AND earlier.rowid < o.rowid))
           )
           AND NOT EXISTS (
             SELECT 1 FROM cloud_record_state s
             WHERE s.workspace_id = o.workspace_id AND s.kind = o.kind
               AND s.record_id = o.record_id AND s.conflict_id IS NOT NULL
           )
         ORDER BY o.created_at ASC, o.rowid ASC LIMIT ?`,
        params,
      )
      .map(rowToOutboxRow)
  }

  public markOutboxApplied(id: string, serverRev: number): void {
    this.transaction((repository) => repository.markOutboxAppliedInTransaction(id, serverRev))
  }

  private markOutboxAppliedInTransaction(id: string, serverRev: number): void {
    const applied = this.store.get<OutboxDbRow>(
      "SELECT id, kind, record_id, workspace_id, expected_rev, op, payload, retry_count, next_retry_at, failure_reason, created_at, is_baseline FROM cloud_outbox WHERE id = ?",
      [id],
    )
    this.store.delete("DELETE FROM cloud_outbox WHERE id = ?", [id])
    if (applied === undefined) {
      return
    }
    const remaining = this.store.get<{ local_rev: number } & SqliteRow>(
      "SELECT MAX(expected_rev + 1) AS local_rev FROM cloud_outbox WHERE workspace_id = ? AND kind = ? AND record_id = ?",
      [applied.workspace_id, applied.kind, applied.record_id],
    )?.local_rev
    this.upsertRecordState(applied.workspace_id, applied.kind as CloudOutboxKind, applied.record_id, {
      serverRev,
      localRev: remaining ?? serverRev,
      dirty: remaining !== null && remaining !== undefined,
      conflictId: null,
    })
  }

  public markOutboxFailed(id: string, reason: string, nowMs = Date.now()): void {
    const row = this.store.get<{ retry_count: number } & SqliteRow>("SELECT retry_count FROM cloud_outbox WHERE id = ?", [id])
    const retryCount = Math.min((row?.retry_count ?? 0) + 1, CLOUD_OUTBOX_MAX_RETRIES)
    const backoffMs = Math.min(5 * 60 * 1000, 1000 * 2 ** Math.min(retryCount - 1, 8))
    this.store.set(
      "UPDATE cloud_outbox SET retry_count = ?, next_retry_at = ?, failure_reason = ? WHERE id = ?",
      [retryCount, nowMs + backoffMs, reason.slice(0, 1000), id],
    )
  }

  public markOutboxDeadLetter(id: string, reason: string): void {
    this.store.set(
      "UPDATE cloud_outbox SET retry_count = ?, next_retry_at = 0, failure_reason = ? WHERE id = ?",
      [CLOUD_OUTBOX_MAX_RETRIES, reason.slice(0, 1000), id],
    )
  }

  public deadLetterOutboxOutsideWorkspaces(workspaceIds: readonly string[], reason: string): number {
    const boundClause = workspaceIds.length === 0
      ? ""
      : `AND workspace_id NOT IN (${workspaceIds.map(() => "?").join(", ")})`
    return this.store.set(
      `UPDATE cloud_outbox
       SET retry_count = ?, next_retry_at = 0, failure_reason = ?
       WHERE retry_count < ? ${boundClause}`,
      [CLOUD_OUTBOX_MAX_RETRIES, reason.slice(0, 1000), CLOUD_OUTBOX_MAX_RETRIES, ...workspaceIds],
    ).changes
  }

  /**
   * Re-queue dead-lettered rows for a workspace: reset the retry counter,
   * clear the backoff and the recorded failure so the normal push loop picks
   * them up again. Idempotent on the wire — the server dedups by expected_rev,
   * so replaying a mutation cannot double-apply. Returns rows re-queued.
   */
  public retryDeadLetterOutbox(workspaceId: string): number {
    return this.store.set(
      "UPDATE cloud_outbox SET retry_count = 0, next_retry_at = 0, failure_reason = NULL WHERE workspace_id = ? AND retry_count >= ?",
      [workspaceId, CLOUD_OUTBOX_MAX_RETRIES],
    ).changes
  }

  /**
   * Drop dead-lettered rows for a workspace. This deletes only the queued
   * mutation, never the local record it describes — the record stays in its
   * own repository and simply stops trying to sync. Destructive to the queued
   * push, so callers must confirm first. Returns rows discarded.
   */
  public discardDeadLetterOutbox(workspaceId: string): number {
    return this.store.delete(
      "DELETE FROM cloud_outbox WHERE workspace_id = ? AND retry_count >= ?",
      [workspaceId, CLOUD_OUTBOX_MAX_RETRIES],
    ).changes
  }

  public clearOutbox(): void {
    this.store.delete("DELETE FROM cloud_outbox")
  }

  public countOutbox(): number {
    return this.store.get<{ total: number } & SqliteRow>("SELECT COUNT(*) as total FROM cloud_outbox")?.total ?? 0
  }

  public countPendingOutbox(workspaceId?: string): number {
    const workspaceClause = workspaceId === undefined ? "" : " AND workspace_id = ?"
    return this.store.get<{ total: number } & SqliteRow>(
      `SELECT COUNT(*) AS total FROM cloud_outbox WHERE retry_count < ?${workspaceClause}`,
      workspaceId === undefined ? [CLOUD_OUTBOX_MAX_RETRIES] : [CLOUD_OUTBOX_MAX_RETRIES, workspaceId],
    )?.total ?? 0
  }

  public countBaselineOutbox(workspaceId: string): number {
    return this.store.get<{ total: number } & SqliteRow>(
      "SELECT COUNT(*) AS total FROM cloud_outbox WHERE workspace_id = ? AND is_baseline = 1 AND retry_count < ?",
      [workspaceId, CLOUD_OUTBOX_MAX_RETRIES],
    )?.total ?? 0
  }

  public expectedRevisionForMutation(
    workspaceId: string,
    kind: CloudOutboxKind,
    recordId: string,
    fallback: number,
  ): number {
    const state = this.getRecordState(workspaceId, kind, recordId)
    const queued = this.store.get<{ next_rev: number | null } & SqliteRow>(
      "SELECT MAX(expected_rev + 1) AS next_rev FROM cloud_outbox WHERE workspace_id = ? AND kind = ? AND record_id = ?",
      [workspaceId, kind, recordId],
    )?.next_rev
    if (state === undefined && queued == null) {
      return fallback
    }
    return Math.max(state?.server_rev ?? 0, queued ?? 0)
  }

  public countDeadLetterOutbox(workspaceId?: string): number {
    const workspaceClause = workspaceId === undefined ? "" : " AND workspace_id = ?"
    return this.store.get<{ total: number } & SqliteRow>(
      `SELECT COUNT(*) as total FROM cloud_outbox WHERE retry_count >= ?${workspaceClause}`,
      workspaceId === undefined ? [CLOUD_OUTBOX_MAX_RETRIES] : [CLOUD_OUTBOX_MAX_RETRIES, workspaceId],
    )?.total ?? 0
  }

  /**
   * The dead-lettered rows for a workspace, named for display. A count alone
   * ("1 failed") leaves the user hunting through every workflow for the one
   * that is stuck, so the UI needs the record behind each failure.
   */
  public listDeadLetterOutbox(workspaceId: string): readonly CloudFailedRecord[] {
    const rows = this.store.query<OutboxDbRow>(
      "SELECT * FROM cloud_outbox WHERE workspace_id = ? AND retry_count >= ? ORDER BY created_at ASC",
      [workspaceId, CLOUD_OUTBOX_MAX_RETRIES],
    )
    return rows.map((row): CloudFailedRecord => {
      const name = this.getRecordName(row.kind, row.record_id)
      return {
        outboxId: row.id,
        kind: row.kind as CloudOutboxKind,
        recordId: row.record_id,
        ...(name !== undefined ? { recordName: name } : {}),
        op: row.op as CloudOutboxOp,
        ...(row.failure_reason !== null ? { failureReason: row.failure_reason } : {}),
        attempts: row.retry_count,
        queuedAt: new Date(row.created_at).toISOString(),
      }
    })
  }

  public countPendingConflicts(workspaceId?: string): number {
    const workspaceClause = workspaceId === undefined ? "" : " AND workspace_id = ?"
    return this.store.get<{ total: number } & SqliteRow>(
      `SELECT COUNT(*) AS total FROM cloud_conflicts WHERE status = 'pending'${workspaceClause}`,
      workspaceId === undefined ? [] : [workspaceId],
    )?.total ?? 0
  }

  public listConflicts(resolved: boolean, sinceDays = 30): readonly CloudConflict[] {
    const rows = resolved
      ? this.store.query<CloudConflictDbRow>(
          "SELECT * FROM cloud_conflicts WHERE status = 'resolved' AND datetime(resolvedAt) >= datetime(?) ORDER BY datetime(resolvedAt) DESC",
          [new Date(Date.now() - sinceDays * 86_400_000).toISOString()],
        )
      : this.store.query<CloudConflictDbRow>(
          "SELECT * FROM cloud_conflicts WHERE status = 'pending' ORDER BY datetime(createdAt) DESC",
        )
    return rows.map(rowToCloudConflict)
  }

  public getConflict(conflictId: string): CloudConflict | undefined {
    const row = this.store.get<CloudConflictDbRow>("SELECT * FROM cloud_conflicts WHERE conflict_id = ?", [conflictId])
    return row === undefined ? undefined : rowToCloudConflict(row)
  }

  public resolveConflict(conflictId: string, winner: CloudConflictWinner): void {
    this.store.transaction((store) => {
      new CloudSyncRepository(store).resolveConflictInTransaction(conflictId, winner)
    })
  }

  private resolveConflictInTransaction(conflictId: string, winner: CloudConflictWinner): void {
    const conflict = this.getConflict(conflictId)
    if (conflict === undefined || conflict.status !== "pending") {
      return
    }
    const queued = this.listOutboxForRecord(conflict.workspaceId, conflict.kind, conflict.recordId)
    const latestLocal = queued.at(-1)
    const localPayload = latestLocal?.payload ?? conflict.localPayload
    const localOp = latestLocal?.op ?? conflict.localOp

    this.store.delete(
      "DELETE FROM cloud_outbox WHERE workspace_id = ? AND kind = ? AND record_id = ?",
      [conflict.workspaceId, conflict.kind, conflict.recordId],
    )

    if (winner === "local") {
      if (localOp === "tombstone" || this.getLocalRecordRevision(conflict.kind, conflict.recordId) === undefined) {
        this.applyRecord({
          cursor: 0n,
          workspaceId: conflict.workspaceId,
          kind: cloudKindToRecordKind(conflict.kind),
          recordId: conflict.recordId,
          rev: BigInt(conflict.cloudRev + 1),
          op: outboxOpToChangeOp(localOp),
          payload: localPayload ?? new Uint8Array(),
        }, true)
      }
      this.enqueueOutbox({
        workspace_id: conflict.workspaceId,
        kind: conflict.kind,
        record_id: conflict.recordId,
        expected_rev: conflict.cloudRev,
        op: localOp,
        payload: localPayload,
      })
      this.upsertRecordState(conflict.workspaceId, conflict.kind, conflict.recordId, {
        serverRev: conflict.cloudRev,
        localRev: conflict.cloudRev + 1,
        dirty: true,
        conflictId: null,
      })
    } else {
      this.applyRecord({
        cursor: 0n,
        workspaceId: conflict.workspaceId,
        kind: cloudKindToRecordKind(conflict.kind),
        recordId: conflict.recordId,
        rev: BigInt(conflict.cloudRev),
        op: outboxOpToChangeOp(conflict.cloudOp),
        payload: conflict.cloudPayload ?? new Uint8Array(),
      }, true)
      this.upsertRecordState(conflict.workspaceId, conflict.kind, conflict.recordId, {
        serverRev: conflict.cloudRev,
        localRev: conflict.cloudRev,
        dirty: false,
        conflictId: null,
      })
    }

    this.store.set(
      "UPDATE cloud_conflicts SET winner = ?, status = 'resolved', resolvedAt = ? WHERE conflict_id = ? AND status = 'pending'",
      [winner, new Date().toISOString(), conflictId],
    )
  }

  // Pending conflicts that originated from a push (they carry a server snapshot
  // id). These are the only ones the desktop can reconcile against the server —
  // pull-detected conflicts have no server_conflict_id and no snapshot to query.
  public listPendingServerConflicts(): readonly CloudConflict[] {
    return this.store
      .query<CloudConflictDbRow>(
        "SELECT * FROM cloud_conflicts WHERE status = 'pending' AND server_conflict_id IS NOT NULL ORDER BY datetime(createdAt) ASC",
      )
      .map(rowToCloudConflict)
  }

  // Clears a local conflict once its server snapshot has been resolved on another
  // surface (web or another device). The desktop's SyncService has no "is this
  // resolved?" RPC, so it reuses FetchLoser as the probe. The server's contract
  // (apiweave-cloud apps/api/internal/sync/store.go FetchLoser, and
  // proto/apiweave/v1/sync_service.proto) is:
  //   - success  => the conflict HAS been resolved; the response carries the
  //     resolved-conflict loser_payload (winner != "unresolved", resolved_at set).
  //   - error code INVALID_ARGUMENT ("conflict not resolved") => still PENDING.
  //   - error code NOT_FOUND => unknown/expired snapshot (treat as still pending).
  // On success we infer the winner by matching the loser payload against our
  // stored sides, then converge to the server's outcome. A winner=local
  // resolution is applied by the server at cloud_rev + 1 (its ResolveConflict
  // takes a row lock asserting curRev == snapshot cloud_rev, then writes
  // resultingRev = curRev + 1); winner=cloud leaves the record at cloud_rev.
  // Returns what happened, or "missing"/"ambiguous" when no action was taken.
  public reconcileRemoteResolvedConflict(
    conflictId: string,
    loserPayload: Uint8Array,
  ): "local" | "cloud" | "ambiguous" | "missing" {
    return this.store.transaction((store) =>
      new CloudSyncRepository(store).reconcileRemoteResolvedInTransaction(conflictId, loserPayload),
    )
  }

  private reconcileRemoteResolvedInTransaction(
    conflictId: string,
    loserPayload: Uint8Array,
  ): "local" | "cloud" | "ambiguous" | "missing" {
    const conflict = this.getConflict(conflictId)
    if (conflict === undefined || conflict.status !== "pending") {
      return "missing"
    }
    const winner = this.inferRemoteWinner(conflict, loserPayload)
    if (winner === undefined) {
      return "ambiguous"
    }
    if (winner === "cloud") {
      // Cloud won: apply the cloud copy and discard local, exactly as a local
      // keep-cloud would. The server's rev did not advance, so nothing pulled
      // this cycle fights the applied state.
      this.resolveConflictInTransaction(conflictId, "cloud")
      return "cloud"
    }
    this.convergeRemoteKeepLocal(conflict)
    return "local"
  }

  // Determines which side the server kept by matching the loser payload it
  // returned against our stored sides (canonicalized to neutralize per-surface
  // id remaps and volatile fields). If the loser is the cloud copy, local won;
  // if the loser is the local copy, cloud won. Checks local first so a
  // no-difference conflict resolves as cloud (the no-rev-bump outcome).
  private inferRemoteWinner(
    conflict: CloudConflict,
    loserPayload: Uint8Array,
  ): "local" | "cloud" | undefined {
    const loser = canonicalConflictKey(conflict.kind, loserPayload)
    if (loser === canonicalConflictKey(conflict.kind, conflict.localPayload)) {
      return "cloud"
    }
    if (loser === canonicalConflictKey(conflict.kind, conflict.cloudPayload)) {
      return "local"
    }
    return undefined
  }

  // Local won on another surface: the server already applied our local copy as
  // cloud_rev + 1. Drop the blocked outbox, clear the conflict, and advance the
  // record's server_rev so the matching pulled change is ignored. Any newer
  // local edit queued behind the conflict is re-pushed on top of the new rev.
  private convergeRemoteKeepLocal(conflict: CloudConflict): void {
    const resultingRev = conflict.cloudRev + 1
    const queued = this.listOutboxForRecord(conflict.workspaceId, conflict.kind, conflict.recordId)
    const latestLocal = queued.at(-1)
    this.store.delete(
      "DELETE FROM cloud_outbox WHERE workspace_id = ? AND kind = ? AND record_id = ?",
      [conflict.workspaceId, conflict.kind, conflict.recordId],
    )
    const hasNewerEdit = latestLocal !== undefined
      && !payloadsEquivalent(conflict.kind, latestLocal.payload, conflict.localPayload ?? new Uint8Array())
    if (hasNewerEdit) {
      this.enqueueOutbox({
        workspace_id: conflict.workspaceId,
        kind: conflict.kind,
        record_id: conflict.recordId,
        expected_rev: resultingRev,
        op: latestLocal.op,
        payload: latestLocal.payload,
      })
    }
    this.upsertRecordState(conflict.workspaceId, conflict.kind, conflict.recordId, {
      serverRev: resultingRev,
      localRev: hasNewerEdit ? resultingRev + 1 : resultingRev,
      dirty: hasNewerEdit,
      conflictId: null,
    })
    this.store.set(
      "UPDATE cloud_conflicts SET winner = 'local', status = 'resolved', resolvedAt = ? WHERE conflict_id = ? AND status = 'pending'",
      [new Date().toISOString(), conflict.conflictId],
    )
  }

  // Converges after a server-side auto-merge (winner = MERGED). The server
  // combined both sides and applied the merged payload as resultingRev; we apply
  // that same payload locally, drop the blocked outbox, and clear the conflict.
  // Any newer local edit queued behind the conflict is re-pushed on top of the
  // merged rev so it is not lost.
  public resolveConflictMerged(conflictId: string, resultingRev: number, mergedPayload: Uint8Array): void {
    this.store.transaction((store) => {
      new CloudSyncRepository(store).resolveConflictMergedInTransaction(conflictId, resultingRev, mergedPayload)
    })
  }

  private resolveConflictMergedInTransaction(conflictId: string, resultingRev: number, mergedPayload: Uint8Array): void {
    const conflict = this.getConflict(conflictId)
    if (conflict === undefined || conflict.status !== "pending") {
      return
    }
    const queued = this.listOutboxForRecord(conflict.workspaceId, conflict.kind, conflict.recordId)
    const latestLocal = queued.at(-1)
    this.store.delete(
      "DELETE FROM cloud_outbox WHERE workspace_id = ? AND kind = ? AND record_id = ?",
      [conflict.workspaceId, conflict.kind, conflict.recordId],
    )
    this.applyRecord({
      cursor: 0n,
      workspaceId: conflict.workspaceId,
      kind: cloudKindToRecordKind(conflict.kind),
      recordId: conflict.recordId,
      rev: BigInt(resultingRev),
      op: outboxOpToChangeOp("upsert"),
      payload: mergedPayload,
    }, true)
    const hasNewerEdit = latestLocal !== undefined
      && !payloadsEquivalent(conflict.kind, latestLocal.payload, mergedPayload)
    if (hasNewerEdit) {
      this.enqueueOutbox({
        workspace_id: conflict.workspaceId,
        kind: conflict.kind,
        record_id: conflict.recordId,
        expected_rev: resultingRev,
        op: latestLocal.op,
        payload: latestLocal.payload,
      })
    }
    this.upsertRecordState(conflict.workspaceId, conflict.kind, conflict.recordId, {
      serverRev: resultingRev,
      localRev: hasNewerEdit ? resultingRev + 1 : resultingRev,
      dirty: hasNewerEdit,
      conflictId: null,
    })
    // Recorded as 'local' (the merge preserved the local edits); the desktop
    // shows no per-winner label and the authoritative 'merged' outcome lives in
    // the server's conflict_snapshots. This keeps the winner CHECK and the
    // migration additive rather than rebuilding the table for a cosmetic value.
    this.store.set(
      "UPDATE cloud_conflicts SET winner = 'local', status = 'resolved', resolvedAt = ? WHERE conflict_id = ? AND status = 'pending'",
      [new Date().toISOString(), conflictId],
    )
  }

  public recordPushConflict(input: CloudPushConflictInput): void {
    const localPayload = sanitizeNullablePayload(input.outboxRow.payload)
    const cloudPayload = sanitizeCloudSnapshotPayload(input.cloudPayload)
    const cloudRev = input.cloudRev > 0 ? input.cloudRev : input.outboxRow.expected_rev + 1
    this.saveConflict({
      conflictId: input.conflictId,
      serverConflictId: input.conflictId,
      workspaceId: input.outboxRow.workspace_id,
      kind: input.outboxRow.kind,
      recordId: input.outboxRow.record_id,
      baseRev: input.outboxRow.expected_rev,
      localPayload,
      cloudPayload,
      localRev: input.outboxRow.expected_rev + 1,
      cloudRev,
      localOp: input.outboxRow.op,
      cloudOp: cloudPayload.length === 0 ? "tombstone" : "upsert",
      cloudWriter: input.cloudWriter ?? null,
      autoMergeable: input.autoMergeable ?? false,
      mergeResidualPaths: input.mergeResidualPaths ?? [],
    })
  }

  public upsertDevice(input: CloudDeviceUpsert): void {
    this.store.set(
      `INSERT INTO cloud_devices (
        device_id, label, client_version, public_key, createdAt
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        label = excluded.label,
        client_version = excluded.client_version,
        public_key = excluded.public_key,
        access_token = NULL,
        encrypted_refresh_token = NULL,
        wrapped_dek = NULL,
        updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        revokedAt = NULL`,
      [
        input.deviceId,
        input.label,
        input.clientVersion,
        Buffer.from(input.publicKey),
        input.createdAt,
      ],
    )
  }

  public getDevice(deviceId: string): CloudDevice | undefined {
    const row = this.store.get<CloudDeviceDbRow>(
      "SELECT device_id, label, client_version, createdAt FROM cloud_devices WHERE device_id = ?",
      [deviceId],
    )
    return row === undefined ? undefined : {
      deviceId: row.device_id,
      label: row.label,
      clientVersion: row.client_version,
      createdAt: row.createdAt,
    }
  }

  public upsertWorkspaceBinding(input: CloudWorkspaceBindingUpsert): void {
    this.store.set(
      `INSERT INTO cloud_workspace_bindings (
        workspace_id, cloud_workspace_id, cloud_workspace_name, team_id, team_name,
        sync_mode, local_origin, device_id, initialization_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        cloud_workspace_id = excluded.cloud_workspace_id,
        cloud_workspace_name = excluded.cloud_workspace_name,
        team_id = excluded.team_id,
        team_name = excluded.team_name,
        sync_mode = excluded.sync_mode,
        device_id = excluded.device_id`,
      [
        input.workspaceId,
        input.cloudWorkspaceId,
        input.cloudWorkspaceName,
        input.teamId ?? null,
        input.teamName ?? null,
        input.syncMode,
        input.localOrigin ?? "local",
        input.deviceId ?? null,
        input.initializationState,
      ],
    )
  }

  public getWorkspaceBinding(workspaceId: string): CloudWorkspaceBinding | undefined {
    const row = this.store.get<CloudWorkspaceBindingDbRow>(
      `${WORKSPACE_BINDING_SELECT} WHERE workspace_id = ?`,
      [workspaceId],
    )
    return row === undefined ? undefined : rowToWorkspaceBinding(row)
  }

  public getWorkspaceBindingByCloudId(cloudWorkspaceId: string): CloudWorkspaceBinding | undefined {
    const row = this.store.get<CloudWorkspaceBindingDbRow>(
      `${WORKSPACE_BINDING_SELECT} WHERE cloud_workspace_id = ?`,
      [cloudWorkspaceId],
    )
    return row === undefined ? undefined : rowToWorkspaceBinding(row)
  }

  public setBindingInitializationState(
    workspaceId: string,
    state: CloudBindingInitializationState,
    lastError: string | null = null,
  ): void {
    const initializedAt = state === "initialized" ? new Date().toISOString() : null
    this.store.set(
      `UPDATE cloud_workspace_bindings
       SET initialization_state = ?, initializedAt = COALESCE(?, initializedAt), last_error = ?
       WHERE workspace_id = ?`,
      [state, initializedAt, lastError, workspaceId],
    )
  }

  public markBindingSynced(workspaceId: string): void {
    this.store.set(
      `UPDATE cloud_workspace_bindings
       SET lastSyncedAt = ?,
           last_error = CASE WHEN EXISTS (
             SELECT 1 FROM cloud_outbox o
             WHERE o.workspace_id = cloud_workspace_bindings.workspace_id AND o.retry_count >= ?
           ) THEN last_error ELSE NULL END
       WHERE workspace_id = ?`,
      [new Date().toISOString(), CLOUD_OUTBOX_MAX_RETRIES, workspaceId],
    )
  }

  public setBindingError(workspaceId: string, error: string): void {
    this.store.set(
      "UPDATE cloud_workspace_bindings SET last_error = ? WHERE workspace_id = ?",
      [error.slice(0, 1000), workspaceId],
    )
  }

  public listBoundCloudWorkspaceIds(): readonly string[] {
    return this.listWorkspaceBindings().map((binding) => binding.cloudWorkspaceId)
  }

  public listWorkspaceBindings(): readonly CloudWorkspaceBinding[] {
    return this.store
      .query<CloudWorkspaceBindingDbRow>(
        `${WORKSPACE_BINDING_SELECT} ORDER BY boundAt ASC`,
      )
      .map(rowToWorkspaceBinding)
  }

  /**
   * Record which cloud account a workspace is bound to. Outlives Disconnect
   * (unlike the binding itself) so a different account can never re-pair or
   * push a previous account's workspace. Re-stamping is idempotent.
   */
  public stampWorkspaceAccount(workspaceId: string, accountId: string): void {
    this.store.set(
      `INSERT INTO cloud_workspace_accounts (workspace_id, account_id) VALUES (?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         account_id = excluded.account_id,
         stampedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      [workspaceId, accountId],
    )
  }

  /** The account that owns a workspace, or undefined when it has never synced. */
  public getWorkspaceAccountId(workspaceId: string): string | undefined {
    return this.store.get<{ account_id: string } & SqliteRow>(
      "SELECT account_id FROM cloud_workspace_accounts WHERE workspace_id = ?",
      [workspaceId],
    )?.account_id
  }

  /** Owner stamps for every workspace that has one, keyed by local workspace id. */
  public listWorkspaceAccounts(): ReadonlyMap<string, string> {
    const rows = this.store.query<{ workspace_id: string; account_id: string } & SqliteRow>(
      "SELECT workspace_id, account_id FROM cloud_workspace_accounts",
    )
    return new Map(rows.map((row) => [row.workspace_id, row.account_id]))
  }

  /**
   * Delete every workspace stamped with this account, whatever its origin.
   * Only for an explicit, user-confirmed "remove this account's local data"
   * disconnect — the default disconnect keeps locally-authored workspaces.
   * Workflows, runs, secrets and stamps cascade with the workspace row.
   */
  public purgeAccountWorkspaces(accountId: string): number {
    return this.store.delete(
      `DELETE FROM workspaces WHERE id IN (
         SELECT workspace_id FROM cloud_workspace_accounts WHERE account_id = ?
       )`,
      [accountId],
    ).changes
  }

  public getWorkspaceName(workspaceId: string): string | undefined {
    return this.getRecordName("workspace", workspaceId)
  }

  // Resolves a record's display name by kind+id from its local table. Best-effort:
  // returns undefined if the record no longer exists locally (caller falls back to the id).
  public getRecordName(kind: string, recordId: string): string | undefined {
    const table = RECORD_KIND_TABLES[kind]
    if (table === undefined) return undefined
    return this.store.get<{ name: string } & SqliteRow>(
      `SELECT name FROM ${table} WHERE id = ?`,
      [recordId],
    )?.name
  }

  public removeWorkspaceBinding(workspaceId: string): void {
    this.transaction((repository) => {
      const binding = repository.getWorkspaceBinding(workspaceId)
      if (binding === undefined) {
        return
      }
      repository.store.set(
        "UPDATE workspaces SET origin = 'local', syncMode = 'none', updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        [workspaceId],
      )
      repository.store.delete("DELETE FROM cloud_outbox WHERE workspace_id = ?", [workspaceId])
      repository.store.delete("DELETE FROM cloud_record_state WHERE workspace_id = ?", [workspaceId])
      repository.store.delete("DELETE FROM cloud_conflicts WHERE workspace_id = ?", [workspaceId])
      repository.store.delete("DELETE FROM cloud_workspace_bindings WHERE workspace_id = ?", [workspaceId])
      repository.resetCursor(binding.cloudWorkspaceId)
    })
  }

  public clearCloudDeviceState(): void {
    this.store.transaction((store) => {
      store.set(
        `UPDATE workspaces SET origin = 'local', syncMode = 'none', updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id IN (
           SELECT workspace_id FROM cloud_workspace_bindings WHERE local_origin = 'local'
         )`,
      )
      store.delete(
        `DELETE FROM workspaces WHERE id IN (
           SELECT workspace_id FROM cloud_workspace_bindings WHERE local_origin IN ('cloud', 'team')
         )`,
      )
      store.delete("DELETE FROM cloud_outbox")
      store.delete("DELETE FROM cloud_record_state")
      store.delete("DELETE FROM cloud_conflicts")
      if (tableExists(store, "conflict_snapshots")) {
        store.delete("DELETE FROM conflict_snapshots")
      }
      store.delete("DELETE FROM cloud_workspace_bindings")
      store.delete("DELETE FROM cloud_devices")
      store.delete(
        "DELETE FROM app_settings WHERE key LIKE ? OR key LIKE ? OR key LIKE ?",
        [`${KEY_CURSOR}%`, `${KEY_LAST_REV}%`, `${KEY_LAST_FULL_SYNC}%`],
      )
    })
  }

  public applyChange(change: CloudChangeEnvelope): CloudApplyResult {
    const kind = recordKindToCloudKind(change.kind)
    if (kind === undefined || (change.op !== ChangeOp.UPSERT && change.op !== ChangeOp.TOMBSTONE)) {
      if (kind === undefined) {
        throw new ErrUnknownCloudKind(change.kind)
      }
      return "ignored"
    }
    if (change.op === ChangeOp.UPSERT) {
      validatePayload(parsePayload(change.payload))
    }

    const state = this.getRecordState(change.workspaceId, kind, change.recordId)
    if (state !== undefined && Number(change.rev) <= state.server_rev) {
      return "ignored"
    }
    const pending = this.listOutboxForRecord(change.workspaceId, kind, change.recordId)
    const baseline = pending.find((row) => row.is_baseline)
    if (baseline !== undefined) {
      if (baseline.op === "upsert" && change.op === ChangeOp.UPSERT
          && payloadsEquivalent(kind, baseline.payload, change.payload)) {
        this.store.delete("DELETE FROM cloud_outbox WHERE id = ?", [baseline.id])
        const laterMutations = pending.filter((row) => row.id !== baseline.id)
        if (laterMutations.length > 0) {
          this.rebaseOutboxRows(laterMutations, Number(change.rev))
          const localRev = this.getLocalRecordRevision(kind, change.recordId) ?? Number(change.rev) + laterMutations.length
          this.upsertRecordState(change.workspaceId, kind, change.recordId, {
            serverRev: Number(change.rev),
            localRev,
            dirty: true,
            conflictId: null,
          })
          return "applied"
        }
        this.applyRecord(change, false)
        this.upsertRecordState(change.workspaceId, kind, change.recordId, {
          serverRev: Number(change.rev),
          localRev: Number(change.rev),
          dirty: false,
          conflictId: null,
        })
        return "applied"
      }
      this.recordPullConflict(change, kind, pending)
      return "conflict"
    }
    if (pending.some((row) => row.expected_rev < Number(change.rev))) {
      this.recordPullConflict(change, kind, pending)
      return "conflict"
    }

    this.applyRecord(change, false)
    const localRev = this.getLocalRecordRevision(kind, change.recordId)
    this.upsertRecordState(change.workspaceId, kind, change.recordId, {
      serverRev: Number(change.rev),
      localRev: pending.length === 0
        ? localRev ?? Number(change.rev)
        : Math.max(...pending.map((row) => row.expected_rev + 1)),
      dirty: pending.length > 0,
      conflictId: null,
    })
    return "applied"
  }

  private applyRecord(change: CloudChangeEnvelope, force: boolean): void {
    if (change.op === ChangeOp.TOMBSTONE) {
      this.applyTombstone(change, force)
      return
    }
    const payload = parsePayload(change.payload)
    switch (change.kind) {
      case RecordKind.WORKSPACE:
        this.upsertWorkspace(change.recordId, change.rev, payload, force)
        break
      case RecordKind.PROJECT:
        this.upsertCollection(change.workspaceId, change.recordId, change.rev, payload, force)
        break
      case RecordKind.WORKFLOW:
        this.upsertWorkflow(change.workspaceId, change.recordId, change.rev, payload, force)
        break
      case RecordKind.ENVIRONMENT:
        this.upsertEnvironment(change.workspaceId, change.recordId, change.rev, payload, force)
        break
      default:
        throw new ErrUnknownCloudKind(change.kind)
    }
  }

  private applyTombstone(change: CloudChangeEnvelope, force: boolean): void {
    const revisionGuard = force ? "" : " AND rev < ?"
    const params: (string | number)[] = force
      ? [change.recordId]
      : [change.recordId, Number(change.rev)]
    switch (change.kind) {
      case RecordKind.WORKSPACE:
        this.store.delete(`DELETE FROM workspaces WHERE id = ?${revisionGuard}`, params)
        break
      case RecordKind.PROJECT:
        this.store.delete(`DELETE FROM collections WHERE id = ?${revisionGuard}`, params)
        break
      case RecordKind.WORKFLOW:
        this.store.delete(`DELETE FROM workflows WHERE id = ?${revisionGuard}`, params)
        break
      case RecordKind.ENVIRONMENT:
        this.store.delete(`DELETE FROM environments WHERE id = ?${revisionGuard}`, params)
        break
      default:
        throw new ErrUnknownCloudKind(change.kind)
    }
  }

  private upsertWorkspace(id: string, rev: bigint, payload: Record<string, unknown>, force: boolean): void {
    const name = String(payload["name"] ?? "")
    const slug = this.uniqueWorkspaceSlug(String(payload["slug"] ?? slugify(name, id)), id)
    const origin = String(payload["origin"] ?? "cloud")
    const syncMode = String(payload["syncMode"] ?? "bi-directional")
    const settingsJson = JSON.stringify({
      description: payload["description"] ?? null,
      isPersonal: payload["isPersonal"] ?? false,
      deletedAt: null,
    })
    this.store.set(
      `INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, origin = excluded.origin,
       syncMode = excluded.syncMode, settings_json = excluded.settings_json, rev = excluded.rev, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ${force ? "" : "WHERE excluded.rev > workspaces.rev"}`,
      [id, name, slug, origin, syncMode, settingsJson, Number(rev)],
    )
  }

  private uniqueWorkspaceSlug(requestedSlug: string, workspaceId: string): string {
    const base = requestedSlug || slugify("workspace", workspaceId)
    let candidate = base
    let suffix = 2
    while (this.store.get<SqliteRow>(
      "SELECT 1 FROM workspaces WHERE slug = ? AND id <> ?",
      [candidate, workspaceId],
    ) !== undefined) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    return candidate
  }

  private upsertCollection(workspaceId: string, id: string, rev: bigint, payload: Record<string, unknown>, force: boolean): void {
    const name = String(payload["name"] ?? "")
    const workflowOrder = JSON.stringify(normalizeWorkflowOrder(payload["workflowOrderItems"] ?? payload["workflowOrder"]))
    const settingsJson = JSON.stringify({
      projectId: payload["projectId"] ?? null,
      description: payload["description"] ?? null,
      color: payload["color"] ?? null,
      workflowCount: payload["workflowCount"] ?? 0,
      continueOnFail: payload["continueOnFail"] ?? true,
    })
    this.store.set(
      `INSERT INTO collections (id, workspace_id, scopeId, name, slug, workflow_ids_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, scopeId = excluded.scopeId, name = excluded.name,
       slug = excluded.slug, workflow_ids_json = excluded.workflow_ids_json, settings_json = excluded.settings_json,
       rev = excluded.rev, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ${force ? "" : "WHERE excluded.rev > collections.rev"}`,
      [id, workspaceId, workspaceId, name, slugify(name, id), workflowOrder, settingsJson, Number(rev)],
    )
  }

  private upsertWorkflow(workspaceId: string, id: string, rev: bigint, payload: Record<string, unknown>, force: boolean): void {
    const name = String(payload["name"] ?? "")
    const legacyGraph = objectProperty(payload, "graph")
    const graphJson = JSON.stringify({
      nodes: payload["nodes"] ?? legacyGraph["nodes"] ?? [],
      edges: payload["edges"] ?? legacyGraph["edges"] ?? [],
    })
    const variablesJson = JSON.stringify(payload["variables"] ?? {})
    const settingsJson = JSON.stringify({
      description: payload["description"] ?? null,
      tags: payload["tags"] ?? [],
      collectionId: payload["collectionId"] ?? null,
      selectedEnvironmentId: payload["selectedEnvironmentId"] ?? null,
      nodeTemplates: payload["nodeTemplates"] ?? [],
    })
    this.store.set(
      `INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, scopeId = excluded.scopeId, name = excluded.name,
       slug = excluded.slug, graph_json = excluded.graph_json, variables_json = excluded.variables_json,
       settings_json = excluded.settings_json, rev = excluded.rev, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ${force ? "" : "WHERE excluded.rev > workflows.rev"}`,
      [id, workspaceId, workspaceId, name, slugify(name, id), graphJson, variablesJson, settingsJson, Number(rev)],
    )
  }

  private upsertEnvironment(workspaceId: string, id: string, rev: bigint, payload: Record<string, unknown>, force: boolean): void {
    const name = String(payload["name"] ?? "")
    const variablesJson = JSON.stringify(payload["variables"] ?? {})
    const existingSettings = this.store.get<{ settings_json: string } & SqliteRow>(
      "SELECT settings_json FROM environments WHERE id = ?",
      [id],
    )
    const existingSecrets = existingSettings === undefined
      ? {}
      : objectProperty(parsePayload(new TextEncoder().encode(existingSettings.settings_json)), "secrets")
    const cloudReferences = normalizeSecretReferences(
      objectProperty(payload, "secrets"),
      String(payload["scopeType"] ?? "workspace"),
      workspaceId,
    )
    const settingsJson = JSON.stringify({
      description: payload["description"] ?? null,
      swaggerDocUrl: payload["swaggerDocUrl"] ?? null,
      secrets: mergeCloudSecretReferences(cloudReferences, existingSecrets),
      isDefault: payload["isDefault"] ?? false,
    })
    this.store.set(
      `INSERT INTO environments (id, workspace_id, scopeId, name, slug, variables_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, scopeId = excluded.scopeId, name = excluded.name,
       slug = excluded.slug, variables_json = excluded.variables_json, settings_json = excluded.settings_json,
       rev = excluded.rev, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ${force ? "" : "WHERE excluded.rev > environments.rev"}`,
      [id, workspaceId, workspaceId, name, slugify(name, id), variablesJson, settingsJson, Number(rev)],
    )
  }

  private getRecordState(workspaceId: string, kind: CloudOutboxKind, recordId: string): CloudRecordStateRow | undefined {
    return this.store.get<CloudRecordStateRow>(
      "SELECT workspace_id, kind, record_id, server_rev, local_rev, dirty, conflict_id FROM cloud_record_state WHERE workspace_id = ? AND kind = ? AND record_id = ?",
      [workspaceId, kind, recordId],
    )
  }

  private upsertRecordState(
    workspaceId: string,
    kind: CloudOutboxKind,
    recordId: string,
    state: {
      readonly serverRev: number
      readonly localRev: number
      readonly dirty: boolean
      readonly conflictId: string | null
      readonly preserveServerRev?: boolean
      readonly preserveLocalRev?: boolean
    },
  ): void {
    this.store.set(
      `INSERT INTO cloud_record_state (workspace_id, kind, record_id, server_rev, local_rev, dirty, conflict_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, kind, record_id) DO UPDATE SET
         server_rev = ${state.preserveServerRev ? "cloud_record_state.server_rev" : "excluded.server_rev"},
         local_rev = ${state.preserveLocalRev ? "MAX(cloud_record_state.local_rev, excluded.local_rev)" : "excluded.local_rev"},
         dirty = excluded.dirty,
         conflict_id = excluded.conflict_id,
         updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      [workspaceId, kind, recordId, state.serverRev, state.localRev, state.dirty ? 1 : 0, state.conflictId],
    )
  }

  private listOutboxForRecord(workspaceId: string, kind: CloudOutboxKind, recordId: string): readonly CloudOutboxRow[] {
    return this.store.query<OutboxDbRow>(
      `SELECT id, kind, record_id, workspace_id, expected_rev, op, payload, retry_count,
              next_retry_at, failure_reason, created_at, is_baseline
       FROM cloud_outbox WHERE workspace_id = ? AND kind = ? AND record_id = ?
       ORDER BY created_at ASC, rowid ASC`,
      [workspaceId, kind, recordId],
    ).map(rowToOutboxRow)
  }

  private rebaseOutboxRows(rows: readonly CloudOutboxRow[], serverRev: number): void {
    rows.forEach((row, index) => {
      this.store.set(
        "UPDATE cloud_outbox SET expected_rev = ? WHERE id = ?",
        [serverRev + index, row.id],
      )
    })
  }

  private recordPullConflict(
    change: CloudChangeEnvelope,
    kind: CloudOutboxKind,
    pending: readonly CloudOutboxRow[],
  ): void {
    const latest = pending[pending.length - 1]
    if (latest === undefined) {
      return
    }
    const existing = this.getRecordState(change.workspaceId, kind, change.recordId)?.conflict_id
    const localPayload = sanitizeNullablePayload(latest.payload)
    const cloudPayload = change.op === ChangeOp.UPSERT ? sanitizeCloudSnapshotPayload(change.payload) : null
    const localRev = this.getLocalRecordRevision(kind, change.recordId)
      ?? Math.max(...pending.map((row) => row.expected_rev + 1))
    if (existing !== null && existing !== undefined) {
      this.store.set(
        `UPDATE cloud_conflicts SET cloud_payload = ?, cloud_rev = ?, cloud_op = ?
         WHERE conflict_id = ? AND status = 'pending' AND cloud_rev < ?`,
        [toBuffer(cloudPayload), Number(change.rev), changeOpToOutboxOp(change.op), existing, Number(change.rev)],
      )
      this.upsertRecordState(change.workspaceId, kind, change.recordId, {
        serverRev: Number(change.rev), localRev, dirty: true, conflictId: existing,
      })
      return
    }
    this.saveConflict({
      conflictId: generateId(),
      serverConflictId: null,
      workspaceId: change.workspaceId,
      kind,
      recordId: change.recordId,
      baseRev: Math.min(...pending.map((row) => row.expected_rev)),
      localPayload,
      cloudPayload,
      localRev,
      cloudRev: Number(change.rev),
      localOp: latest.op,
      cloudOp: changeOpToOutboxOp(change.op),
      // NB: pull-created conflicts carry no writer — PullChanges doesn't
      // attribute changes. Renders "unknown author"; add if we ever put a
      // writer on ChangeEnvelope.
      cloudWriter: null,
      // Pull-created conflicts have no server merge outcome, so auto-merge is
      // never offered for them (the server never computed a base for this side).
      autoMergeable: false,
      mergeResidualPaths: [],
    })
  }

  // fallow-ignore-next-line complexity -- conflict persistence has separate legacy and current metadata fields
  private saveConflict(input: Omit<CloudConflict, "winner" | "status" | "createdAt" | "resolvedAt">): void {
    const writer = input.cloudWriter
    this.store.set(
      `INSERT INTO cloud_conflicts (
         conflict_id, server_conflict_id, workspace_id, kind, record_id, base_rev,
         local_payload, cloud_payload, local_rev, cloud_rev, local_op, cloud_op,
         cloud_writer_user_id, cloud_writer_device_id, cloud_writer_name, cloud_writer_device_label,
         auto_mergeable, merge_residual_paths
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conflict_id) DO UPDATE SET
         server_conflict_id = excluded.server_conflict_id,
         local_payload = excluded.local_payload, cloud_payload = excluded.cloud_payload,
         local_rev = excluded.local_rev, cloud_rev = excluded.cloud_rev,
         local_op = excluded.local_op, cloud_op = excluded.cloud_op,
         cloud_writer_user_id = excluded.cloud_writer_user_id,
         cloud_writer_device_id = excluded.cloud_writer_device_id,
         cloud_writer_name = excluded.cloud_writer_name,
         cloud_writer_device_label = excluded.cloud_writer_device_label,
         auto_mergeable = excluded.auto_mergeable,
         merge_residual_paths = excluded.merge_residual_paths`,
      [
        input.conflictId, input.serverConflictId, input.workspaceId, input.kind, input.recordId, input.baseRev,
        toBuffer(input.localPayload), toBuffer(input.cloudPayload), input.localRev, input.cloudRev,
        input.localOp, input.cloudOp,
        writer?.userId || null, writer?.deviceId || null, writer?.name || null, writer?.deviceLabel || null,
        input.autoMergeable ? 1 : 0, JSON.stringify(input.mergeResidualPaths ?? []),
      ],
    )
    this.upsertRecordState(input.workspaceId, input.kind, input.recordId, {
      serverRev: input.cloudRev,
      localRev: input.localRev,
      dirty: true,
      conflictId: input.conflictId,
    })
  }

  private getLocalRecordRevision(kind: CloudOutboxKind, recordId: string): number | undefined {
    const table = tableForKind(kind)
    return this.store.get<{ rev: number } & SqliteRow>(`SELECT rev FROM ${table} WHERE id = ?`, [recordId])?.rev
  }

}

function parsePayload(data: Uint8Array): Record<string, unknown> {
  if (data.length === 0) {
    return {}
  }
  const parsed = JSON.parse(new TextDecoder().decode(data)) as unknown
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {}
  }
  return parsed as Record<string, unknown>
}

// A comparison key for a conflict side: the canonicalized payload as stable
// JSON, or a distinct marker for an absent/tombstone side. Canonicalization
// neutralizes per-surface id remaps and volatile fields so a local copy and its
// server-stored twin (which differ only in mapped workspace ids) compare equal.
function canonicalConflictKey(kind: CloudOutboxKind, payload: Uint8Array | null): string {
  if (payload === null || payload.length === 0) {
    return "tombstone"
  }
  return JSON.stringify(canonicalizeSyncPayload(kind, parsePayload(payload)))
}

function payloadsEquivalent(kind: CloudOutboxKind, localPayload: Uint8Array | null, cloudPayload: Uint8Array): boolean {
  if (localPayload === null) {
    return false
  }
  try {
    return JSON.stringify(normalizeComparablePayload(parsePayload(localPayload), kind))
      === JSON.stringify(normalizeComparablePayload(parsePayload(cloudPayload), kind))
  } catch {
    return false
  }
}

function normalizeComparablePayload(value: unknown, kind: CloudOutboxKind, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparablePayload(item, kind, depth + 1))
  }
  if (value === null || typeof value !== "object") {
    return value
  }
  const record = value as Record<string, unknown>
  const normalized: Record<string, unknown> = {}
  const ignored = depth === 0 ? identityAndRevisionFields(kind) : new Set<string>()
  for (const nestedKey of Object.keys(record).sort()) {
    if (!ignored.has(nestedKey)) {
      normalized[nestedKey] = normalizeComparablePayload(record[nestedKey], kind, depth + 1)
    }
  }
  if (depth === 0 && normalized["graph"] === undefined
      && (normalized["nodes"] !== undefined || normalized["edges"] !== undefined)) {
    normalized["graph"] = {
      nodes: normalized["nodes"] ?? [],
      edges: normalized["edges"] ?? [],
    }
    delete normalized["nodes"]
    delete normalized["edges"]
  }
  return normalized
}

function identityAndRevisionFields(kind: CloudOutboxKind): ReadonlySet<string> {
  const fields = new Set(["workspaceId", "rev", "createdAt", "updatedAt"])
  if (kind === "project") fields.add("collectionId")
  if (kind === "workflow") fields.add("workflowId")
  if (kind === "environment") fields.add("environmentId")
  return fields
}

function validatePayload(payload: Record<string, unknown>): void {
  const secrets = payload["secrets"]
  if (secrets !== undefined && !isSecretReferenceMap(secrets)) {
    throw new ErrForbiddenCloudPayload("secrets")
  }

  const runs = payload["runs"]
  if (Array.isArray(runs) && runs.length > 0) {
    throw new ErrForbiddenCloudPayload("runs")
  }
  const forbidden = forbiddenCloudPayloadField(payload)
  if (forbidden !== undefined) {
    throw new ErrForbiddenCloudPayload(forbidden)
  }
}

/**
 * The pull-side floor: the field path a cloud payload may not carry, or
 * `undefined` if the payload is storable. Exported so the push sanitizer can be
 * tested against the exact rule that guards the receiving device — see
 * `core/sync/__tests__/sync-redaction-contract.test.ts`.
 */
export function forbiddenCloudPayloadField(payload: Record<string, unknown>): string | undefined {
  return findForbiddenPayloadField(payload)
}

function isSecretReferenceMap(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return false
    }
    const reference = (entry as Record<string, unknown>)["reference"]
    return typeof reference === "string" && reference.length > 0 && Object.keys(entry).length === 1
  })
}

// The predicates below come from `services/secret_utils`, which the push
// sanitizer and the cloud server share: a rule only this side knows about
// strands the sending device's records here forever, because a throw mid-pull
// leaves the cursor unadvanced and the same change is re-fetched every sync.
function findForbiddenPayloadField(value: unknown, path = ""): string | undefined {
  if (Array.isArray(value)) {
    return forbiddenFieldInArray(value, path)
  }
  if (value === null || typeof value !== "object") {
    return typeof value === "string" && containsCredentialMaterial(value) ? path : undefined
  }
  return forbiddenFieldInRecord(value as Record<string, unknown>, path)
}

function forbiddenFieldInArray(items: readonly unknown[], path: string): string | undefined {
  for (const item of items) {
    const forbidden = findForbiddenPayloadField(item, path)
    if (forbidden !== undefined) return forbidden
  }
  return undefined
}

function forbiddenFieldInRecord(record: Record<string, unknown>, path: string): string | undefined {
  const itemKey = record["key"]
  const pairSensitive = typeof itemKey === "string" && isSyncSensitiveKey(itemKey)
  if (pairSensitive && isWithheldSyncValue(record["value"])) {
    return path.length === 0 ? itemKey as string : `${path}.${itemKey as string}`
  }
  for (const [key, nestedValue] of Object.entries(record)) {
    if (key === "secrets") continue
    const nestedPath = path.length === 0 ? key : `${path}.${key}`
    const forbidden = forbiddenPayloadEntry(key, nestedValue, path, nestedPath)
    if (forbidden !== undefined) return forbidden
  }
  return undefined
}

function forbiddenPayloadEntry(
  key: string,
  value: unknown,
  parentPath: string,
  path: string,
): string | undefined {
  if (isSyncSensitiveKey(key) && isWithheldSyncValue(value)) {
    return path
  }
  // Cookies routinely carry session material under innocuous names, so a cookie
  // entry's value is held to the same rule as a sensitive key name.
  if (key === "value" && parentPath.toLowerCase().includes("cookies") && isWithheldSyncValue(value)) {
    return path
  }
  // A JSON body string is config, not a credential: scan inside it so a
  // serialized secret leaf is caught the same way the push-side redactor
  // would have withheld it.
  if (key === "body" && typeof value === "string") {
    const inBody = forbiddenFieldInJsonBody(value, path)
    if (inBody !== undefined) return inBody
  }
  return findForbiddenPayloadField(value, path)
}

function forbiddenFieldInJsonBody(body: string, path: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  return findForbiddenPayloadField(parsed, path)
}

function objectProperty(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const property = value[key]
  return property !== null && typeof property === "object" && !Array.isArray(property)
    ? property as Record<string, unknown>
    : {}
}

function normalizeWorkflowOrder(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item, index) => {
    if (typeof item === "string" && item.length > 0) {
      return [{ workflowId: item, order: index, enabled: true, continueOnFail: true }]
    }
    if (item !== null && typeof item === "object" && !Array.isArray(item)
        && typeof (item as Record<string, unknown>)["workflowId"] === "string") {
      return [item as Record<string, unknown>]
    }
    return []
  })
}

function normalizeSecretReferences(
  references: Record<string, unknown>,
  scopeType: string,
  localWorkspaceId: string,
): Record<string, unknown> {
  if (scopeType !== "workspace") {
    return references
  }
  return Object.fromEntries(Object.entries(references).map(([name, value]) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return [name, value]
    }
    const reference = (value as Record<string, unknown>)["reference"]
    if (typeof reference !== "string") {
      return [name, value]
    }
    const parts = reference.split(":")
    return [name, {
      ...value as Record<string, unknown>,
      reference: parts.length >= 3 ? `workspace:${localWorkspaceId}:${parts.slice(2).join(":")}` : reference,
    }]
  }))
}

function mergeCloudSecretReferences(
  cloudReferences: Record<string, unknown>,
  existingSecrets: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(cloudReferences).map(([name, cloudReference]) => {
    const existing = existingSecrets[name]
    if (existing === undefined || isSecretReference(existing)) {
      return [name, cloudReference]
    }
    if (existing !== null && typeof existing === "object" && !Array.isArray(existing)
        && cloudReference !== null && typeof cloudReference === "object" && !Array.isArray(cloudReference)) {
      return [name, { ...existing as Record<string, unknown>, ...cloudReference as Record<string, unknown> }]
    }
    return [name, existing]
  }))
}

function isSecretReference(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof (value as Record<string, unknown>)["reference"] === "string"
    && Object.keys(value).length === 1
}

function rowToOutboxRow(row: OutboxDbRow): CloudOutboxRow {
  return {
    id: row.id,
    kind: row.kind as CloudOutboxKind,
    record_id: row.record_id,
    workspace_id: row.workspace_id,
    expected_rev: row.expected_rev,
    op: row.op as CloudOutboxOp,
    payload: row.payload === null ? null : new Uint8Array(row.payload),
    retry_count: row.retry_count,
    next_retry_at: row.next_retry_at,
    failure_reason: row.failure_reason,
    created_at: row.created_at,
    is_baseline: row.is_baseline === 1,
  }
}

function rowToWorkspaceBinding(row: CloudWorkspaceBindingDbRow): CloudWorkspaceBinding {
  return {
    workspaceId: row.workspace_id,
    cloudWorkspaceId: row.cloud_workspace_id,
    cloudWorkspaceName: row.cloud_workspace_name,
    teamId: row.team_id,
    teamName: row.team_name,
    syncMode: row.sync_mode,
    localOrigin: row.local_origin as WorkspaceOrigin,
    deviceId: row.device_id,
    initializationState: row.initialization_state,
    boundAt: row.boundAt,
    lastSyncedAt: row.lastSyncedAt,
    initializedAt: row.initializedAt,
    lastError: row.last_error,
  }
}

function rowToCloudConflict(row: CloudConflictDbRow): CloudConflict {
  return {
    conflictId: row.conflict_id,
    serverConflictId: row.server_conflict_id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    recordId: row.record_id,
    baseRev: row.base_rev,
    localPayload: row.local_payload === null ? null : new Uint8Array(row.local_payload),
    cloudPayload: row.cloud_payload === null ? null : new Uint8Array(row.cloud_payload),
    localRev: row.local_rev,
    cloudRev: row.cloud_rev,
    localOp: row.local_op,
    cloudOp: row.cloud_op,
    winner: row.winner,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    cloudWriter: cloudWriterFromRow(row),
    autoMergeable: row.auto_mergeable === 1,
    mergeResidualPaths: parseResidualPaths(row.merge_residual_paths),
  }
}

// Parses the JSON string-array column, tolerating legacy NULL/empty/malformed
// values by yielding an empty list (never offer picking on garbage).
function parseResidualPaths(value: string | null): readonly string[] {
  if (value === null || value === "") return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : []
  } catch {
    return []
  }
}

// Reassembles the cloud writer from its columns, returning null when the
// server carried no attribution (all columns NULL — legacy or pull conflict).
function cloudWriterFromRow(row: CloudConflictDbRow): CloudConflictWriter | null {
  if (
    row.cloud_writer_user_id === null &&
    row.cloud_writer_device_id === null &&
    row.cloud_writer_name === null &&
    row.cloud_writer_device_label === null
  ) {
    return null
  }
  return {
    userId: row.cloud_writer_user_id ?? "",
    deviceId: row.cloud_writer_device_id ?? "",
    name: row.cloud_writer_name ?? "",
    deviceLabel: row.cloud_writer_device_label ?? "",
  }
}

function recordKindToCloudKind(kind: RecordKind): CloudOutboxKind | undefined {
  switch (kind) {
    case RecordKind.WORKSPACE: return "workspace"
    case RecordKind.PROJECT: return "project"
    case RecordKind.WORKFLOW: return "workflow"
    case RecordKind.ENVIRONMENT: return "environment"
    default: return undefined
  }
}

function cloudKindToRecordKind(kind: CloudOutboxKind): RecordKind {
  switch (kind) {
    case "workspace": return RecordKind.WORKSPACE
    case "project": return RecordKind.PROJECT
    case "workflow": return RecordKind.WORKFLOW
    case "environment": return RecordKind.ENVIRONMENT
  }
}

function changeOpToOutboxOp(op: ChangeOp): CloudOutboxOp {
  switch (op) {
    case ChangeOp.UPSERT: return "upsert"
    case ChangeOp.TOMBSTONE: return "tombstone"
    default: throw new Error(`unsupported cloud change op: ${op}`)
  }
}

function outboxOpToChangeOp(op: CloudOutboxOp): ChangeOp {
  return op === "upsert" ? ChangeOp.UPSERT : ChangeOp.TOMBSTONE
}

function sanitizeNullablePayload(payload: Uint8Array | null): Uint8Array | null {
  return payload === null ? null : sanitizeCloudSnapshotPayload(payload)
}

function toBuffer(payload: Uint8Array | null): Buffer | null {
  return payload === null ? null : Buffer.from(payload)
}

function tableForKind(kind: CloudOutboxKind): string {
  switch (kind) {
    case "workspace": return "workspaces"
    case "project": return "collections"
    case "workflow": return "workflows"
    case "environment": return "environments"
  }
}

function tableExists(store: KVStore, tableName: string): boolean {
  return store.get<SqliteRow>("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]) !== undefined
}
