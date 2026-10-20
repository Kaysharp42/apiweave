import type { KVStore, SqliteRow } from "../db"
import type { GitMergePick } from "@shared/types/GitMergePick"
import type { GitMergeSide } from "@shared/types/GitMergeSide"
import { isWorkspaceGitMode, type WorkspaceGitMode } from "@shared/types/WorkspaceGitMode"
import type { WorkspaceGitError } from "@shared/types/WorkspaceGitError"
import type { WorkspaceGitState } from "@shared/types/WorkspaceGitState"
import { getMapped, mustExist, parseJson, queryMapped, toJson } from "./helpers"

/** A tracked workspace's binding to its git repository: one `workspace_git` row. */
export interface WorkspaceGitBinding {
  readonly workspaceId: string
  /** Null while the history is local only. */
  readonly remoteUrl: string | null
  readonly branch: string
  readonly mode: WorkspaceGitMode
  readonly readOnly: boolean
  readonly state: WorkspaceGitState
  readonly lastError: WorkspaceGitError | null
  readonly lastSyncedCommit: string | null
  readonly lastSyncedAt: string | null
  /**
   * The commit the clone was on before a fast-forward or a discard moved it,
   * while the import of where it moved to has not committed. Non-null outside
   * a running integration: the clone is ahead of the database.
   */
  readonly integratingFrom: string | null
}

const COLUMNS =
  "workspace_id, remote_url, branch, mode, read_only, state, last_error, last_synced_commit, last_synced_at, integrating_from"

/**
 * A merge waiting for the user, as the row persists it: the three commits and
 * the picks made so far. Its conflicts are never stored — the same trees and
 * picks recompute them, which is what makes a restart free.
 */
export interface WorkspaceMerge {
  readonly workspaceId: string
  readonly baseCommit: string
  readonly ourCommit: string
  readonly theirCommit: string
  readonly picks: readonly GitMergePick[]
}

/** What a remote left on the row: where a sync got to, and whether it refused our pushes. None of it carries over to another remote. */
const CLEAR_SYNC_RECORD = "last_synced_commit = NULL, last_synced_at = NULL, read_only = 0"

const STATES: readonly string[] = ["idle", "syncing", "merging", "diverged", "error"] satisfies readonly WorkspaceGitState[]

function isState(value: string): value is WorkspaceGitState {
  return STATES.includes(value)
}

interface WorkspaceGitRow extends SqliteRow {
  readonly workspace_id: string
  readonly remote_url: string | null
  readonly branch: string
  readonly mode: string
  readonly read_only: number
  readonly state: string
  readonly last_error: string | null
  readonly last_synced_commit: string | null
  readonly last_synced_at: string | null
  readonly integrating_from: string | null
}

interface MergeRow extends SqliteRow {
  readonly workspace_id: string
  readonly base_commit: string
  readonly our_commit: string
  readonly their_commit: string
}

interface MergePickRow extends SqliteRow {
  readonly base_commit: string
  readonly record_id: string
  readonly path: string
  readonly side: string
}

/** Which workspaces have a git history, and how each one syncs. No row: not tracked. */
export class WorkspaceGitRepository {
  public constructor(private readonly store: KVStore) {}

  public get(workspaceId: string): WorkspaceGitBinding | undefined {
    return getMapped(this.store, `SELECT ${COLUMNS} FROM workspace_git WHERE workspace_id = ?`, [workspaceId], rowToBinding)
  }

  public listAll(): readonly WorkspaceGitBinding[] {
    return queryMapped(this.store, `SELECT ${COLUMNS} FROM workspace_git ORDER BY workspace_id`, [], rowToBinding)
  }

  public insert(workspaceId: string, mode: WorkspaceGitMode): WorkspaceGitBinding {
    this.store.set("INSERT INTO workspace_git (workspace_id, mode) VALUES (?, ?)", [workspaceId, mode])
    return mustExist(this.get(workspaceId), `workspace_git ${workspaceId} missing after insert`)
  }

  public setMode(workspaceId: string, mode: WorkspaceGitMode): boolean {
    return this.store.set("UPDATE workspace_git SET mode = ? WHERE workspace_id = ?", [mode, workspaceId]).changes > 0
  }

  /** Whether the host refuses this user's pushes. Not part of {@link CLEAR_SYNC_RECORD}: a push sets and clears it, not a change of remote. */
  public setReadOnly(workspaceId: string, readOnly: boolean): boolean {
    return this.store.set("UPDATE workspace_git SET read_only = ? WHERE workspace_id = ?", [readOnly ? 1 : 0, workspaceId]).changes > 0
  }

  /** Where a successful cycle left the two: the remote commit it integrated or pushed, and when. */
  public recordSynced(workspaceId: string, commit: string, at: string): boolean {
    return this.store.set("UPDATE workspace_git SET last_synced_commit = ?, last_synced_at = ? WHERE workspace_id = ?", [
      commit,
      at,
      workspaceId,
    ]).changes > 0
  }

  /**
   * Record, before the clone moves, the commit it is leaving — or null once the
   * database holds the tree the clone is on. Cleared in the same transaction as
   * the import, so the two commit together.
   */
  public setIntegratingFrom(workspaceId: string, commit: string | null): boolean {
    return this.store.set("UPDATE workspace_git SET integrating_from = ? WHERE workspace_id = ?", [commit, workspaceId]).changes > 0
  }

  /**
   * `lastError` is cleared unless given: a state change that is not an error
   * means the last one is over. It is stored as JSON, so its code survives as a
   * code rather than as a prefix of the message.
   */
  public setState(workspaceId: string, state: WorkspaceGitState, lastError: WorkspaceGitError | null = null): boolean {
    return this.store.set("UPDATE workspace_git SET state = ?, last_error = ? WHERE workspace_id = ?", [
      state,
      lastError === null ? null : toJson({ code: lastError.code, message: lastError.message }),
      workspaceId,
    ]).changes > 0
  }

  /**
   * Bind the workspace to a remote. A sync commit, a sync time and a read-only
   * flag belong to the remote they came from, so none survives a change of
   * remote. `state` and `last_error` are about the local repository's last
   * cycle, which a remote does not undo: they are left as they are.
   */
  public setRemote(workspaceId: string, remoteUrl: string, branch: string): boolean {
    return this.store.set(
      `UPDATE workspace_git SET remote_url = ?, branch = ?, ${CLEAR_SYNC_RECORD} WHERE workspace_id = ?`,
      [remoteUrl, branch, workspaceId],
    ).changes > 0
  }

  /** Back to local only. The branch stays: it is the local repository's own. */
  public clearRemote(workspaceId: string): boolean {
    return this.store.set(
      `UPDATE workspace_git SET remote_url = NULL, ${CLEAR_SYNC_RECORD} WHERE workspace_id = ?`,
      [workspaceId],
    ).changes > 0
  }

  public delete(workspaceId: string): boolean {
    return this.store.delete("DELETE FROM workspace_git WHERE workspace_id = ?", [workspaceId]).changes > 0
  }

  /**
   * The merge waiting for this workspace, or undefined. Picks are returned only
   * for the merge's own base commit: one made against a base the merge no
   * longer has is about different conflicts and settles nothing.
   */
  public getMerge(workspaceId: string): WorkspaceMerge | undefined {
    const row = getMapped(this.store, "SELECT workspace_id, base_commit, our_commit, their_commit FROM workspace_merge WHERE workspace_id = ?", [workspaceId], rowToMerge)
    if (row === undefined) return undefined
    const picks = queryMapped(
      this.store,
      "SELECT base_commit, record_id, path, side FROM workspace_merge_pick WHERE workspace_id = ? AND base_commit = ? ORDER BY record_id, path",
      [workspaceId, row.baseCommit],
      rowToPick,
    )
    return { ...row, picks }
  }

  /** Begin a merge, replacing any earlier one and its picks: the old conflicts are not these conflicts. */
  public startMerge(
    workspaceId: string,
    baseCommit: string,
    ourCommit: string,
    theirCommit: string,
    picks: readonly GitMergePick[],
  ): void {
    this.store.transaction((store) => {
      store.delete("DELETE FROM workspace_merge WHERE workspace_id = ?", [workspaceId])
      store.set("INSERT INTO workspace_merge (workspace_id, base_commit, our_commit, their_commit) VALUES (?, ?, ?, ?)", [
        workspaceId,
        baseCommit,
        ourCommit,
        theirCommit,
      ])
      this.insertPicks(store, workspaceId, baseCommit, picks)
    })
  }

  /**
   * Replace the merge's picks. False, and nothing written, when the merge has
   * moved on to another base commit: these picks settle conflicts it no longer has.
   */
  public setMergePicks(workspaceId: string, baseCommit: string, picks: readonly GitMergePick[]): boolean {
    return this.store.transaction((store) => {
      const row = store.get<{ base_commit: string } & SqliteRow>("SELECT base_commit FROM workspace_merge WHERE workspace_id = ?", [workspaceId])
      if (row === undefined || row.base_commit !== baseCommit) return false
      store.delete("DELETE FROM workspace_merge_pick WHERE workspace_id = ?", [workspaceId])
      this.insertPicks(store, workspaceId, baseCommit, picks)
      return true
    })
  }

  /** No merge is waiting any more. Its picks go with it. */
  public clearMerge(workspaceId: string): boolean {
    return this.store.delete("DELETE FROM workspace_merge WHERE workspace_id = ?", [workspaceId]).changes > 0
  }

  private insertPicks(store: KVStore, workspaceId: string, baseCommit: string, picks: readonly GitMergePick[]): void {
    for (const pick of picks) {
      store.set("INSERT OR REPLACE INTO workspace_merge_pick (workspace_id, base_commit, record_id, path, side) VALUES (?, ?, ?, ?, ?)", [
        workspaceId,
        baseCommit,
        pick.recordId,
        pick.path,
        pick.side,
      ])
    }
  }
}

function rowToBinding(row: WorkspaceGitRow): WorkspaceGitBinding {
  if (!isWorkspaceGitMode(row.mode) || !isState(row.state)) {
    throw new Error(`workspace_git ${row.workspace_id} holds an unknown mode or state: ${row.mode}/${row.state}`)
  }
  return {
    workspaceId: row.workspace_id,
    remoteUrl: row.remote_url,
    branch: row.branch,
    mode: row.mode,
    readOnly: row.read_only === 1,
    state: row.state,
    lastError: row.last_error === null ? null : parseJson<WorkspaceGitError>(row.last_error),
    lastSyncedCommit: row.last_synced_commit,
    lastSyncedAt: row.last_synced_at,
    integratingFrom: row.integrating_from,
  }
}

/** The merge row without its picks, which are read separately. */
function rowToMerge(row: MergeRow): Omit<WorkspaceMerge, "picks"> {
  return {
    workspaceId: row.workspace_id,
    baseCommit: row.base_commit,
    ourCommit: row.our_commit,
    theirCommit: row.their_commit,
  }
}

function rowToPick(row: MergePickRow): GitMergePick {
  if (!isMergeSide(row.side)) throw new Error(`workspace_merge_pick holds an unknown side: ${row.side}`)
  return { recordId: row.record_id, path: row.path, side: row.side }
}

function isMergeSide(value: string): value is GitMergeSide {
  return value === "ours" || value === "theirs"
}
