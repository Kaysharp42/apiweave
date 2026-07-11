/**
 * Cursor store — tracks per-workspace sync position using the existing kvstore.
 *
 * Keys:
 *   cloud.cursor.<workspaceId>        — server cursor (int64 ms), the ONLY ordering authority
 *   cloud.last_rev.<workspaceId>      — last known server revision (for diagnostics)
 *   cloud.last_full_sync.<workspaceId> — timestamp (ms) of last full snapshot pull
 *
 * The cursor is NEVER derived from updatedAt — the server cursor is the sole
 * authority for pull pagination.
 */

import type { KVStore } from "../../core/db"

const KEY_CURSOR = "cloud.cursor."
const KEY_LAST_REV = "cloud.last_rev."
const KEY_LAST_FULL_SYNC = "cloud.last_full_sync."

export interface CursorState {
  readonly cursor: bigint
  readonly lastRev: bigint
}

export class CursorStore {
  public constructor(private readonly store: KVStore) {}

  public get(workspaceId: string): CursorState | undefined {
    const row = this.store.get<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [KEY_CURSOR + workspaceId],
    )
    if (row === undefined) {
      return undefined
    }
    const revRow = this.store.get<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [KEY_LAST_REV + workspaceId],
    )
    return {
      cursor: BigInt(row.value),
      lastRev: revRow ? BigInt(revRow.value) : 0n,
    }
  }

  public set(workspaceId: string, cursor: bigint, lastRev: bigint): void {
    this.store.set(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [KEY_CURSOR + workspaceId, cursor.toString()],
    )
    this.store.set(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [KEY_LAST_REV + workspaceId, lastRev.toString()],
    )
  }

  public setFullSync(workspaceId: string, timestampMs: number): void {
    this.store.set(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [KEY_LAST_FULL_SYNC + workspaceId, timestampMs.toString()],
    )
  }

  public getFullSync(workspaceId: string): number | undefined {
    const row = this.store.get<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [KEY_LAST_FULL_SYNC + workspaceId],
    )
    return row ? Number(row.value) : undefined
  }

  public reset(workspaceId: string): void {
    this.store.delete("DELETE FROM app_settings WHERE key = ?", [KEY_CURSOR + workspaceId])
    this.store.delete("DELETE FROM app_settings WHERE key = ?", [KEY_LAST_REV + workspaceId])
    this.store.delete("DELETE FROM app_settings WHERE key = ?", [KEY_LAST_FULL_SYNC + workspaceId])
  }
}
