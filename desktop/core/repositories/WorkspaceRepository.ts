import type { KVStore, SqliteRow } from "../db"
import type { Workspace } from "../../../shared/types/Workspace"
import type { WorkspaceOrigin } from "../../../shared/types/WorkspaceOrigin"
import type { WorkspaceSyncMode } from "../../../shared/types/WorkspaceSyncMode"
import { generateId } from "../id"
import { mustExist, parseJson, toJson } from "./helpers"

export type WorkspaceCreate = Pick<Workspace, "name" | "slug"> &
  Partial<Pick<Workspace, "description" | "isPersonal" | "origin" | "syncMode">>

export type WorkspaceUpdate = Partial<
  Pick<Workspace, "name" | "slug" | "description" | "isPersonal" | "origin" | "syncMode" | "deletedAt">
>

const COLUMNS = "id, name, slug, origin, syncMode, settings_json, rev, createdAt, updatedAt"

interface WorkspaceRow extends SqliteRow {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly origin: string
  readonly syncMode: string
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

  public create(input: WorkspaceCreate): Workspace {
    const id = generateId()
    const settings: WorkspaceSettings = {
      description: input.description ?? null,
      isPersonal: input.isPersonal ?? true,
      deletedAt: null,
    }
    this.store.set(
      "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
      [id, input.name, input.slug, input.origin ?? "local", input.syncMode ?? "none", toJson(settings)],
    )
    return mustExist(this.getById(id), `workspace ${id} missing after insert`)
  }

  /**
   * Insert a workspace with a caller-supplied id. Used to mirror a cloud
   * workspace locally under its cloud id so the binding is `localId == cloudId`
   * (no id remap needed on pull). Does not record a sync mutation.
   */
  public createWithId(input: WorkspaceCreate & { readonly id: string }): Workspace {
    const settings: WorkspaceSettings = {
      description: input.description ?? null,
      isPersonal: input.isPersonal ?? false,
      deletedAt: null,
    }
    this.store.set(
      "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
      [input.id, input.name, input.slug, input.origin ?? "cloud", input.syncMode ?? "none", toJson(settings)],
    )
    return mustExist(this.getById(input.id), `workspace ${input.id} missing after insert`)
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
      "UPDATE workspaces SET name = ?, slug = ?, origin = ?, syncMode = ?, settings_json = ? WHERE id = ?",
      [merged.name, merged.slug, merged.origin, merged.syncMode, toJson(settings), workspaceId],
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
    origin: row.origin as WorkspaceOrigin,
    syncMode: row.syncMode as WorkspaceSyncMode,
    deletedAt: settings.deletedAt,
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
