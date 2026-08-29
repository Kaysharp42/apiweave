import type { KVStore, SqliteRow } from "../db"
import type { Environment } from "@shared/types/Environment"
import type { JsonValue } from "@shared/types/JsonValue"
import { generateId } from "../id"
import { mustExist, parseJson, slugify, toJson } from "./helpers"

export type EnvironmentCreate = Pick<Environment, "workspaceId" | "name"> &
  Partial<
    Pick<Environment, "description" | "swaggerDocUrl" | "baseEnvironmentId" | "variables" | "secrets" | "isDefault">
  >

export type EnvironmentUpdate = Partial<
  Pick<
    Environment,
    "name" | "description" | "swaggerDocUrl" | "baseEnvironmentId" | "variables" | "secrets" | "isDefault"
  >
>

const COLUMNS = "id, workspace_id, scopeType, scopeId, name, variables_json, settings_json, rev, createdAt, updatedAt"

interface EnvironmentRow extends SqliteRow {
  readonly id: string
  readonly workspace_id: string
  readonly scopeType: string
  readonly scopeId: string
  readonly name: string
  readonly variables_json: string
  readonly settings_json: string
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}

interface EnvironmentSettings {
  readonly description: string | null
  readonly swaggerDocUrl: string | null
  readonly baseEnvironmentId: string | null
  // Opaque passthrough. Secret material is sealed by the secrets subsystem
  // (Task 7) before it ever reaches here; the repository never reads it back
  // as plaintext and never writes plaintext into it.
  readonly secrets: Record<string, JsonValue>
  readonly isDefault: boolean
}

export class EnvironmentRepository {
  public constructor(private readonly store: KVStore) {}

  public create(input: EnvironmentCreate): Environment {
    const id = generateId()
    const settings: EnvironmentSettings = {
      description: input.description ?? null,
      swaggerDocUrl: normalizeSwaggerUrl(input.swaggerDocUrl),
      baseEnvironmentId: input.baseEnvironmentId ?? null,
      secrets: input.secrets ?? {},
      isDefault: input.isDefault ?? false,
    }
    this.store.set(
      "INSERT INTO environments (id, workspace_id, scopeId, name, slug, variables_json, settings_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, input.workspaceId, input.workspaceId, input.name, slugify(input.name, id), toJson(input.variables ?? {}), toJson(settings)],
    )
    return mustExist(this.getById(id), `environment ${id} missing after insert`)
  }

  public getById(environmentId: string): Environment | undefined {
    const row = this.store.get<EnvironmentRow>(`SELECT ${COLUMNS} FROM environments WHERE id = ?`, [environmentId])
    return row === undefined ? undefined : rowToEnvironment(row)
  }

  public listByWorkspace(workspaceId: string): { items: readonly Environment[]; total: number } {
    const items = this.store
      .query<EnvironmentRow>(
        `SELECT ${COLUMNS} FROM environments WHERE workspace_id = ? ORDER BY createdAt DESC, id DESC`,
        [workspaceId],
      )
      .map(rowToEnvironment)
    return { items, total: items.length }
  }

  public update(environmentId: string, patch: EnvironmentUpdate): Environment | undefined {
    const existing = this.getById(environmentId)
    if (existing === undefined) {
      return undefined
    }
    const merged: Environment = { ...existing, ...patch }
    const settings: EnvironmentSettings = {
      description: merged.description ?? null,
      swaggerDocUrl: normalizeSwaggerUrl(merged.swaggerDocUrl),
      baseEnvironmentId: merged.baseEnvironmentId ?? null,
      secrets: merged.secrets,
      isDefault: merged.isDefault,
    }
    this.store.set(
      "UPDATE environments SET name = ?, slug = ?, variables_json = ?, settings_json = ? WHERE id = ?",
      [merged.name, slugify(merged.name, environmentId), toJson(merged.variables), toJson(settings), environmentId],
    )
    return this.getById(environmentId)
  }

  public setVariable(environmentId: string, name: string, value: JsonValue): Environment | undefined {
    const existing = this.getById(environmentId)
    if (existing === undefined) {
      return undefined
    }
    return this.update(environmentId, { variables: { ...existing.variables, [name]: value } })
  }

  public deleteVariable(environmentId: string, name: string): Environment | undefined {
    const existing = this.getById(environmentId)
    if (existing === undefined) {
      return undefined
    }
    const variables = { ...existing.variables }
    delete variables[name]
    return this.update(environmentId, { variables })
  }

  /**
   * Re-home the environment onto another workspace. Deliberately absent from
   * {@link EnvironmentUpdate}: `workspace_id` is insert-only for every other
   * caller, and each of those is a within-workspace edit whose patch must never
   * carry the row out of the workspace the service already authorized. `scopeId`
   * mirrors `workspace_id` on a workspace-scoped row (see `create`), so the two
   * move together or the row's scope goes stale.
   */
  public setWorkspace(environmentId: string, workspaceId: string): Environment | undefined {
    if (this.getById(environmentId) === undefined) {
      return undefined
    }
    this.store.set("UPDATE environments SET workspace_id = ?, scopeId = ? WHERE id = ?", [
      workspaceId,
      workspaceId,
      environmentId,
    ])
    return this.getById(environmentId)
  }

  public transaction<T>(fn: () => T): T {
    return this.store.transaction(fn)
  }

  public delete(environmentId: string): boolean {
    return this.store.delete("DELETE FROM environments WHERE id = ?", [environmentId]).changes > 0
  }

  /**
   * Walks `baseEnvironmentId` from root to leaf and merges plain variables
   * (base first, each descendant overrides its ancestors). Secrets are never
   * part of this chain — they keep the existing environment > workspace scope
   * resolution. Depth-bounded so a cycle that slipped past write-time
   * validation can't hang or stack-overflow a run.
   */
  public resolveEffectiveVariables(environmentId: string, maxDepth = 8): Record<string, JsonValue> {
    const chain: Environment[] = []
    const seen = new Set<string>()
    let current = this.getById(environmentId)
    while (current !== undefined && !seen.has(current.environmentId) && chain.length < maxDepth) {
      chain.push(current)
      seen.add(current.environmentId)
      current = current.baseEnvironmentId ? this.getById(current.baseEnvironmentId) : undefined
    }
    let effective: Record<string, JsonValue> = {}
    for (const environment of chain.reverse()) {
      effective = { ...effective, ...environment.variables }
    }
    return effective
  }
}

function normalizeSwaggerUrl(url: string | null | undefined): string | null {
  if (url == null) {
    return null
  }
  const trimmed = url.trim()
  return trimmed.length > 0 ? trimmed : null
}

function rowToEnvironment(row: EnvironmentRow): Environment {
  const settings = parseJson<EnvironmentSettings>(row.settings_json)
  return {
    environmentId: row.id,
    workspaceId: row.workspace_id,
    scopeType: row.scopeType as "workspace" | "user",
    scopeId: row.scopeId,
    name: row.name,
    description: settings.description,
    swaggerDocUrl: settings.swaggerDocUrl,
    baseEnvironmentId: settings.baseEnvironmentId,
    variables: parseJson<Record<string, JsonValue>>(row.variables_json),
    secrets: settings.secrets,
    isDefault: settings.isDefault,
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
