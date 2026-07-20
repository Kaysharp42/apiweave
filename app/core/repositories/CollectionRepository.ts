import type { KVStore, SqliteRow } from "../db"
import type { Collection } from "@shared/types/Collection"
import type { WorkflowOrderItem } from "@shared/types/WorkflowOrderItem"
import { generateId } from "../id"
import { mustExist, parseJson, slugify, toJson } from "./helpers"

export type CollectionCreate = Pick<Collection, "workspaceId" | "name"> &
  Partial<Pick<Collection, "projectId" | "description" | "color" | "workflowOrder" | "continueOnFail">>

export type CollectionUpdate = Partial<
  Pick<Collection, "name" | "projectId" | "description" | "color" | "workflowCount" | "workflowOrder" | "continueOnFail">
>

const COLUMNS = "id, workspace_id, name, workflow_ids_json, settings_json, rev, createdAt, updatedAt"

interface CollectionRow extends SqliteRow {
  readonly id: string
  readonly workspace_id: string
  readonly name: string
  readonly workflow_ids_json: string
  readonly settings_json: string
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}

interface CollectionSettings {
  readonly projectId: string | null
  readonly description: string | null
  readonly color: string | null
  readonly workflowCount: number
  readonly continueOnFail: boolean
}

export class CollectionRepository {
  public constructor(private readonly store: KVStore) {}

  public transaction<T>(fn: () => T): T {
    return this.store.transaction(fn)
  }

  public create(input: CollectionCreate): Collection {
    const id = generateId()
    const settings: CollectionSettings = {
      projectId: input.projectId ?? null,
      description: input.description ?? null,
      color: input.color ?? null,
      workflowCount: 0,
      continueOnFail: input.continueOnFail ?? true,
    }
    this.store.set(
      "INSERT INTO collections (id, workspace_id, scopeId, name, slug, workflow_ids_json, settings_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, input.workspaceId, input.workspaceId, input.name, slugify(input.name, id), toJson(input.workflowOrder ?? []), toJson(settings)],
    )
    return mustExist(this.getById(id), `collection ${id} missing after insert`)
  }

  public getById(collectionId: string): Collection | undefined {
    const row = this.store.get<CollectionRow>(`SELECT ${COLUMNS} FROM collections WHERE id = ?`, [collectionId])
    return row === undefined ? undefined : rowToCollection(row)
  }

  public listByWorkspace(workspaceId: string): { items: readonly Collection[]; total: number } {
    const items = this.store
      .query<CollectionRow>(
        `SELECT ${COLUMNS} FROM collections WHERE workspace_id = ? ORDER BY createdAt DESC, id DESC`,
        [workspaceId],
      )
      .map(rowToCollection)
    return { items, total: items.length }
  }

  public update(collectionId: string, patch: CollectionUpdate): Collection | undefined {
    const existing = this.getById(collectionId)
    if (existing === undefined) {
      return undefined
    }
    const merged: Collection = { ...existing, ...patch }
    const settings: CollectionSettings = {
      projectId: merged.projectId ?? null,
      description: merged.description ?? null,
      color: merged.color ?? null,
      workflowCount: merged.workflowCount,
      continueOnFail: merged.continueOnFail,
    }
    this.store.set(
      "UPDATE collections SET name = ?, slug = ?, workflow_ids_json = ?, settings_json = ? WHERE id = ?",
      [merged.name, slugify(merged.name, collectionId), toJson(merged.workflowOrder), toJson(settings), collectionId],
    )
    return this.getById(collectionId)
  }

  public setWorkflowCount(collectionId: string, count: number): Collection | undefined {
    return this.update(collectionId, { workflowCount: Math.max(0, count) })
  }

  public incrementWorkflowCount(collectionId: string): Collection | undefined {
    const existing = this.getById(collectionId)
    if (existing === undefined) {
      return undefined
    }
    return this.update(collectionId, { workflowCount: existing.workflowCount + 1 })
  }

  public decrementWorkflowCount(collectionId: string): Collection | undefined {
    const existing = this.getById(collectionId)
    if (existing === undefined) {
      return undefined
    }
    return this.update(collectionId, { workflowCount: Math.max(0, existing.workflowCount - 1) })
  }

  public delete(collectionId: string): boolean {
    return this.store.delete("DELETE FROM collections WHERE id = ?", [collectionId]).changes > 0
  }
}

function rowToCollection(row: CollectionRow): Collection {
  const settings = parseJson<CollectionSettings>(row.settings_json)
  const workflowOrder = parseJson<readonly WorkflowOrderItem[]>(row.workflow_ids_json)
  return {
    collectionId: row.id,
    workspaceId: row.workspace_id,
    projectId: settings.projectId,
    name: row.name,
    description: settings.description,
    color: settings.color,
    workflowCount: settings.workflowCount,
    workflowOrder: [...workflowOrder],
    continueOnFail: settings.continueOnFail,
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
