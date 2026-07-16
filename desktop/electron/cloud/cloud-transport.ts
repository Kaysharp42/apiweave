/**
 * Cloud sync transport — implements SyncProvider for cloud-connected workspaces.
 *
 * Lifecycle:
 *   1. pull() — calls Hello; if full_resync_required, preserves the outbox and
 *      re-syncs from cursor zero. Otherwise, calls PullChanges(cursor)
 *      and applies changes to local repositories.
 *   2. push() — drains the durable outbox, calling PushDeltas with an
 *      idempotency key per outbox row. CloudClient centrally refreshes the
 *      memory-only app session and retries an unauthorized RPC once.
 *
 * All changes are applied inside per-record SQLite transactions. On any
 * error, the transaction rolls back and the outbox row stays pending.
 *
 * Log lines redact raw tokens, codes, secrets, and ciphertext.
 */

import type { SyncMutation, SyncProvider } from "../../core/sync/SyncProvider"
import type { KVStore } from "../../core/db"
import { CloudSyncRepository, type CloudWorkspaceBinding } from "../../core/repositories"
import {
  CloudClient,
  DeviceTokenStore,
  ErrCloudOffline,
  type ChangeEnvelope as ClientChangeEnvelope,
  type CloudClientConfig,
} from "./cloud-client"
import { CursorStore } from "./cloud-cursor"
import { Outbox, type OutboxInput, type OutboxRow, type OutboxKind, type OutboxOp } from "./cloud-outbox"
import { applyToRepositories, RecordKind, ChangeOp, type ChangeEnvelope } from "./cloud-apply"
import { PushOutcome_Status } from "@apiweave/proto/apiweave/v1/sync_service_pb"

export { CloudClient, DeviceTokenStore }

export type SyncState = "idle" | "initializing" | "syncing" | "conflict" | "error" | "offline"

export function createCloudClient(tokenStore: DeviceTokenStore, config?: CloudClientConfig): CloudClient {
  if (config === undefined) {
    throw new Error("Discovered cloud client configuration is required")
  }
  return new CloudClient(config, tokenStore)
}

const PAGE_SIZE = 100
const REDACTED = "***REDACTED***"

export interface CloudSyncConfig {
  readonly workspaceBindings: readonly CloudWorkspaceBindingRef[]
}

type CloudWorkspaceBindingRef = Pick<CloudWorkspaceBinding, "workspaceId" | "cloudWorkspaceId">

export class CloudSyncProvider implements SyncProvider {
  private cursorStore!: CursorStore
  private outbox!: Outbox
  private onStateChange?: (state: SyncState) => void
  private syncConfig: CloudSyncConfig | undefined = undefined
  private repository: CloudSyncRepository | undefined = undefined
  private stopped = false

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
    if (this.stopped) return
    this.onStateChange?.("syncing")
    if (!this.cursorStore || !this.syncConfig || !this.repository) {
      throw new Error("CloudSyncProvider not initialized with store and config")
    }
    try {
      const hello = await this.client.hello()
      if (this.stopped) return
      this.log("hello", { protocolVersion: hello.protocolVersion, fullResyncRequired: hello.fullResyncRequired })

      if (hello.fullResyncRequired) {
        await this.fullResync()
        this.onStateChange?.(this.stateAfterSync())
        return
      }

      let firstError: unknown
      for (const configuredBinding of this.syncConfig.workspaceBindings) {
        const binding = this.currentBinding(configuredBinding)
        try {
          if (binding.initializationState === "initialized") {
            if (binding.syncMode !== "push") {
              await this.pullWorkspace(binding)
              this.repository.markBindingSynced(binding.workspaceId)
            }
          } else {
            await this.resumeInitialSync(binding)
          }
        } catch (error) {
          this.repository.setBindingError(binding.workspaceId, failureReasonForError(error))
          firstError ??= error
        }
      }
      if (firstError !== undefined) {
        throw firstError
      }
      this.onStateChange?.(this.stateAfterSync())
    } catch (err) {
      if (this.stopped) return
      this.onStateChange?.(stateForError(err))
      throw err
    }
  }

  public recordMutation(mutation: SyncMutation): void {
    if (!this.outbox || !this.repository || !this.bindingForLocalWorkspace(mutation.workspaceId)) {
      return
    }
    const kind = recordKindToOutboxKind(mutation.kind)
    this.outbox.enqueue({
      workspace_id: mutation.workspaceId,
      kind,
      record_id: mutation.recordId,
      expected_rev: this.repository.expectedRevisionForMutation(
        mutation.workspaceId,
        kind,
        mutation.recordId,
        mutation.expectedRev,
      ),
      op: changeOpToOutboxOp(mutation.op),
      payload: mutation.payload,
    })
  }

  public async initializeWorkspace(workspaceId: string): Promise<void> {
    if (this.stopped) return
    this.onStateChange?.("initializing")
    if (!this.repository || !this.syncConfig) {
      throw new Error("CloudSyncProvider not initialized with store and config")
    }
    const configured = this.bindingForLocalWorkspace(workspaceId)
    if (configured === undefined) {
      throw new Error(`Cloud workspace binding unavailable for local workspace ${workspaceId}`)
    }
    try {
      const hello = await this.client.hello()
      if (this.stopped) return
      const binding = this.currentBinding(configured)
      if (hello.fullResyncRequired) {
        this.cursorStore.reset(binding.cloudWorkspaceId)
      }
      await this.resumeInitialSync(binding)
      if (this.stopped) return
      this.onStateChange?.(this.stateAfterSync())
    } catch (error) {
      if (this.stopped) return
      this.repository.setBindingError(workspaceId, failureReasonForError(error))
      this.onStateChange?.(stateForError(error))
      throw error
    }
  }

  public async resumePendingInitializations(): Promise<void> {
    if (!this.syncConfig) return
    for (const configured of this.syncConfig.workspaceBindings) {
      if (this.stopped) return
      const binding = this.currentBinding(configured)
      if (binding.initializationState !== "initialized") {
        try {
          await this.initializeWorkspace(binding.workspaceId)
        } catch {
          // Each binding is isolated; initialization state and redacted error remain durable.
        }
      }
    }
  }

  public deactivate(): void {
    this.stopped = true
  }

  private async fullResync(): Promise<void> {
    this.log("full resync required — preserving outbox and resetting cursors")

    if (!this.syncConfig || !this.cursorStore || !this.repository) return

    let firstError: unknown
    for (const binding of this.syncConfig.workspaceBindings) {
      try {
        const currentBeforePull = this.currentBinding(binding)
        if (currentBeforePull.initializationState === "initialized" && currentBeforePull.syncMode === "push") {
          continue
        }
        this.cursorStore.reset(binding.cloudWorkspaceId)
        await this.pullWorkspace(binding)
        if (this.stopped) return
        const current = this.currentBinding(binding)
        if (current.initializationState !== "initialized") {
          this.repository.setBindingInitializationState(binding.workspaceId, "pushing")
          await this.pushWorkspacePending(current)
          this.completeInitialSyncIfReady(current)
        }
        this.cursorStore.setFullSync(binding.cloudWorkspaceId, Date.now())
        this.repository.markBindingSynced(binding.workspaceId)
      } catch (error) {
        this.repository.setBindingError(binding.workspaceId, failureReasonForError(error))
        firstError ??= error
      }
    }
    if (firstError !== undefined) {
      throw firstError
    }
  }

  private async pullWorkspace(binding: CloudWorkspaceBindingRef): Promise<void> {
    if (!this.cursorStore || !this.repository) return

    const state = this.cursorStore.get(binding.cloudWorkspaceId)
    let cursor = state?.cursor ?? 0n

    let hasMore = true
    while (hasMore) {
      const response = await this.client.pullChanges(binding.cloudWorkspaceId, cursor, PAGE_SIZE)
      if (this.stopped) return

      for (const change of response.changes) {
        if (change.workspaceId?.value !== binding.cloudWorkspaceId) {
          throw new Error("Cloud pull returned a change for a different workspace")
        }
        this.applyChangeInTransaction(binding, change)
        cursor = change.cursor
      }

      const previousLastRev = this.cursorStore.get(binding.cloudWorkspaceId)?.lastRev ?? 0n
      const lastRev = response.changes[response.changes.length - 1]?.rev ?? previousLastRev
      const nextCursor = response.changes.length === 0 ? cursor : response.nextCursor
      this.cursorStore.set(binding.cloudWorkspaceId, nextCursor, lastRev)

      hasMore = response.hasMore
      cursor = response.nextCursor
    }
  }

  private applyChangeInTransaction(binding: CloudWorkspaceBindingRef, change: ClientChangeEnvelope): void {
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
      repository.setCursor(binding.cloudWorkspaceId, change.cursor, change.rev)
    })
  }

  public async push(): Promise<void> {
    if (this.stopped) return
    this.onStateChange?.("syncing")
    if (!this.outbox) {
      throw new Error("CloudSyncProvider not initialized with store")
    }
    try {
      const configuredWorkspaceIds = this.syncConfig?.workspaceBindings.map((binding) => binding.workspaceId) ?? []
      const orphanedCount = this.repository?.deadLetterOutboxOutsideWorkspaces(
        configuredWorkspaceIds,
        "cloud workspace binding is unavailable",
      ) ?? 0
      let firstError: unknown = orphanedCount > 0
        ? new Error(`${orphanedCount} cloud outbox row(s) have no workspace binding`)
        : undefined
      for (const configuredBinding of this.syncConfig?.workspaceBindings ?? []) {
        const binding = this.currentBinding(configuredBinding)
        try {
          if (binding.initializationState === "pulling") {
            await this.client.hello()
            await this.resumeInitialSync(binding)
          } else {
            await this.pushWorkspacePending(binding)
            if (binding.initializationState !== "initialized") {
              this.completeInitialSyncIfReady(binding)
            }
            this.repository?.markBindingSynced(binding.workspaceId)
          }
        } catch (error) {
          this.repository?.setBindingError(binding.workspaceId, failureReasonForError(error))
          firstError ??= error
        }
      }
      if (firstError !== undefined) {
        throw firstError
      }
      this.onStateChange?.(this.stateAfterSync())
    } catch (err) {
      if (this.stopped) return
      this.onStateChange?.(stateForError(err))
      throw err
    }
  }

  private async pushWorkspace(binding: CloudWorkspaceBindingRef, rows: OutboxRow[]): Promise<void> {
    const blockedRecords = new Set<string>()
    for (const row of rows) {
      const recordKey = `${row.kind}:${row.record_id}`
      if (blockedRecords.has(recordKey)) {
        continue
      }
      if (await this.pushRow(binding, row) === "blocked") {
        blockedRecords.add(recordKey)
      }
    }
  }

  private async pushWorkspacePending(binding: CloudWorkspaceBindingRef): Promise<void> {
    if (!this.repository) return
    while (true) {
      const rows = [...this.repository.listPendingOutboxForWorkspace(binding.workspaceId, PAGE_SIZE)]
      if (rows.length === 0) {
        return
      }
      this.log("push", { pendingCount: rows.length })
      await this.pushWorkspace(binding, rows)
      if (this.stopped) {
        return
      }
    }
  }

  private async resumeInitialSync(binding: CloudWorkspaceBinding): Promise<void> {
    if (!this.repository) return
    try {
      let current = this.currentBinding(binding)
      if (current.initializationState === "pulling") {
        await this.pullWorkspace(current)
        if (this.stopped) return
        this.repository.setBindingInitializationState(current.workspaceId, "pushing")
        current = this.currentBinding(current)
      }
      if (current.initializationState === "pushing") {
        await this.pushWorkspacePending(current)
        this.completeInitialSyncIfReady(current)
      }
      this.repository.markBindingSynced(current.workspaceId)
    } catch (error) {
      this.repository.setBindingError(binding.workspaceId, failureReasonForError(error))
      throw error
    }
  }

  private completeInitialSyncIfReady(binding: CloudWorkspaceBinding): void {
    if (this.repository?.countBaselineOutbox(binding.workspaceId) === 0) {
      const lastError = this.repository.countDeadLetterOutbox(binding.workspaceId) > 0
        ? this.repository.getWorkspaceBinding(binding.workspaceId)?.lastError ?? null
        : null
      this.repository.setBindingInitializationState(binding.workspaceId, "initialized", lastError)
    }
  }

  private currentBinding(binding: CloudWorkspaceBindingRef): CloudWorkspaceBinding {
    return this.repository?.getWorkspaceBinding(binding.workspaceId) ?? {
      ...binding,
      cloudWorkspaceName: "",
      teamId: null,
      teamName: null,
      syncMode: "bi-directional",
      deviceId: null,
      initializationState: "initialized",
      boundAt: "",
      lastSyncedAt: null,
      initializedAt: null,
      lastError: null,
    }
  }

  private async pushRow(binding: CloudWorkspaceBindingRef, row: OutboxRow): Promise<"applied" | "blocked"> {
    if (this.stopped) return "blocked"
    let response
    try {
      const delta = {
        workspaceId: binding.cloudWorkspaceId,
        kind: kindToRecordKind(row.kind),
        recordId: row.kind === "workspace" ? binding.cloudWorkspaceId : row.record_id,
        expectedRev: BigInt(row.expected_rev),
        payload: mapPayloadWorkspaceId(row.payload, binding.cloudWorkspaceId),
        op: opToChangeOp(row.op),
      }
      response = await this.client.pushDeltas(row.id, [delta])
    } catch (err) {
      if (this.stopped) return "blocked"
      this.outbox?.markFailed(row.id, failureReasonForError(err))
      throw err
    }
    if (this.stopped) return "blocked"

    const outcome = response.outcomes.find((candidate) => candidate.deltaIndex === 0)
    if (!outcome) {
      this.outbox?.markFailed(row.id, "missing push outcome")
      throw new Error("Cloud push response did not contain an outcome for the delta")
    }
    if (outcome.status === PushOutcome_Status.APPLIED || outcome.status === PushOutcome_Status.DUPLICATE) {
      this.outbox?.markApplied(row.id, Number(outcome.newRev))
      return "applied"
    } else if (outcome.status === PushOutcome_Status.CONFLICT && outcome.conflictId.length > 0) {
      this.repository?.recordPushConflict({
        conflictId: outcome.conflictId,
        outboxRow: row,
        cloudPayload: outcome.winnerPayload ?? new Uint8Array(),
        cloudRev: Number(outcome.newRev),
      })
      return "blocked"
    } else if (outcome.status === PushOutcome_Status.REJECTED) {
      const reason = `server rejected mutation: ${pushOutcomeFailureReason(outcome)}`
      this.outbox?.markDeadLetter(row.id, reason)
      this.repository?.setBindingError(binding.workspaceId, reason)
      return "blocked"
    } else {
      this.outbox?.markFailed(row.id, pushOutcomeFailureReason(outcome))
      return "blocked"
    }
  }

  private stateAfterSync(): SyncState {
    if (this.outbox.countDeadLetters() > 0) {
      return "error"
    }
    return (this.repository?.countPendingConflicts() ?? 0) > 0 ? "conflict" : "idle"
  }

  private bindingForLocalWorkspace(workspaceId: string): CloudWorkspaceBindingRef | undefined {
    return this.syncConfig?.workspaceBindings.find((binding) => binding.workspaceId === workspaceId)
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

function mapPayloadWorkspaceId(payload: Uint8Array | null, cloudWorkspaceId: string): Uint8Array {
  if (payload === null || payload.length === 0) {
    return new Uint8Array()
  }
  const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Cloud outbox payload must be a JSON object")
  }
  const mapped: Record<string, unknown> = { ...parsed as Record<string, unknown>, workspaceId: cloudWorkspaceId }
  if (mapped["scopeType"] === "workspace") {
    mapped["scopeId"] = cloudWorkspaceId
    const secrets = mapped["secrets"]
    if (secrets !== null && typeof secrets === "object" && !Array.isArray(secrets)) {
      mapped["secrets"] = Object.fromEntries(Object.entries(secrets).map(([name, value]) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          return [name, value]
        }
        const reference = (value as Record<string, unknown>)["reference"]
        const parts = typeof reference === "string" ? reference.split(":") : []
        return [name, {
          ...value as Record<string, unknown>,
          ...(parts.length >= 3 ? { reference: `workspace:${cloudWorkspaceId}:${parts.slice(2).join(":")}` } : {}),
        }]
      }))
    }
  }
  return new TextEncoder().encode(JSON.stringify(mapped))
}

function failureReasonForError(error: unknown): string {
  return `transport error: ${error instanceof Error ? error.name : "unknown"}`
}

function stateForError(error: unknown): SyncState {
  return error instanceof ErrCloudOffline ? "offline" : "error"
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
