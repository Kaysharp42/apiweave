import type { KVStore, SqliteRow } from "../db"
import type { Workspace } from "@shared/types/Workspace"
import { generateId } from "../id"
import { mustExist, parseJson, toJson } from "./helpers"
import { holdNotificationsUntilCommit } from "./transactionNotifications"

export type WorkspaceCreate = Pick<Workspace, "name" | "slug"> & Partial<Pick<Workspace, "description" | "isPersonal">>

export type WorkspaceUpdate = Partial<Pick<Workspace, "name" | "slug" | "description" | "isPersonal" | "deletedAt">>

const COLUMNS = "id, name, slug, settings_json, rev, createdAt, updatedAt"

interface WorkspaceRow extends SqliteRow {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly settings_json: string
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}

interface WorkspaceSettings {
  readonly description: string | null
  readonly isPersonal: boolean
  readonly deletedAt: string | null
}

export class WorkspaceRepository {
  public constructor(private readonly store: KVStore) {}

  /** Same contract as `WorkflowRepository.transaction`. */
  public transaction<T>(fn: () => T): T {
    return holdNotificationsUntilCommit(this.store, () => this.store.transaction(fn))
  }

  public create(input: WorkspaceCreate): Workspace {
    const id = generateId()
    const settings: WorkspaceSettings = {
      description: input.description ?? null,
      isPersonal: input.isPersonal ?? true,
      deletedAt: null,
    }
    this.store.set(
      "INSERT INTO workspaces (id, name, slug, settings_json) VALUES (?, ?, ?, ?)",
      [id, input.name, input.slug, toJson(settings)],
    )
    return mustExist(this.getById(id), `workspace ${id} missing after insert`)
  }

  public getById(workspaceId: string): Workspace | undefined {
    const row = this.store.get<WorkspaceRow>(`SELECT ${COLUMNS} FROM workspaces WHERE id = ?`, [workspaceId])
    return row === undefined ? undefined : rowToWorkspace(row)
  }

  public getBySlug(slug: string): Workspace | undefined {
    const row = this.store.get<WorkspaceRow>(`SELECT ${COLUMNS} FROM workspaces WHERE slug = ?`, [slug])
    return row === undefined ? undefined : rowToWorkspace(row)
  }

  public listAll(): readonly Workspace[] {
    return this.store
      .query<WorkspaceRow>(`SELECT ${COLUMNS} FROM workspaces ORDER BY createdAt DESC, id DESC`)
      .map(rowToWorkspace)
  }

  public update(workspaceId: string, patch: WorkspaceUpdate): Workspace | undefined {
    const existing = this.getById(workspaceId)
    if (existing === undefined) {
      return undefined
    }
    const merged: Workspace = { ...existing, ...patch }
    const settings: WorkspaceSettings = {
      description: merged.description ?? null,
      isPersonal: merged.isPersonal,
      deletedAt: merged.deletedAt ?? null,
    }
    this.store.set(
      "UPDATE workspaces SET name = ?, slug = ?, settings_json = ? WHERE id = ?",
      [merged.name, merged.slug, toJson(settings), workspaceId],
    )
    return this.getById(workspaceId)
  }

  public delete(workspaceId: string): boolean {
    return this.store.delete("DELETE FROM workspaces WHERE id = ?", [workspaceId]).changes > 0
  }
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  const settings = parseJson<WorkspaceSettings>(row.settings_json)
  return {
    workspaceId: row.id,
    slug: row.slug,
    name: row.name,
    description: settings.description,
    isPersonal: settings.isPersonal,
    deletedAt: settings.deletedAt,
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
