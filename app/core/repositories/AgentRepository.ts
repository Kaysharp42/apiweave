import type { KVStore, SqliteRow } from "../db"
import type { AgentDefinition, StoredAgentDefinition } from "@shared/types/AgentDefinition"
import type { AgentScope, AgentScopeKind } from "@shared/types/AgentScope"
import type { AgentSession } from "@shared/types/AgentSession"
import { isAgentScopeKind } from "@shared/types/AgentScope"
import { AgentLaunchModeSchema, AgentSessionStatusSchema } from "@shared/zod-schemas/AgentSessionSchema"
import { generateId } from "../id"
import { mustExist, parseJson, toJson } from "./helpers"

export type AgentDefinitionUpsert = AgentDefinition & { readonly isCustom?: boolean }

export type AgentSessionCreate = Pick<AgentSession, "workspaceId" | "agentKey" | "launchMode" | "status" | "cwd"> &
  Partial<Pick<AgentSession, "scopeKind" | "scopeId" | "pid" | "agentSessionRef">>

export type AgentSessionUpdate = Partial<
  Pick<AgentSession, "status" | "pid" | "exitCode" | "error" | "agentSessionRef" | "title">
>

const DEFINITION_COLUMNS =
  "id, workspace_id, agent_key, name, detect_cmd, argv_json, expected_process, env_json, options_json, is_custom, rev, createdAt, updatedAt"

/** The behavioural half of a definition — see `options_json` in migration 015. */
type AgentDefinitionOptions = Pick<
  AgentDefinition,
  | "promptMode"
  | "promptFlag"
  | "mcpConfigArgs"
  | "briefingArgs"
  | "unsupportedPlatforms"
  | "installUrl"
  | "sessionIdMode"
  | "newSessionArgs"
  | "resumeArgs"
  | "sessionIdPattern"
>

const SESSION_COLUMNS =
  "id, workspace_id, agent_key, launch_mode, status, cwd, scope_kind, scope_id, pid, exit_code, error, agent_session_ref, title, startedAt, endedAt"

/** How many session rows a workspace keeps — see {@link AgentRepository.pruneSessions}. */
const SESSION_HISTORY_LIMIT = 200

interface AgentDefinitionRow extends SqliteRow {
  readonly id: string
  readonly workspace_id: string
  readonly agent_key: string
  readonly name: string
  readonly detect_cmd: string
  readonly argv_json: string
  readonly expected_process: string | null
  readonly env_json: string
  readonly options_json: string
  readonly is_custom: number
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}

interface AgentLocalPathRow extends SqliteRow {
  readonly scope_kind: string
  readonly scope_id: string
  readonly local_path: string
}

interface AgentSessionRow extends SqliteRow {
  readonly id: string
  readonly workspace_id: string
  readonly agent_key: string
  readonly launch_mode: string
  readonly status: string
  readonly cwd: string
  readonly scope_kind: string | null
  readonly scope_id: string | null
  readonly pid: number | null
  readonly exit_code: number | null
  readonly error: string | null
  readonly agent_session_ref: string | null
  readonly title: string | null
  readonly startedAt: string
  readonly endedAt: string | null
}

/**
 * All agent SQL, in one place per the repository convention.
 *
 * The three tables it owns are unrelated to each other except in lifetime: a
 * local path, a stored agent definition, and a launched session are all
 * machine-local facts that appear and disappear with migration 015. Splitting
 * them into three repositories would triple the wiring for no boundary.
 */
export class AgentRepository {
  public constructor(private readonly store: KVStore) {}

  // ── definitions ─────────────────────────────────────────────────────────

  /**
   * Upsert by `(workspace_id, agent_key)` rather than by row id, because that
   * is the identity the renderer knows: it sends an `agentKey`, never a row id.
   * A built-in override and a custom agent are the same row shape; `is_custom`
   * only decides whether the roster offers a delete.
   */
  // fallow-ignore-next-line complexity -- the branches are SQL null-guards over optional patch fields plus one terminal-status check; the CRAP score is the estimated-coverage artifact for a method exercised through agent_service.test.ts
  public upsertDefinition(workspaceId: string, input: AgentDefinitionUpsert): StoredAgentDefinition {
    const existing = this.getDefinition(workspaceId, input.agentKey)
    const id = existing?.definitionId ?? generateId()
    const isCustom = input.isCustom ?? existing?.isCustom ?? true
    this.store.set(
      `INSERT INTO agent_definitions
         (id, workspace_id, agent_key, name, detect_cmd, argv_json, expected_process, env_json, options_json, is_custom)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, agent_key) DO UPDATE SET
         name = excluded.name,
         detect_cmd = excluded.detect_cmd,
         argv_json = excluded.argv_json,
         expected_process = excluded.expected_process,
         env_json = excluded.env_json,
         options_json = excluded.options_json,
         is_custom = excluded.is_custom`,
      [
        id,
        workspaceId,
        input.agentKey,
        input.name,
        input.detectCmd,
        toJson(input.argv),
        input.expectedProcess ?? null,
        toJson(input.env),
        toJson({
          promptMode: input.promptMode,
          promptFlag: input.promptFlag ?? null,
          mcpConfigArgs: input.mcpConfigArgs,
          briefingArgs: input.briefingArgs,
          unsupportedPlatforms: input.unsupportedPlatforms,
          installUrl: input.installUrl ?? null,
          sessionIdMode: input.sessionIdMode,
          newSessionArgs: input.newSessionArgs,
          resumeArgs: input.resumeArgs,
          sessionIdPattern: input.sessionIdPattern ?? null,
        } satisfies AgentDefinitionOptions),
        isCustom ? 1 : 0,
      ],
    )
    return mustExist(
      this.getDefinition(workspaceId, input.agentKey),
      `agent definition ${input.agentKey} missing after upsert`,
    )
  }

  public getDefinition(workspaceId: string, agentKey: string): StoredAgentDefinition | undefined {
    const row = this.store.get<AgentDefinitionRow>(
      `SELECT ${DEFINITION_COLUMNS} FROM agent_definitions WHERE workspace_id = ? AND agent_key = ?`,
      [workspaceId, agentKey],
    )
    return row === undefined ? undefined : rowToDefinition(row)
  }

  public listDefinitions(workspaceId: string): readonly StoredAgentDefinition[] {
    return this.store
      .query<AgentDefinitionRow>(
        `SELECT ${DEFINITION_COLUMNS} FROM agent_definitions WHERE workspace_id = ? ORDER BY name ASC, agent_key ASC`,
        [workspaceId],
      )
      .map(rowToDefinition)
  }

  public deleteDefinition(workspaceId: string, agentKey: string): boolean {
    return (
      this.store.delete("DELETE FROM agent_definitions WHERE workspace_id = ? AND agent_key = ?", [
        workspaceId,
        agentKey,
      ]).changes > 0
    )
  }

  // ── default agent ───────────────────────────────────────────────────────

  /**
   * Kept in `app_settings` rather than as a column, because it is a single
   * scalar preference per workspace — the same shape `mcp.enabled` and
   * `updates.policy` already use.
   */
  public getDefaultAgentKey(workspaceId: string): string | undefined {
    return this.store.get<{ value: string } & SqliteRow>("SELECT value FROM app_settings WHERE key = ?", [
      defaultAgentSettingKey(workspaceId),
    ])?.value
  }

  public setDefaultAgentKey(workspaceId: string, agentKey: string): void {
    this.store.set("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [
      defaultAgentSettingKey(workspaceId),
      agentKey,
    ])
  }

  /**
   * Forget the stored preference so the roster falls back to the built-in
   * default. The setting is a loose key/value pair with no FK to the definition
   * it names, so deleting an agent leaves the key pointing at nothing — the
   * roster then marks no row as default at all, and `getDefaultAgentKey`
   * happily reports a key the user cannot launch.
   */
  public clearDefaultAgentKey(workspaceId: string): boolean {
    return this.store.delete("DELETE FROM app_settings WHERE key = ?", [defaultAgentSettingKey(workspaceId)]).changes > 0
  }

  // ── local paths ─────────────────────────────────────────────────────────

  public getLocalPath(scope: AgentScope): string | undefined {
    const row = this.store.get<AgentLocalPathRow>(
      "SELECT scope_kind, scope_id, local_path FROM agent_local_paths WHERE scope_kind = ? AND scope_id = ?",
      [scope.kind, scope.id],
    )
    return row?.local_path
  }

  public setLocalPath(scope: AgentScope, localPath: string): void {
    this.store.set(
      `INSERT INTO agent_local_paths (scope_kind, scope_id, local_path) VALUES (?, ?, ?)
       ON CONFLICT (scope_kind, scope_id) DO UPDATE SET
         local_path = excluded.local_path,
         updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      [scope.kind, scope.id, localPath],
    )
  }

  public deleteLocalPath(scope: AgentScope): boolean {
    return (
      this.store.delete("DELETE FROM agent_local_paths WHERE scope_kind = ? AND scope_id = ?", [scope.kind, scope.id])
        .changes > 0
    )
  }

  // ── sessions ────────────────────────────────────────────────────────────

  public createSession(input: AgentSessionCreate): AgentSession {
    const id = generateId()
    this.store.set(
      `INSERT INTO agent_sessions (id, workspace_id, agent_key, launch_mode, status, cwd, scope_kind, scope_id, pid, agent_session_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.workspaceId,
        input.agentKey,
        input.launchMode,
        input.status,
        input.cwd,
        input.scopeKind ?? null,
        input.scopeId ?? null,
        input.pid ?? null,
        // Set at insert for an `assign` agent, whose ref APIWeave mints before
        // the process exists, and for a resume, which inherits the ref of the
        // conversation it is continuing. Null for a `scan` agent until its
        // output gives one up.
        input.agentSessionRef ?? null,
      ],
    )
    this.pruneSessions(input.workspaceId)
    return mustExist(this.getSession(id), `agent session ${id} missing after insert`)
  }

  /**
   * Sessions were append-only: `listSessions` reads at most 50, so an unbounded
   * table was invisible until the file it lives in was, and every launch added
   * a row for ever. Pruning on insert rather than on a timer keeps it to the one
   * moment the table can actually grow.
   *
   * Only terminal rows are eligible, and the window counts *all* rows so a
   * workspace full of live sessions can never prune one that is still running.
   * 200 is four times what the list can show, which leaves the history that
   * scrolling and future filters need without keeping it for ever.
   */
  public pruneSessions(workspaceId: string, keep = SESSION_HISTORY_LIMIT): number {
    return this.store.delete(
      `DELETE FROM agent_sessions
        WHERE workspace_id = ?
          AND status IN ('exited', 'failed')
          AND id NOT IN (
            SELECT id FROM agent_sessions WHERE workspace_id = ? ORDER BY startedAt DESC, id DESC LIMIT ?
          )`,
      [workspaceId, workspaceId, keep],
    ).changes
  }

  public deleteSession(sessionId: string): boolean {
    return this.store.delete("DELETE FROM agent_sessions WHERE id = ?", [sessionId]).changes > 0
  }

  public getSession(sessionId: string): AgentSession | undefined {
    const row = this.store.get<AgentSessionRow>(`SELECT ${SESSION_COLUMNS} FROM agent_sessions WHERE id = ?`, [
      sessionId,
    ])
    return row === undefined ? undefined : rowToSession(row)
  }

  public listSessions(workspaceId: string, limit = 50): readonly AgentSession[] {
    return this.store
      .query<AgentSessionRow>(
        `SELECT ${SESSION_COLUMNS} FROM agent_sessions WHERE workspace_id = ? ORDER BY startedAt DESC, id DESC LIMIT ?`,
        [workspaceId, limit],
      )
      .map(rowToSession)
  }

  /**
   * `endedAt` is stamped by the terminal statuses rather than passed in, so a
   * session cannot be recorded as exited while still claiming to be open.
   *
   * Two things this refuses to do. It will not move a session *out* of a
   * terminal status: `exited` and `failed` are the end of the row's life, and a
   * late `agent.started` from a host that is being torn down would otherwise
   * resurrect a dead session as running for ever. And it never nulls an
   * `endedAt` that is already set — the previous form wrote `NULL` for any
   * non-terminal status, so one such patch on an ended row would have produced
   * a session that has both an exit code and no end time.
   */
  // fallow-ignore-next-line complexity -- the branches preserve untouched patch fields, pin a terminal status, and stamp endedAt only on terminal statuses; the CRAP score is the estimated-coverage artifact for a method exercised through agent_service.test.ts
  public updateSession(sessionId: string, patch: AgentSessionUpdate): AgentSession | undefined {
    const existing = this.getSession(sessionId)
    if (existing === undefined) {
      return undefined
    }
    const status = isTerminalStatus(existing.status) ? existing.status : (patch.status ?? existing.status)
    const endedAt = isTerminalStatus(status) ? (existing.endedAt ?? nowIso()) : (existing.endedAt ?? null)
    this.store.set(
      `UPDATE agent_sessions
         SET status = ?, pid = ?, exit_code = ?, error = ?, agent_session_ref = ?, title = ?, endedAt = ?
       WHERE id = ?`,
      [
        status,
        patch.pid === undefined ? (existing.pid ?? null) : patch.pid,
        patch.exitCode === undefined ? (existing.exitCode ?? null) : patch.exitCode,
        patch.error === undefined ? (existing.error ?? null) : patch.error,
        // Deliberately outside the terminal-status pin above. A `scan` agent
        // prints its session id in the banner it writes on the way *out*, so the
        // ref and the title routinely arrive for a row that has already ended —
        // and refusing them there would throw away the only thing that makes a
        // finished session resumable. Neither field can resurrect a row: they
        // are not status, and `endedAt` is computed without them.
        patch.agentSessionRef === undefined ? (existing.agentSessionRef ?? null) : patch.agentSessionRef,
        patch.title === undefined ? (existing.title ?? null) : patch.title,
        endedAt,
        sessionId,
      ],
    )
    return this.getSession(sessionId)
  }

  /**
   * Put a finished session back to `starting` so its conversation can be run
   * again in the same row.
   *
   * Its own method rather than a flag on {@link updateSession}, because that
   * method's refusal to move a row out of a terminal status is load-bearing: it
   * is what stops a late `agent.started` from a host being torn down
   * resurrecting a dead session for ever. Resuming is the one legitimate way out
   * of that state, and it is a deliberate act by the user rather than an event
   * arriving from a process — so it gets a door of its own instead of widening
   * the one that is holding.
   *
   * The previous run's outcome is cleared, not kept. A row that showed `exit 1`
   * and a pid from a process that is now gone, while a new process runs under
   * it, would be describing neither. `startedAt` moves to now for the same
   * reason — it is when *this* run began — and, usefully, it floats the resumed
   * session back to the top of a list ordered by it.
   */
  public reviveSession(sessionId: string): AgentSession | undefined {
    if (this.getSession(sessionId) === undefined) {
      return undefined
    }
    this.store.set(
      `UPDATE agent_sessions
         SET status = 'starting', pid = NULL, exit_code = NULL, error = NULL, endedAt = NULL, startedAt = ?
       WHERE id = ?`,
      [nowIso(), sessionId],
    )
    return this.getSession(sessionId)
  }

  /**
   * Anything still marked live at startup is a leftover from a crash or a hard
   * quit — the process it named did not survive the app that owned it.
   */
  public markOrphanedSessionsFailed(): number {
    return this.store.set(
      `UPDATE agent_sessions
         SET status = 'failed', error = 'APIWeave exited while this session was running', endedAt = ?
       WHERE status IN ('starting', 'running')`,
      [nowIso()],
    ).changes
  }
}

function defaultAgentSettingKey(workspaceId: string): string {
  return `agents.default_agent.${workspaceId}`
}

function isTerminalStatus(status: AgentSession["status"]): boolean {
  return status === "exited" || status === "failed"
}

function nowIso(): string {
  return new Date().toISOString()
}

function rowToDefinition(row: AgentDefinitionRow): StoredAgentDefinition {
  // Rows written by an earlier phase can legally predate a field added to
  // `options_json`, so each one falls back rather than trusting the blob.
  const options = parseJson<Partial<AgentDefinitionOptions>>(row.options_json)
  return {
    definitionId: row.id,
    workspaceId: row.workspace_id,
    agentKey: row.agent_key,
    name: row.name,
    detectCmd: row.detect_cmd,
    argv: parseJson<string[]>(row.argv_json),
    expectedProcess: row.expected_process,
    env: parseJson<Record<string, string>>(row.env_json),
    promptMode: options.promptMode ?? "none",
    promptFlag: options.promptFlag ?? null,
    mcpConfigArgs: options.mcpConfigArgs ?? [],
    // A definition stored before the briefing existed launches without one,
    // which is the same thing an agent whose CLI has no such flag does.
    briefingArgs: options.briefingArgs ?? [],
    unsupportedPlatforms: options.unsupportedPlatforms ?? [],
    installUrl: options.installUrl ?? null,
    // A definition stored before migration 016 has none of these, and the
    // fallbacks are what make it launch anyway — as an agent that simply does
    // not offer resume, which is what it was when it was written.
    sessionIdMode: options.sessionIdMode ?? "none",
    newSessionArgs: options.newSessionArgs ?? [],
    resumeArgs: options.resumeArgs ?? [],
    sessionIdPattern: options.sessionIdPattern ?? null,
    isCustom: row.is_custom === 1,
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * The three string unions are parsed, not asserted.
 *
 * A `CHECK` constraint only binds the schema the file was created with, so a
 * database restored from an older build, hand-edited, or written by a future
 * migration can hold a `status` outside the union — and a bare `as` cast hands
 * that straight to a renderer whose `switch` is exhaustive over four cases and
 * silently renders nothing for the fifth. Parsing turns it into a throw at the
 * read, next to the row that is wrong.
 *
 * Only the unions go through zod, not the whole session: `listSessions` runs
 * this per row, and every other column is already typed by SQLite's own
 * declared type. `scopeKind` uses the shared guard rather than a schema because
 * it is legitimately null for a session launched without a scope.
 */
function rowToSession(row: AgentSessionRow): AgentSession {
  return {
    sessionId: row.id,
    workspaceId: row.workspace_id,
    agentKey: row.agent_key,
    launchMode: AgentLaunchModeSchema.parse(row.launch_mode),
    status: AgentSessionStatusSchema.parse(row.status),
    cwd: row.cwd,
    scopeKind: toScopeKind(row.scope_kind, row.id),
    scopeId: row.scope_id,
    pid: row.pid,
    exitCode: row.exit_code,
    error: row.error,
    agentSessionRef: row.agent_session_ref,
    title: row.title,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  }
}

function toScopeKind(value: string | null, sessionId: string): AgentScopeKind | null {
  if (value === null) {
    return null
  }
  if (!isAgentScopeKind(value)) {
    throw new Error(`agent session ${sessionId} has an unknown scope_kind: ${value}`)
  }
  return value
}
