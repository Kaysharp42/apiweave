import type { KVStore, SqliteRow } from "../db"
import type { JsonValue } from "@shared/types/JsonValue"
import { parseJson, toJson } from "./helpers"

interface SnapshotRow extends SqliteRow {
  readonly value: string
  readonly updated_at: string
}

/** One stored baseline and when it was accepted. */
export interface StoredSnapshot {
  readonly value: JsonValue
  readonly updatedAt: string
}

/**
 * Snapshot baselines (migration 032), one per assertion rule: the response that
 * was last accepted as correct. Local to the workspace database, so a baseline
 * is never shared unless the project is exported.
 */
export class SnapshotRepository {
  public constructor(private readonly store: KVStore) {}

  public read(workflowId: string, nodeId: string, ruleIndex: number): StoredSnapshot | undefined {
    const row = this.store.get<SnapshotRow>(
      "SELECT value, updated_at FROM snapshots WHERE workflow_id = ? AND node_id = ? AND rule_index = ?",
      [workflowId, nodeId, ruleIndex],
    )
    if (row === undefined) return undefined
    return { value: parseJson<JsonValue>(row.value), updatedAt: row.updated_at }
  }

  /** Records (or replaces) a baseline. The caller owns the value's shape. */
  public write(workflowId: string, nodeId: string, ruleIndex: number, value: JsonValue, updatedAt: string): void {
    this.store.set(
      `INSERT INTO snapshots (workflow_id, node_id, rule_index, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (workflow_id, node_id, rule_index) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [workflowId, nodeId, ruleIndex, toJson(value), updatedAt],
    )
  }

  public remove(workflowId: string, nodeId: string, ruleIndex: number): void {
    this.store.delete("DELETE FROM snapshots WHERE workflow_id = ? AND node_id = ? AND rule_index = ?", [workflowId, nodeId, ruleIndex])
  }

  /** Drops a deleted workflow's baselines with it. */
  public removeWorkflow(workflowId: string): void {
    this.store.delete("DELETE FROM snapshots WHERE workflow_id = ?", [workflowId])
  }
}
