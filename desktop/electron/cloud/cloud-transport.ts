/**
 * Cloud sync transport — implements SyncProvider for cloud-connected workspaces.
 *
 * Lifecycle:
 *   1. pull() — calls Hello; if full_resync_required, clears outbox and
 *      re-syncs from a full snapshot. Otherwise, calls PullChanges(cursor)
 *      and applies changes to local repositories.
 *   2. push() — drains the durable outbox, calling PushDeltas with an
 *      idempotency key per outbox row. On 401, pauses push, triggers token
 *      refresh, and retries once.
 *
 * All changes are applied inside per-record SQLite transactions. On any
 * error, the transaction rolls back and the outbox row stays pending.
 *
 * Log lines redact raw tokens, codes, secrets, and ciphertext.
 */

import type { SyncMutation, SyncProvider } from "../../core/sync/SyncProvider"
import type { KVStore } from "../../core/db"
import { CloudSyncRepository, type CloudWorkspaceBinding } from "../../core/repositories"
import { CloudClient, ErrUnauthorized, DeviceTokenStore, type ChangeEnvelope as ClientChangeEnvelope } from "./cloud-client"
import { CursorStore } from "./cloud-cursor"
import { Outbox, type OutboxInput, type OutboxRow, type OutboxKind, type OutboxOp } from "./cloud-outbox"
import { applyToRepositories, RecordKind, ChangeOp, type ChangeEnvelope } from "./cloud-apply"
import { PushOutcome_Status } from "../../../../apiweave-cloud/apps/web/gen/proto/ts/apiweave/v1/sync_service_pb.js"

export { CloudClient, DeviceTokenStore }

export type SyncState = "idle" | "syncing" | "conflict" | "error"

export function createCloudClient(tokenStore: DeviceTokenStore): CloudClient {
  return new CloudClient(
    { baseUrl: "https://api.apiweave.cloud", clientVersion: "1.0.0" },
    tokenStore,
  )
}

const PAGE_SIZE = 100
const REDACTED = "***REDACTED***"

export interface CloudSyncConfig {
  readonly workspaceBindings: readonly CloudWorkspaceBinding[]
  readonly zitadelIssuer: string
  readonly clientId: string
}

export class CloudSyncProvider implements SyncProvider {
  private cursorStore!: CursorStore
  private outbox!: Outbox
  private onStateChange?: (state: SyncState) => void
  private tokenStore: DeviceTokenStore | undefined = undefined
  private syncConfig: CloudSyncConfig | undefined = undefined
  private repository: CloudSyncRepository | undefined = undefined

  public constructor(
    private readonly client: CloudClient,
    tokenStoreOrCallback: DeviceTokenStore | ((state: SyncState) => void),
    store?: KVStore,
    config?: CloudSyncConfig,
    onStateChange?: (state: SyncState) => void,
  ) {
    if (typeof tokenStoreOrCallback === "function") {
      this.onStateChange = tokenStoreOrCallback
    } else {
      this.tokenStore = tokenStoreOrCallback
      if (onStateChange !== undefined) {
        this.onStateChange = onStateChange
      }
      if (store) {
        const repository = new CloudSyncRepository(store)
        this.repository = repository
        this.cursorStore = new CursorStore(repository)
        this.outbox = new Outbox(repository)
      }
      this.syncConfig = config
    }
  }

  public async pull(): Promise<void> {
    this.onStateChange?.("syncing")
    if (!this.cursorStore || !this.syncConfig || !this.repository) {
      throw new Error("CloudSyncProvider not initialized with store and config")
    }
    try {
      const hello = await this.client.hello()
      this.log("hello", { protocolVersion: hello.protocolVersion, fullResyncRequired: hello.fullResyncRequired })

      if (hello.fullResyncRequired) {
        await this.fullResync()
        this.onStateChange?.(this.stateAfterSync())
        return
      }

      for (const binding of this.syncConfig.workspaceBindings) {
        await this.pullWorkspace(binding)
      }
      this.onStateChange?.(this.stateAfterSync())
    } catch (err) {
      this.onStateChange?.("error")
      throw err
    }
  }

  public recordMutation(mutation: SyncMutation): void {
    if (!this.outbox || !this.bindingForLocalWorkspace(mutation.workspaceId)) {
      return
    }
    this.outbox.enqueue({
      workspace_id: mutation.workspaceId,
      kind: recordKindToOutboxKind(mutation.kind),
      record_id: mutation.recordId,
      expected_rev: mutation.expectedRev,
      op: changeOpToOutboxOp(mutation.op),
      payload: mutation.payload,
    })
  }

  private async fullResync(): Promise<void> {
    this.log("full resync required — clearing outbox and resetting cursors")
    this.outbox?.clear()

    if (!this.syncConfig || !this.cursorStore) return

    for (const binding of this.syncConfig.workspaceBindings) {
      this.cursorStore.reset(binding.cloudWorkspaceId)
      await this.pullWorkspace(binding)
      this.cursorStore.setFullSync(binding.cloudWorkspaceId, Date.now())
    }
  }

  private async pullWorkspace(binding: CloudWorkspaceBinding): Promise<void> {
    if (!this.cursorStore || !this.repository) return

    const state = this.cursorStore.get(binding.cloudWorkspaceId)
    let cursor = state?.cursor ?? 0n

    let hasMore = true
    while (hasMore) {
      const response = await this.client.pullChanges(binding.cloudWorkspaceId, cursor, PAGE_SIZE)

      for (const change of response.changes) {
        this.applyChangeInTransaction(binding, change)
        cursor = change.cursor
      }

      if (response.changes.length > 0) {
        const lastRev = response.changes[response.changes.length - 1]?.rev ?? 0n
        this.cursorStore.set(binding.cloudWorkspaceId, cursor, lastRev)
      }

      hasMore = response.hasMore
      cursor = response.nextCursor
    }
  }

  private applyChangeInTransaction(binding: CloudWorkspaceBinding, change: ClientChangeEnvelope): void {
    if (!this.repository) return

    const deletedAt = timestampToIso(change.deletedAt)
    const envelope: ChangeEnvelope = {
      cursor: change.cursor,
      workspaceId: binding.workspaceId,
      kind: change.kind,
      recordId: change.kind === RecordKind.WORKSPACE ? binding.workspaceId : change.recordId,
      rev: change.rev,
      op: change.op,
      payload: change.payload,
      ...(deletedAt !== undefined && { deletedAt }),
    }

    this.repository.transaction((repository) => {
      applyToRepositories(repository, envelope)
    })
  }

  public async push(): Promise<void> {
    this.onStateChange?.("syncing")
    if (!this.outbox) {
      throw new Error("CloudSyncProvider not initialized with store")
    }
    try {
      const pending = this.outbox.listPending(PAGE_SIZE)
      if (pending.length === 0) {
        this.onStateChange?.(this.stateAfterSync())
        return
      }

      this.log("push", { pendingCount: pending.length })

      const byWorkspace = new Map<string, OutboxRow[]>()
      for (const row of pending) {
        const rows = byWorkspace.get(row.workspace_id) ?? []
        rows.push(row)
        byWorkspace.set(row.workspace_id, rows)
      }

      for (const [workspaceId, rows] of byWorkspace) {
        const binding = this.bindingForLocalWorkspace(workspaceId)
        if (!binding) {
          for (const row of rows) {
            this.outbox.markFailed(row.id, "workspace binding unavailable")
          }
          throw new Error(`Cloud workspace binding unavailable for local workspace ${workspaceId}`)
        }
        await this.pushWorkspace(binding, rows)
      }
      this.onStateChange?.(this.stateAfterSync())
    } catch (err) {
      this.onStateChange?.("error")
      throw err
    }
  }

  private async pushWorkspace(binding: CloudWorkspaceBinding, rows: OutboxRow[]): Promise<void> {
    for (const row of rows) {
      await this.pushRow(binding, row)
    }
  }

  private async pushRow(binding: CloudWorkspaceBinding, row: OutboxRow): Promise<void> {
    const delta = {
      workspaceId: binding.cloudWorkspaceId,
      kind: kindToRecordKind(row.kind),
      recordId: row.kind === "workspace" ? binding.cloudWorkspaceId : row.record_id,
      expectedRev: BigInt(row.expected_rev),
      payload: row.payload ?? new Uint8Array(),
      op: opToChangeOp(row.op),
    }

    let response
    try {
      response = await this.client.pushDeltas(row.id, [delta])
    } catch (err) {
      if (err instanceof ErrUnauthorized) {
        const refreshed = await this.tryRefreshToken()
        if (refreshed) {
          try {
            response = await this.client.pushDeltas(row.id, [delta])
          } catch (retryError) {
            this.outbox?.markFailed(row.id, failureReasonForError(retryError))
            throw retryError
          }
        }
      }
      if (response === undefined) {
        this.outbox?.markFailed(row.id, failureReasonForError(err))
        throw err
      }
    }

    const outcome = response.outcomes.find((candidate) => candidate.deltaIndex === 0)
    if (!outcome) {
      this.outbox?.markFailed(row.id, "missing push outcome")
      throw new Error("Cloud push response did not contain an outcome for the delta")
    }
    if (outcome.status === PushOutcome_Status.APPLIED || outcome.status === PushOutcome_Status.DUPLICATE) {
      this.outbox?.markApplied(row.id, Number(outcome.newRev))
    } else if (outcome.status === PushOutcome_Status.CONFLICT && outcome.conflictId.length > 0) {
      this.repository?.recordPushConflict({
        conflictId: outcome.conflictId,
        outboxRow: row,
        cloudPayload: outcome.winnerPayload ?? new Uint8Array(),
      })
    } else {
      this.outbox?.markFailed(row.id, pushOutcomeFailureReason(outcome))
    }
  }

  private stateAfterSync(): SyncState {
    if (this.outbox.countDeadLetters() > 0) {
      return "error"
    }
    return (this.repository?.countPendingConflicts() ?? 0) > 0 ? "conflict" : "idle"
  }

  private bindingForLocalWorkspace(workspaceId: string): CloudWorkspaceBinding | undefined {
    return this.syncConfig?.workspaceBindings.find((binding) => binding.workspaceId === workspaceId)
  }

  private async tryRefreshToken(): Promise<boolean> {
    if (!this.tokenStore || !this.syncConfig) {
      this.log("token refresh failed — no token store or config")
      return false
    }
    const refreshToken = this.tokenStore.getRefreshToken()
    if (!refreshToken) {
      this.log("token refresh failed — no refresh token")
      return false
    }

    try {
      await this.client.refreshAccessToken(refreshToken, this.syncConfig.zitadelIssuer, this.syncConfig.clientId)
      this.log("token refreshed successfully")
      return true
    } catch {
      this.log("token refresh failed")
      return false
    }
  }

  public enqueue(row: OutboxInput): string {
    if (!this.outbox) {
      throw new Error("CloudSyncProvider not initialized with store")
    }
    return this.outbox.enqueue(row)
  }

  private log(message: string, data?: Record<string, unknown>): void {
    const redacted = data ? redactSensitive(data) : undefined
    console.log(`[cloud-sync] ${message}`, redacted ? JSON.stringify(redacted) : "")
  }
}

function redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitive(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return (
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("key") ||
    lower.includes("ciphertext") ||
    lower.includes("authorization")
  )
}

function kindToRecordKind(kind: OutboxKind): RecordKind {
  switch (kind) {
    case "workspace": return RecordKind.WORKSPACE
    case "workflow": return RecordKind.WORKFLOW
    case "environment": return RecordKind.ENVIRONMENT
    case "project": return RecordKind.PROJECT
  }
}

function opToChangeOp(op: OutboxOp): ChangeOp {
  switch (op) {
    case "upsert": return ChangeOp.UPSERT
    case "tombstone": return ChangeOp.TOMBSTONE
  }
}

function recordKindToOutboxKind(kind: RecordKind): OutboxKind {
  switch (kind) {
    case RecordKind.WORKSPACE: return "workspace"
    case RecordKind.WORKFLOW: return "workflow"
    case RecordKind.ENVIRONMENT: return "environment"
    case RecordKind.PROJECT: return "project"
    default: throw new Error(`unsupported sync record kind: ${kind}`)
  }
}

function changeOpToOutboxOp(op: ChangeOp): OutboxOp {
  switch (op) {
    case ChangeOp.UPSERT: return "upsert"
    case ChangeOp.TOMBSTONE: return "tombstone"
    default: throw new Error(`unsupported sync change op: ${op}`)
  }
}

function timestampToIso(value: ClientChangeEnvelope["deletedAt"]): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === "string") {
    return value
  }
  return new Date(Number(value.seconds) * 1000 + Math.floor(value.nanos / 1_000_000)).toISOString()
}

function failureReasonForError(error: unknown): string {
  if (error instanceof ErrUnauthorized) {
    return "transport error: unauthorized"
  }
  return `transport error: ${error instanceof Error ? error.name : "unknown"}`
}

function pushOutcomeFailureReason(outcome: {
  readonly status: PushOutcome_Status
  readonly newRev: bigint
  readonly rejectionReason: number
  readonly conflictId: string
}): string {
  return [
    `status=${outcome.status}`,
    `newRev=${outcome.newRev}`,
    `rejectionReason=${outcome.rejectionReason}`,
    ...(outcome.conflictId.length > 0 ? [`conflictId=${outcome.conflictId}`] : []),
  ].join(" ")
}
