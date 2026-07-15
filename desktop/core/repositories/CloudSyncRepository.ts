import type { KVStore, SqliteRow } from "../db"
import { generateId } from "../id"
import { slugify } from "./helpers"
import { sanitizeCloudSnapshotPayload } from "../sync/cloud-mutations"
import { ChangeOp, RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"

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
}

export interface CloudDeviceUpsert {
  readonly deviceId: string
  readonly label: string
  readonly clientVersion: string
  readonly publicKey: Uint8Array
  readonly createdAt: string
}

export interface CloudWorkspaceBindingUpsert {
  readonly workspaceId: string
  readonly cloudWorkspaceId: string
  readonly teamId?: string | null
  readonly syncMode: string
  readonly deviceId?: string
}

export interface CloudWorkspaceBinding {
  readonly workspaceId: string
  readonly cloudWorkspaceId: string
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
export type CloudConflictWinner = "local" | "cloud"

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
}

export interface CloudPushConflictInput {
  readonly conflictId: string
  readonly outboxRow: CloudOutboxRow
  readonly cloudPayload: Uint8Array
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
}

const KEY_CURSOR = "cloud.cursor."
const KEY_LAST_REV = "cloud.last_rev."
const KEY_LAST_FULL_SYNC = "cloud.last_full_sync."

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

  public enqueueOutbox(row: Omit<CloudOutboxRow, "id" | "created_at" | "retry_count" | "next_retry_at" | "failure_reason">): string {
    const id = generateId()
    const payloadBuffer = row.payload === null ? null : Buffer.from(row.payload)
    const existingConflictId = this.getRecordState(row.workspace_id, row.kind, row.record_id)?.conflict_id ?? null
    this.store.set(
      "INSERT INTO cloud_outbox (id, kind, record_id, workspace_id, expected_rev, op, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, row.kind, row.record_id, row.workspace_id, row.expected_rev, row.op, payloadBuffer, Date.now()],
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

  public listPendingOutbox(limit: number, nowMs = Date.now()): readonly CloudOutboxRow[] {
    return this.store
      .query<OutboxDbRow>(
        `SELECT o.id, o.kind, o.record_id, o.workspace_id, o.expected_rev, o.op, o.payload,
                o.retry_count, o.next_retry_at, o.failure_reason, o.created_at
         FROM cloud_outbox o
         WHERE o.retry_count < ? AND o.next_retry_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM cloud_record_state s
             WHERE s.workspace_id = o.workspace_id AND s.kind = o.kind
               AND s.record_id = o.record_id AND s.conflict_id IS NOT NULL
           )
         ORDER BY o.created_at ASC LIMIT ?`,
        [CLOUD_OUTBOX_MAX_RETRIES, nowMs, limit],
      )
      .map(rowToOutboxRow)
  }

  public markOutboxApplied(id: string, serverRev: number): void {
    const applied = this.store.get<OutboxDbRow>(
      "SELECT id, kind, record_id, workspace_id, expected_rev, op, payload, retry_count, next_retry_at, failure_reason, created_at FROM cloud_outbox WHERE id = ?",
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

  public clearOutbox(): void {
    this.store.delete("DELETE FROM cloud_outbox")
  }

  public countOutbox(): number {
    return this.store.get<{ total: number } & SqliteRow>("SELECT COUNT(*) as total FROM cloud_outbox")?.total ?? 0
  }

  public countDeadLetterOutbox(): number {
    return this.store.get<{ total: number } & SqliteRow>(
      "SELECT COUNT(*) as total FROM cloud_outbox WHERE retry_count >= ?",
      [CLOUD_OUTBOX_MAX_RETRIES],
    )?.total ?? 0
  }

  public countPendingConflicts(): number {
    return this.store.get<{ total: number } & SqliteRow>(
      "SELECT COUNT(*) AS total FROM cloud_conflicts WHERE status = 'pending'",
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

    this.store.delete(
      "DELETE FROM cloud_outbox WHERE workspace_id = ? AND kind = ? AND record_id = ?",
      [conflict.workspaceId, conflict.kind, conflict.recordId],
    )

    if (winner === "local") {
      this.applyRecord({
        cursor: 0n,
        workspaceId: conflict.workspaceId,
        kind: cloudKindToRecordKind(conflict.kind),
        recordId: conflict.recordId,
        rev: BigInt(conflict.cloudRev + 1),
        op: outboxOpToChangeOp(conflict.localOp),
        payload: conflict.localPayload ?? new Uint8Array(),
      }, true)
      this.enqueueOutbox({
        workspace_id: conflict.workspaceId,
        kind: conflict.kind,
        record_id: conflict.recordId,
        expected_rev: conflict.cloudRev,
        op: conflict.localOp,
        payload: conflict.localPayload,
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

  public recordPushConflict(input: CloudPushConflictInput): void {
    const localPayload = sanitizeNullablePayload(input.outboxRow.payload)
    const cloudPayload = sanitizeNullablePayload(input.cloudPayload)
    const cloudRev = payloadRevision(cloudPayload) ?? input.outboxRow.expected_rev + 1
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
      cloudOp: "upsert",
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

  public upsertWorkspaceBinding(input: CloudWorkspaceBindingUpsert): void {
    this.store.set(
      `INSERT INTO cloud_workspace_bindings (
        workspace_id, cloud_workspace_id, team_id, sync_mode, device_id
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        cloud_workspace_id = excluded.cloud_workspace_id,
        team_id = excluded.team_id,
        sync_mode = excluded.sync_mode,
        device_id = excluded.device_id`,
      [input.workspaceId, input.cloudWorkspaceId, input.teamId ?? null, input.syncMode, input.deviceId ?? null],
    )
  }

  public listBoundCloudWorkspaceIds(): readonly string[] {
    return this.listWorkspaceBindings().map((binding) => binding.cloudWorkspaceId)
  }

  public listWorkspaceBindings(): readonly CloudWorkspaceBinding[] {
    return this.store
      .query<{ workspace_id: string; cloud_workspace_id: string } & SqliteRow>(
        "SELECT workspace_id, cloud_workspace_id FROM cloud_workspace_bindings ORDER BY boundAt ASC",
      )
      .map((row) => ({ workspaceId: row.workspace_id, cloudWorkspaceId: row.cloud_workspace_id }))
  }

  public clearCloudDeviceState(): void {
    this.store.transaction((store) => {
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
    const slug = String(payload["slug"] ?? slugify(name, id))
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
       syncMode = excluded.syncMode, settings_json = excluded.settings_json, rev = excluded.rev, updatedAt = datetime('now')
       ${force ? "" : "WHERE excluded.rev > workspaces.rev"}`,
      [id, name, slug, origin, syncMode, settingsJson, Number(rev)],
    )
  }

  private upsertCollection(workspaceId: string, id: string, rev: bigint, payload: Record<string, unknown>, force: boolean): void {
    const name = String(payload["name"] ?? "")
    const workflowOrder = JSON.stringify(payload["workflowOrder"] ?? [])
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
       rev = excluded.rev, updatedAt = datetime('now') ${force ? "" : "WHERE excluded.rev > collections.rev"}`,
      [id, workspaceId, workspaceId, name, slugify(name, id), workflowOrder, settingsJson, Number(rev)],
    )
  }

  private upsertWorkflow(workspaceId: string, id: string, rev: bigint, payload: Record<string, unknown>, force: boolean): void {
    const name = String(payload["name"] ?? "")
    const graphJson = JSON.stringify(payload["graph"] ?? { nodes: [], edges: [] })
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
       settings_json = excluded.settings_json, rev = excluded.rev, updatedAt = datetime('now')
       ${force ? "" : "WHERE excluded.rev > workflows.rev"}`,
      [id, workspaceId, workspaceId, name, slugify(name, id), graphJson, variablesJson, settingsJson, Number(rev)],
    )
  }

  private upsertEnvironment(workspaceId: string, id: string, rev: bigint, payload: Record<string, unknown>, force: boolean): void {
    const name = String(payload["name"] ?? "")
    const variablesJson = JSON.stringify(payload["variables"] ?? {})
    const settingsJson = JSON.stringify({
      description: payload["description"] ?? null,
      swaggerDocUrl: payload["swaggerDocUrl"] ?? null,
      secrets: {},
      isDefault: payload["isDefault"] ?? false,
    })
    this.store.set(
      `INSERT INTO environments (id, workspace_id, scopeId, name, slug, variables_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, scopeId = excluded.scopeId, name = excluded.name,
       slug = excluded.slug, variables_json = excluded.variables_json, settings_json = excluded.settings_json,
       rev = excluded.rev, updatedAt = datetime('now') ${force ? "" : "WHERE excluded.rev > environments.rev"}`,
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
              next_retry_at, failure_reason, created_at
       FROM cloud_outbox WHERE workspace_id = ? AND kind = ? AND record_id = ?
       ORDER BY created_at ASC, rowid ASC`,
      [workspaceId, kind, recordId],
    ).map(rowToOutboxRow)
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
    })
  }

  private saveConflict(input: Omit<CloudConflict, "winner" | "status" | "createdAt" | "resolvedAt">): void {
    this.store.set(
      `INSERT INTO cloud_conflicts (
         conflict_id, server_conflict_id, workspace_id, kind, record_id, base_rev,
         local_payload, cloud_payload, local_rev, cloud_rev, local_op, cloud_op
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conflict_id) DO UPDATE SET
         server_conflict_id = excluded.server_conflict_id,
         local_payload = excluded.local_payload, cloud_payload = excluded.cloud_payload,
         local_rev = excluded.local_rev, cloud_rev = excluded.cloud_rev,
         local_op = excluded.local_op, cloud_op = excluded.cloud_op`,
      [
        input.conflictId, input.serverConflictId, input.workspaceId, input.kind, input.recordId, input.baseRev,
        toBuffer(input.localPayload), toBuffer(input.cloudPayload), input.localRev, input.cloudRev,
        input.localOp, input.cloudOp,
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

function validatePayload(payload: Record<string, unknown>): void {
  const secrets = payload["secrets"]
  if (secrets !== undefined && secrets !== null && typeof secrets === "object" && Object.keys(secrets).length > 0) {
    throw new ErrForbiddenCloudPayload("secrets")
  }

  const runs = payload["runs"]
  if (Array.isArray(runs) && runs.length > 0) {
    throw new ErrForbiddenCloudPayload("runs")
  }
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

function payloadRevision(payload: Uint8Array | null): number | undefined {
  if (payload === null || payload.length === 0) {
    return undefined
  }
  try {
    const rev = parsePayload(payload)["rev"]
    return typeof rev === "number" && Number.isSafeInteger(rev) && rev >= 0 ? rev : undefined
  } catch {
    return undefined
  }
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
