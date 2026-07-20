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
import { CloudSyncRepository, type CloudCursorState } from "../../core/repositories"

export type CursorState = CloudCursorState

export class CursorStore {
  private readonly repository: CloudSyncRepository

  public constructor(store: KVStore | CloudSyncRepository) {
    this.repository = store instanceof CloudSyncRepository ? store : new CloudSyncRepository(store)
  }

  public get(workspaceId: string): CursorState | undefined {
    return this.repository.getCursor(workspaceId)
  }

  public set(workspaceId: string, cursor: bigint, lastRev: bigint): void {
    this.repository.setCursor(workspaceId, cursor, lastRev)
  }

  public setFullSync(workspaceId: string, timestampMs: number): void {
    this.repository.setFullSync(workspaceId, timestampMs)
  }

  public getFullSync(workspaceId: string): number | undefined {
    return this.repository.getFullSync(workspaceId)
  }

  public reset(workspaceId: string): void {
    this.repository.resetCursor(workspaceId)
  }
}
