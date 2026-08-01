import type { KVStore, SqliteRow } from "../db"
import type { JsonValue } from "@shared/types/JsonValue"
import type { NodePreset } from "@shared/types/NodePreset"
import { generateId } from "../id"
import { canonicalizeNodeConfig, mustExist, parseJson, toJson } from "./helpers"

export type NodePresetCreate = Pick<NodePreset, "workspaceId" | "name" | "nodeType"> &
  Partial<Pick<NodePreset, "config">>

export type NodePresetUpdate = Partial<Pick<NodePreset, "name" | "nodeType" | "config">>

const COLUMNS = "id, workspace_id, name, node_type, config_json, rev, createdAt, updatedAt"

interface NodePresetRow extends SqliteRow {
  readonly id: string
  readonly workspace_id: string
  readonly name: string
  readonly node_type: string
  readonly config_json: string
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}

export class NodePresetRepository {
  public constructor(private readonly store: KVStore) {}

  public create(input: NodePresetCreate): NodePreset {
    const id = generateId()
    this.store.set(
      "INSERT INTO node_presets (id, workspace_id, name, node_type, config_json) VALUES (?, ?, ?, ?, ?)",
      [id, input.workspaceId, input.name, input.nodeType, toJson(canonicalConfig(input.nodeType, input.config ?? {}))],
    )
    return mustExist(this.getById(id), `node preset ${id} missing after insert`)
  }

  public getById(presetId: string): NodePreset | undefined {
    const row = this.store.get<NodePresetRow>(`SELECT ${COLUMNS} FROM node_presets WHERE id = ?`, [presetId])
    return row === undefined ? undefined : rowToNodePreset(row)
  }

  public listByWorkspace(workspaceId: string): { items: readonly NodePreset[]; total: number } {
    const items = this.store
      .query<NodePresetRow>(`SELECT ${COLUMNS} FROM node_presets WHERE workspace_id = ? ORDER BY name ASC, id ASC`, [
        workspaceId,
      ])
      .map(rowToNodePreset)
    return { items, total: items.length }
  }

  public update(presetId: string, patch: NodePresetUpdate): NodePreset | undefined {
    const existing = this.getById(presetId)
    if (existing === undefined) {
      return undefined
    }
    const merged: NodePreset = { ...existing, ...patch }
    this.store.set(
      "UPDATE node_presets SET name = ?, node_type = ?, config_json = ? WHERE id = ?",
      [merged.name, merged.nodeType, toJson(canonicalConfig(merged.nodeType, merged.config)), presetId],
    )
    return this.getById(presetId)
  }

  public delete(presetId: string): boolean {
    return this.store.delete("DELETE FROM node_presets WHERE id = ?", [presetId]).changes > 0
  }
}

/**
 * Same trust boundary `WorkflowRepository` applies to a workflow graph: a
 * preset's config is a node config, so it is reduced to the canonical shape
 * (`KeyValuePair[]` KV fields, canonical assertion rules) before it is stored.
 * Without this, a preset promoted from a canvas node carrying a legacy
 * multiline-string `headers` value would drop straight onto another canvas and
 * fail `WorkflowNodeSchema` on the first save of the workflow it landed in.
 */
function canonicalConfig(nodeType: string, config: Record<string, JsonValue>): Record<string, JsonValue> {
  const canonical = canonicalizeNodeConfig({ type: nodeType, config }) as { config?: Record<string, JsonValue> }
  return canonical.config ?? config
}

function rowToNodePreset(row: NodePresetRow): NodePreset {
  return {
    presetId: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    nodeType: row.node_type as NodePreset["nodeType"],
    config: parseJson<Record<string, JsonValue>>(row.config_json),
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
