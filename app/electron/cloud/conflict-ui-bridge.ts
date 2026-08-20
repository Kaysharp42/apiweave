import { z } from "zod"
import type { KVStore } from "../../core/db"
import { ConflictError, NotFoundError, ValidationError } from "../../core/ipc/errors"
import type { IpcRouter } from "../../core/ipc/router"
import { CloudSyncRepository, type CloudConflict } from "../../core/repositories"
import { ErrCloudConflictStale } from "./cloud-client"

export const CLOUD_CONFLICT_DOMAIN = "cloud"
export const CONFLICT_LIST_ACTION = "conflict-list"
export const CONFLICT_GET_ACTION = "conflict-get"
export const CONFLICT_RESOLVE_ACTION = "conflict-resolve"
export const CONFLICT_FETCH_LOSER_ACTION = "conflict-fetch-loser"

type ConflictWinner = "local" | "cloud" | "merged"
type ConflictKind = "workspace" | "project" | "collection" | "workflow" | "environment"
type JsonRecord = Record<string, unknown>

// One per-leaf pick for a MERGED resolution: choose which side wins an
// overlapping path the server reported in merge_residual_paths.
export interface FieldResolution {
  readonly path: string
  readonly side: "local" | "cloud"
}

export interface ResolveConflictInput {
  readonly conflict_id: string
  readonly winner: ConflictWinner
  readonly device_id: string
  // Field-level picks for a MERGED resolution. Ignored for keep-local/keep-cloud
  // and for a clean (residual-free) auto-merge.
  readonly resolutions?: readonly FieldResolution[]
  // When true the resolution writes its result to the local store and marks
  // the conflict resolved, but does NOT trigger a sync cycle — the merged
  // result stays local until the user explicitly syncs. The periodic sync
  // remains the correctness guarantee, so a deferred push is eventually
  // delivered without any further user action.
  readonly defer_push?: boolean
}

// The server's resolution outcome, used to converge locally. winnerPayload is
// the applied record (the merged payload for a MERGED resolution), at
// resultingRev.
export interface ResolveConflictOutcome {
  readonly resultingRev: number
  readonly winnerPayload: Uint8Array
}

export interface SyncConflictResolver {
  readonly resolveConflict: (input: ResolveConflictInput) => Promise<ResolveConflictOutcome>
  // Optional best-effort trigger to run a sync cycle immediately after a
  // resolve, so a keep-local re-push / merged re-push propagates and the view
  // settles in seconds instead of on the next periodic sync. Fire-and-forget:
  // the periodic sync remains the correctness guarantee, so it must not throw.
  readonly nudgeSync?: () => void
}

export interface ConflictUiBridgeOptions {
  readonly store: KVStore
  readonly syncService: SyncConflictResolver
}

const winnerSchema = z.enum(["local", "cloud", "merged"])
const resolutionSchema = z.object({ path: z.string().min(1), side: z.enum(["local", "cloud"]) })
const kindSchema = z.enum(["workspace", "project", "collection", "workflow", "environment"])
const conflictWriterSchema = z
  .object({
    userId: z.string(),
    deviceId: z.string(),
    name: z.string(),
    deviceLabel: z.string(),
  })
  .nullable()
const conflictListItemSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  kind: kindSchema,
  record_id: z.string(),
  name: z.string().nullable(),
  local_rev: z.number(),
  cloud_rev: z.number(),
  winner: winnerSchema.nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable().optional(),
  // cloud_writer attributes the cloud copy; null for legacy/pull conflicts.
  cloud_writer: conflictWriterSchema.optional(),
  // auto_mergeable: the server reported this conflict as cleanly 3-way
  // mergeable, so the UI may offer a one-click Auto-merge.
  auto_mergeable: z.boolean(),
  // merge_residual_paths: overlapping leaf paths for per-field picking. Non-empty
  // => the UI offers a per-path winner choice that completes the merge.
  merge_residual_paths: z.array(z.string()),
})
const conflictSchema = conflictListItemSchema.extend({
  local_payload: z.record(z.string(), z.unknown()),
  cloud_payload: z.record(z.string(), z.unknown()),
})

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
    input: z.object({
      conflict_id: z.string().min(1),
      winner: winnerSchema,
      device_id: z.string().min(1),
      resolutions: z.array(resolutionSchema).optional(),
      defer_push: z.boolean().optional(),
    }),
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
  private readonly repository: CloudSyncRepository

  public constructor(private readonly options: ConflictUiBridgeOptions) {
    this.repository = new CloudSyncRepository(options.store)
  }

  public list(input: { readonly resolved?: boolean; readonly since_days?: number } = {}): readonly z.infer<typeof conflictListItemSchema>[] {
    const resolved = input.resolved ?? false
    const days = input.since_days ?? 30
    return this.repository.listConflicts(resolved, days).map((conflict) => conflictToListItem(conflict, this.repository))
  }

  public get(conflictId: string): z.infer<typeof conflictSchema> {
    return conflictToDetail(this.mustGet(conflictId), this.repository)
  }

  // fallow-ignore-next-line complexity -- merged, remote, and offline-local resolution have distinct authorization paths
  public async resolve(input: ResolveConflictInput): Promise<z.infer<typeof conflictSchema>> {
    const conflict = this.mustGet(input.conflict_id)
    if (conflict.status === "resolved") {
      throw new ConflictError("Conflict already resolved", { conflict_id: input.conflict_id })
    }

    if (input.winner === "merged") {
      // Auto-merge is computed server-side, so it needs a reachable server and a
      // server snapshot. Unlike keep-local it cannot self-heal offline — fail
      // loudly if unavailable, and converge to the server-returned merged copy.
      if (conflict.serverConflictId === null) {
        throw new ValidationError("Auto-merge is not available for this conflict", { conflict_id: input.conflict_id })
      }
      const outcome = await this.options.syncService.resolveConflict({
        ...input,
        conflict_id: conflict.serverConflictId,
      })
      this.repository.resolveConflictMerged(input.conflict_id, outcome.resultingRev, outcome.winnerPayload)
      if (!input.defer_push) {
        this.options.syncService.nudgeSync?.()
      }
      return this.get(input.conflict_id)
    }

    if (conflict.serverConflictId !== null) {
      try {
        await this.options.syncService.resolveConflict({
          ...input,
          conflict_id: conflict.serverConflictId,
        })
      } catch (error) {
        // A stale server snapshot on "keep local" (the cloud record advanced
        // past it) is recoverable: the local resolution below re-enqueues the
        // edit and the next push reconciles against the current cloud rev —
        // regenerating a fresh conflict if the cloud genuinely diverged. Any
        // other failure (offline, auth, server error) is fatal and rethrown.
        if (!(input.winner === "local" && error instanceof ErrCloudConflictStale)) {
          throw error
        }
      }
    }

    this.repository.resolveConflict(input.conflict_id, input.winner)
    if (!input.defer_push) {
      this.options.syncService.nudgeSync?.()
    }
    return this.get(input.conflict_id)
  }

  public fetchLoser(conflictId: string): JsonRecord {
    const conflict = this.mustGet(conflictId)
    if (conflict.winner === null) {
      throw new ValidationError("Conflict is not resolved", { conflict_id: conflictId })
    }
    return conflict.winner === "local"
      ? parsePayload(conflict.cloudPayload)
      : parsePayload(conflict.localPayload)
  }

  private mustGet(conflictId: string): CloudConflict {
    const conflict = this.repository.getConflict(conflictId)
    if (conflict === undefined) throw new NotFoundError("Conflict not found", { conflict_id: conflictId })
    return conflict
  }
}

function conflictToListItem(conflict: CloudConflict, repository: CloudSyncRepository): z.infer<typeof conflictListItemSchema> {
  return {
    id: conflict.conflictId,
    workspace_id: conflict.workspaceId,
    kind: conflict.kind as ConflictKind,
    record_id: conflict.recordId,
    name: repository.getRecordName(conflict.kind, conflict.recordId) ?? null,
    local_rev: conflict.localRev,
    cloud_rev: conflict.cloudRev,
    winner: conflict.winner,
    created_at: conflict.createdAt,
    resolved_at: conflict.resolvedAt,
    cloud_writer: conflict.cloudWriter,
    auto_mergeable: conflict.autoMergeable,
    merge_residual_paths: [...conflict.mergeResidualPaths],
  }
}

function conflictToDetail(conflict: CloudConflict, repository: CloudSyncRepository): z.infer<typeof conflictSchema> {
  return {
    ...conflictToListItem(conflict, repository),
    local_payload: parsePayload(conflict.localPayload),
    cloud_payload: parsePayload(conflict.cloudPayload),
  }
}

function parsePayload(value: Uint8Array | null): JsonRecord {
  if (value === null || value.length === 0) {
    return {}
  }
  const text = Buffer.from(value).toString("utf8")
  const parsed = JSON.parse(text) as unknown
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError("Conflict payload must be a JSON object")
  }
  return parsed as JsonRecord
}
