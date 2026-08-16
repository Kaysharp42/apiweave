import type { KVStore, SqliteRow } from "../db"
import type { AgentDefinition, StoredAgentDefinition } from "@shared/types/AgentDefinition"
import type { AgentScope, AgentScopeKind } from "@shared/types/AgentScope"
import type { AgentSession, AgentSessionStatus } from "@shared/types/AgentSession"
import { generateId } from "../id"
import { mustExist, parseJson, toJson } from "./helpers"

export type AgentDefinitionUpsert = AgentDefinition & { readonly isCustom?: boolean }

export type AgentSessionCreate = Pick<AgentSession, "workspaceId" | "agentKey" | "launchMode" | "status" | "cwd"> &
  Partial<Pick<AgentSession, "scopeKind" | "scopeId" | "pid">>

export type AgentSessionUpdate = Partial<Pick<AgentSession, "status" | "pid" | "exitCode" | "error">>

const DEFINITION_COLUMNS =
  "id, workspace_id, agent_key, name, detect_cmd, argv_json, expected_process, env_json, options_json, is_custom, rev, createdAt, updatedAt"

/** The behavioural half of a definition — see `options_json` in migration 015. */
type AgentDefinitionOptions = Pick<
  AgentDefinition,
  "promptMode" | "promptFlag" | "mcpConfigArgs" | "unsupportedPlatforms" | "installUrl"
>

const SESSION_COLUMNS =
  "id, workspace_id, agent_key, launch_mode, status, cwd, scope_kind, scope_id, pid, exit_code, error, startedAt, endedAt"

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
          unsupportedPlatforms: input.unsupportedPlatforms,
          installUrl: input.installUrl ?? null,
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
      `INSERT INTO agent_sessions (id, workspace_id, agent_key, launch_mode, status, cwd, scope_kind, scope_id, pid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    )
    return mustExist(this.getSession(id), `agent session ${id} missing after insert`)
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
   */
  // fallow-ignore-next-line complexity -- the branches preserve untouched patch fields and stamp endedAt only on terminal statuses; the CRAP score is the estimated-coverage artifact for a method exercised through agent_service.test.ts
  public updateSession(sessionId: string, patch: AgentSessionUpdate): AgentSession | undefined {
    const existing = this.getSession(sessionId)
    if (existing === undefined) {
      return undefined
    }
    const status = patch.status ?? existing.status
    const isTerminal = status === "exited" || status === "failed"
    this.store.set(
      `UPDATE agent_sessions
         SET status = ?, pid = ?, exit_code = ?, error = ?, endedAt = ?
       WHERE id = ?`,
      [
        status,
        patch.pid === undefined ? (existing.pid ?? null) : patch.pid,
        patch.exitCode === undefined ? (existing.exitCode ?? null) : patch.exitCode,
        patch.error === undefined ? (existing.error ?? null) : patch.error,
        isTerminal ? (existing.endedAt ?? nowIso()) : null,
        sessionId,
      ],
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

function nowIso(): string {
  return new Date().toISOString().replace(/(\.\d{3})Z$/, "$1Z")
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
    unsupportedPlatforms: options.unsupportedPlatforms ?? [],
    installUrl: options.installUrl ?? null,
    isCustom: row.is_custom === 1,
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function rowToSession(row: AgentSessionRow): AgentSession {
  return {
    sessionId: row.id,
    workspaceId: row.workspace_id,
    agentKey: row.agent_key,
    launchMode: row.launch_mode as AgentSession["launchMode"],
    status: row.status as AgentSessionStatus,
    cwd: row.cwd,
    scopeKind: row.scope_kind as AgentScopeKind | null,
    scopeId: row.scope_id,
    pid: row.pid,
    exitCode: row.exit_code,
    error: row.error,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  }
}
