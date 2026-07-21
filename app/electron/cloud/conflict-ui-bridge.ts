import { z } from "zod"
import type { KVStore } from "../../core/db"
import { ConflictError, NotFoundError, ValidationError } from "../../core/ipc/errors"
import type { IpcRouter } from "../../core/ipc/router"
import { CloudSyncRepository, type CloudConflict } from "../../core/repositories"

export const CLOUD_CONFLICT_DOMAIN = "cloud"
export const CONFLICT_LIST_ACTION = "conflict-list"
export const CONFLICT_GET_ACTION = "conflict-get"
export const CONFLICT_RESOLVE_ACTION = "conflict-resolve"
export const CONFLICT_FETCH_LOSER_ACTION = "conflict-fetch-loser"

type ConflictWinner = "local" | "cloud"
type ConflictKind = "workspace" | "project" | "collection" | "workflow" | "environment"
type JsonRecord = Record<string, unknown>

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
  name: z.string().nullable(),
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

  public async resolve(input: ResolveConflictInput): Promise<z.infer<typeof conflictSchema>> {
    const conflict = this.mustGet(input.conflict_id)
    if (conflict.status === "resolved") {
      throw new ConflictError("Conflict already resolved", { conflict_id: input.conflict_id })
    }

    if (conflict.serverConflictId !== null) {
      await this.options.syncService.resolveConflict({
        ...input,
        conflict_id: conflict.serverConflictId,
      })
    }

    this.repository.resolveConflict(input.conflict_id, input.winner)
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
