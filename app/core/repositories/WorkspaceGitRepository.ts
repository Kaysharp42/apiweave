import type { KVStore, SqliteRow } from "../db"
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
