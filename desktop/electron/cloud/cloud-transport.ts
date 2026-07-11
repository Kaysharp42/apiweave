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

import type { SyncProvider } from "../../core/sync/SyncProvider"
import type { KVStore } from "../../core/db"
import { CloudClient, ErrUnauthorized, DeviceTokenStore, type ChangeEnvelope as ClientChangeEnvelope } from "./cloud-client"
import { CursorStore } from "./cloud-cursor"
import { Outbox, type OutboxRow, type OutboxKind, type OutboxOp } from "./cloud-outbox"
import { applyToRepositories, RecordKind, ChangeOp, type ChangeEnvelope } from "./cloud-apply"

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
  readonly workspaceIds: string[]
  readonly zitadelIssuer: string
  readonly clientId: string
}

export class CloudSyncProvider implements SyncProvider {
  private cursorStore!: CursorStore
  private outbox!: Outbox
  private onStateChange?: (state: SyncState) => void
  private tokenStore: DeviceTokenStore | undefined = undefined
  private syncConfig: CloudSyncConfig | undefined = undefined
  private store: KVStore | undefined = undefined

  public constructor(
    private readonly client: CloudClient,
    tokenStoreOrCallback: DeviceTokenStore | ((state: SyncState) => void),
    store?: KVStore,
    config?: CloudSyncConfig,
  ) {
    if (typeof tokenStoreOrCallback === "function") {
      this.onStateChange = tokenStoreOrCallback
    } else {
      this.tokenStore = tokenStoreOrCallback
      this.store = store
      if (store) {
        this.cursorStore = new CursorStore(store)
        this.outbox = new Outbox(store)
      }
      this.syncConfig = config
    }
  }

  public async pull(): Promise<void> {
    this.onStateChange?.("syncing")
    if (!this.cursorStore || !this.syncConfig || !this.store) {
      throw new Error("CloudSyncProvider not initialized with store and config")
    }
    try {
      const hello = await this.client.hello()
      this.log("hello", { protocolVersion: hello.protocolVersion, fullResyncRequired: hello.fullResyncRequired })

      if (hello.fullResyncRequired) {
        await this.fullResync()
        return
      }

      for (const workspaceId of this.syncConfig.workspaceIds) {
        await this.pullWorkspace(workspaceId)
      }
      this.onStateChange?.("idle")
    } catch (err) {
      this.onStateChange?.("error")
      throw err
    }
  }

  private async fullResync(): Promise<void> {
    this.log("full resync required — clearing outbox and resetting cursors")
    this.outbox?.clear()

    if (!this.syncConfig || !this.cursorStore) return

    for (const workspaceId of this.syncConfig.workspaceIds) {
      this.cursorStore.reset(workspaceId)
      await this.pullWorkspace(workspaceId)
      this.cursorStore.setFullSync(workspaceId, Date.now())
    }
  }

  private async pullWorkspace(workspaceId: string): Promise<void> {
    if (!this.cursorStore || !this.store) return

    const state = this.cursorStore.get(workspaceId)
    let cursor = state?.cursor ?? 0n

    let hasMore = true
    while (hasMore) {
      const response = await this.client.pullChanges(workspaceId, cursor, PAGE_SIZE)

      for (const change of response.changes) {
        this.applyChangeInTransaction(workspaceId, change)
        cursor = change.cursor
      }

      if (response.changes.length > 0) {
        const lastRev = response.changes[response.changes.length - 1]?.rev ?? 0n
        this.cursorStore.set(workspaceId, cursor, lastRev)
      }

      hasMore = response.hasMore
      cursor = response.nextCursor
    }
  }

  private applyChangeInTransaction(workspaceId: string, change: ClientChangeEnvelope): void {
    if (!this.store) return

    const envelope: ChangeEnvelope = {
      cursor: change.cursor,
      workspaceId,
      kind: change.kind,
      recordId: change.recordId,
      rev: change.rev,
      op: change.op,
      payload: change.payload,
      ...(change.deletedAt !== undefined && { deletedAt: change.deletedAt }),
    }

    this.store.transaction(() => {
      applyToRepositories(this.store!, envelope)
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
        this.onStateChange?.("idle")
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
        await this.pushWorkspace(workspaceId, rows)
      }
      this.onStateChange?.("idle")
    } catch (err) {
      this.onStateChange?.("error")
      throw err
    }
  }

  private async pushWorkspace(workspaceId: string, rows: OutboxRow[]): Promise<void> {
    const deltas = rows.map((row) => ({
      workspaceId: row.workspace_id,
      kind: kindToRecordKind(row.kind),
      recordId: row.record_id,
      expectedRev: BigInt(row.expected_rev),
      payload: row.payload ?? new Uint8Array(),
      op: opToChangeOp(row.op),
    }))

    const idempotencyKey = rows[0]?.id ?? ""

    try {
      const response = await this.client.pushDeltas(idempotencyKey, deltas)

      for (const outcome of response.outcomes) {
        const row = rows[outcome.deltaIndex]
        if (!row) continue

        if (outcome.status === 1 /* APPLIED */ || outcome.status === 4 /* DUPLICATE */) {
          this.outbox?.markApplied(row.id)
        } else {
          this.outbox?.markFailed(row.id, `status=${outcome.status}`)
        }
      }
    } catch (err) {
      if (err instanceof ErrUnauthorized) {
        const refreshed = await this.tryRefreshToken()
        if (refreshed) {
          try {
            const response = await this.client.pushDeltas(idempotencyKey, deltas)
            for (const outcome of response.outcomes) {
              const row = rows[outcome.deltaIndex]
              if (!row) continue
              if (outcome.status === 1 || outcome.status === 4) {
                this.outbox?.markApplied(row.id)
              } else {
                this.outbox?.markFailed(row.id, `status=${outcome.status}`)
              }
            }
            return
          } catch {
          }
        }
      }
    }
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

  public enqueue(row: Omit<OutboxRow, "id" | "created_at">): string {
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
