import fs from "node:fs"
import type { AgentDefinition } from "@shared/types/AgentDefinition"
import type { AgentAvailability } from "@shared/types/AgentAvailability"
import type { AgentScope } from "@shared/types/AgentScope"
import type { AgentSession } from "@shared/types/AgentSession"
import type { AgentEvent } from "@shared/types/AgentSessionEvent"
import type {
  AgentEmbeddedLaunchRequest,
  AgentLaunchRequest,
  AgentPathResolution,
  AgentRosterEntry,
} from "@shared/types/AgentsBridge"
import type { McpClientConfig } from "@shared/types/McpClientConfig"
import { BUILTIN_AGENTS, DEFAULT_AGENT_KEY } from "@shared/agents/builtin-agents"
import { AgentDefinitionSchema } from "@shared/zod-schemas/AgentDefinitionSchema"
import { detectAgents } from "../agents/agent_detection"
import { resolveExecutable, spawnCommandFor } from "../agents/executable"
import { launchInExternalTerminal, NoTerminalFoundError } from "../agents/external_terminal"
import { renderMcpConfigArgs, writeAgentMcpConfig } from "../agents/mcp_config"
import type { PtyLauncher } from "../agents/pty_launcher"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { Action } from "../auth/permissions"
import { RESOURCE_AGENTS } from "../auth/permissions"
import { NotFoundError, ValidationError } from "../ipc/errors"
import type { AgentRepository, CollectionRepository, WorkflowRepository } from "../repositories"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"

/**
 * Detection shells out once per agent, so the roster is cached briefly. Short
 * enough that installing an agent and clicking back into Settings shows it,
 * long enough that opening the launch dropdown does not re-probe six binaries.
 * The explicit Refresh button bypasses it outright.
 *
 * Keyed by workspace rather than global, because the roster differs per
 * workspace: one slot would hand a second workspace the first one's rows, and
 * every agent only that workspace knows would fall into the default
 * "not-found" — a confident answer for a probe that never ran.
 */
const AVAILABILITY_TTL_MS = 30_000

/** Everything the service needs from Electron, injected so the service stays testable. */
export interface AgentEnvironment {
  /** Opens the OS directory picker in the main process. `null` when cancelled. */
  readonly pickDirectory: (options: { readonly title: string; readonly defaultPath?: string }) => Promise<string | null>
  /** Live MCP bridge config, or `null` when the bridge is not running. */
  readonly getMcpConfig: () => McpClientConfig | null
  /** APIWeave's own userData subdirectory for generated agent files. */
  readonly agentFilesDir: string
  /**
   * The PTY host, when there is one. Absent rather than required because the
   * external-terminal half of this feature predates it and still has to work
   * without it: if the native backend cannot load, every path except
   * `launchEmbedded` keeps working, which is the whole reason Phase 2 shipped
   * first.
   */
  readonly pty?: PtyLauncher
}

/**
 * A terminal that has not been laid out yet reports zero columns, and a PTY
 * created with a zero dimension throws inside ConPTY. Clamped rather than
 * rejected: the renderer resizes as soon as it has a layout, so the first
 * geometry only has to be sane.
 */
const MIN_TERMINAL_COLS = 2
const MIN_TERMINAL_ROWS = 1
const MAX_TERMINAL_DIMENSION = 1000

/**
 * Roster, per-project working directories, and launching.
 *
 * Note what this service never accepts: a path or a command. The renderer sends
 * a `workspaceId`, an `agentKey` and a scope; every path is either read from
 * `agent_local_paths` or supplied by the OS directory picker, and every argv is
 * built from the registry. That keeps the existing invariant — "no raw renderer
 * path is ever passed to shell or fs" — intact on a feature whose entire job is
 * arbitrary paths and arbitrary executables.
 */
export class AgentService {
  private availabilityCache = new Map<string, { readonly at: number; readonly items: readonly AgentAvailability[] }>()

  constructor(
    private readonly agents: AgentRepository,
    private readonly workflows: WorkflowRepository,
    private readonly collections: CollectionRepository,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
    private readonly environment: AgentEnvironment,
  ) {}

  // ── roster ──────────────────────────────────────────────────────────────

  async listRoster(workspaceId: string): Promise<readonly AgentRosterEntry[]> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_AGENTS)
    return this.buildRoster(workspaceId, false)
  }

  async refreshAvailability(workspaceId: string): Promise<readonly AgentRosterEntry[]> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_AGENTS)
    return this.buildRoster(workspaceId, true)
  }

  async saveCustomAgent(workspaceId: string, input: AgentDefinition): Promise<AgentRosterEntry> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "create", RESOURCE_AGENTS)
    const parsed = AgentDefinitionSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError("agent definition is not valid", parsed.error.issues)
    }
    const definition = parsed.data
    // A custom agent that shadows a built-in key would make the roster show two
    // rows claiming the same identity, and `launch` would have to guess.
    const isBuiltinKey = BUILTIN_AGENTS.some((agent) => agent.agentKey === definition.agentKey)
    const existing = this.agents.getDefinition(workspaceId, definition.agentKey)
    if (isBuiltinKey && existing === undefined) {
      throw new ValidationError(`${definition.agentKey} is a built-in agent — pick a different key`)
    }
    this.agents.upsertDefinition(workspaceId, { ...definition, isCustom: !isBuiltinKey })
    this.availabilityCache.delete(workspaceId)

    const roster = await this.buildRoster(workspaceId, true)
    const entry = roster.find((row) => row.definition.agentKey === definition.agentKey)
    if (entry === undefined) {
      throw new NotFoundError(`agent ${definition.agentKey} missing after save`)
    }
    return entry
  }

  async deleteCustomAgent(workspaceId: string, agentKey: string): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "delete", RESOURCE_AGENTS)
    const existing = this.agents.getDefinition(workspaceId, agentKey)
    if (existing === undefined) {
      throw new NotFoundError(`agent ${agentKey} not found`)
    }
    this.agents.deleteDefinition(workspaceId, agentKey)
    this.availabilityCache.delete(workspaceId)
  }

  async getDefaultAgentKey(workspaceId: string): Promise<string> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_AGENTS)
    return this.agents.getDefaultAgentKey(workspaceId) ?? DEFAULT_AGENT_KEY
  }

  async setDefaultAgentKey(workspaceId: string, agentKey: string): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_AGENTS)
    this.mustGetDefinition(workspaceId, agentKey)
    this.agents.setDefaultAgentKey(workspaceId, agentKey)
  }

  // ── local paths ─────────────────────────────────────────────────────────

  async resolveLocalPath(workspaceId: string, scope: AgentScope): Promise<AgentPathResolution> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_AGENTS)
    return this.resolvePathForScope(workspaceId, scope)
  }

  /**
   * The only way a filesystem path enters the system: the picker runs in the
   * main process, so the value comes from the OS rather than from the renderer.
   */
  async chooseLocalPath(workspaceId: string, scope: AgentScope): Promise<string | null> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_AGENTS)
    this.assertScopeInWorkspace(workspaceId, scope)
    const current = this.agents.getLocalPath(scope)
    const chosen = await this.environment.pickDirectory({
      title: scope.kind === "project" ? "Choose the project folder" : "Choose the folder for this workflow",
      ...(current === undefined ? {} : { defaultPath: current }),
    })
    if (chosen === null) {
      return null
    }
    this.agents.setLocalPath(scope, chosen)
    return chosen
  }

  async clearLocalPath(workspaceId: string, scope: AgentScope): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_AGENTS)
    this.assertScopeInWorkspace(workspaceId, scope)
    this.agents.deleteLocalPath(scope)
  }

  // ── sessions ────────────────────────────────────────────────────────────

  async listSessions(workspaceId: string): Promise<readonly AgentSession[]> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_AGENTS)
    return this.agents.listSessions(workspaceId)
  }

  /**
   * Launch the agent in the user's own terminal emulator.
   *
   * Recorded as a session even though nothing can be tracked afterwards: the
   * user still wants to see what they launched and where, and Phase 3's
   * embedded sessions land in the same list.
   */
  async launchExternal(request: AgentLaunchRequest): Promise<AgentSession> {
    const prepared = await this.prepareLaunch(request)
    const session = this.agents.createSession({
      workspaceId: request.workspaceId,
      agentKey: prepared.definition.agentKey,
      launchMode: "external",
      status: "starting",
      cwd: prepared.cwd,
      scopeKind: request.scope.kind,
      scopeId: request.scope.id,
    })

    try {
      await launchInExternalTerminal({
        executablePath: prepared.executablePath,
        args: prepared.args,
        cwd: prepared.cwd,
        env: prepared.env,
        scratchDir: this.environment.agentFilesDir,
      })
    } catch (error) {
      const message = error instanceof NoTerminalFoundError ? error.message : describeError(error)
      this.agents.updateSession(session.sessionId, { status: "failed", error: message })
      throw new ValidationError(message)
    }

    // An external terminal is fire-and-forget — there is no pid to watch and no
    // exit to wait for, so the session settles immediately rather than sitting
    // at "starting" for ever.
    return (
      this.agents.updateSession(session.sessionId, { status: "exited" }) ??
      { ...session, status: "exited" as const }
    )
  }

  /**
   * Launch the agent under a PTY that APIWeave owns.
   *
   * Everything up to the spawn is identical to {@link launchExternal} — same
   * folder resolution, same argv, same MCP wiring — which is deliberate: an
   * embedded session that behaved differently from an external one would make
   * the fallback a different product rather than the same one in another window.
   */
  async launchEmbedded(request: AgentEmbeddedLaunchRequest): Promise<AgentSession> {
    const pty = this.environment.pty
    if (pty === undefined) {
      throw new ValidationError("The embedded terminal is not available — launch in your own terminal instead")
    }
    const prepared = await this.prepareLaunch(request)
    // `.cmd`/`.bat` shims cannot be executed directly on Windows, in a PTY any
    // more than anywhere else. The same composition the external path uses.
    const command = spawnCommandFor(prepared.executablePath, prepared.args)

    const session = this.agents.createSession({
      workspaceId: request.workspaceId,
      agentKey: prepared.definition.agentKey,
      launchMode: "embedded",
      status: "starting",
      cwd: prepared.cwd,
      scopeKind: request.scope.kind,
      scopeId: request.scope.id,
    })

    try {
      const pid = await pty.start({
        sessionId: session.sessionId,
        file: command.file,
        args: command.args,
        cwd: prepared.cwd,
        env: prepared.env,
        cols: clampDimension(request.cols, MIN_TERMINAL_COLS),
        rows: clampDimension(request.rows, MIN_TERMINAL_ROWS),
      })
      return (
        this.agents.updateSession(session.sessionId, { status: "running", pid }) ??
        { ...session, status: "running" as const, pid }
      )
    } catch (error) {
      const message = describeError(error)
      this.agents.updateSession(session.sessionId, { status: "failed", error: message })
      throw new ValidationError(message)
    }
  }

  /** Keystrokes. Authorized as `run`: typing at an agent is driving a process. */
  async writeToSession(sessionId: string, data: string): Promise<void> {
    await this.mustAuthorizeSession(sessionId, "run")
    this.environment.pty?.write(sessionId, data)
  }

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.mustAuthorizeSession(sessionId, "run")
    this.environment.pty?.resize(
      sessionId,
      clampDimension(cols, MIN_TERMINAL_COLS),
      clampDimension(rows, MIN_TERMINAL_ROWS),
    )
  }

  /** Backpressure, driven by how fast the renderer's terminal can actually parse. */
  async setSessionPaused(sessionId: string, paused: boolean): Promise<void> {
    await this.mustAuthorizeSession(sessionId, "run")
    this.environment.pty?.setPaused(sessionId, paused)
  }

  /**
   * Stop a session on the user's say-so.
   *
   * The row is not marked terminal here. The kill produces a real exit from the
   * PTY host, and {@link recordProcessEvent} is the one place that writes it —
   * two writers for one transition is how a session ends up reporting an exit
   * code it never had.
   */
  async killSession(sessionId: string): Promise<AgentSession> {
    const session = await this.mustAuthorizeSession(sessionId, "run")
    this.environment.pty?.kill(sessionId)
    return session
  }

  /**
   * Authorize reading one session's output, and report whether the PTY host can
   * still serve it — a running process, or an exited one whose replay it
   * retains. Only the first is something to type into, which is why the split
   * stays `read`/`run` regardless of which side of this boolean a session is.
   *
   * `read` rather than `run`, which is the whole point of the split: a role that
   * may watch what an agent is doing does not thereby get to type into it.
   */
  async authorizeSessionRead(sessionId: string): Promise<{ readonly session: AgentSession; readonly attachable: boolean }> {
    const session = await this.mustAuthorizeSession(sessionId, "read")
    return { session, attachable: this.environment.pty?.canAttach(sessionId) ?? false }
  }

  /**
   * Persist what the PTY host reported. Called by the composition root, from the
   * broker's subscriber — never by the renderer, which is why it takes no
   * workspace and performs no authorization: the event is APIWeave's own
   * observation of a process it started, not a request.
   */
  recordProcessEvent(event: AgentEvent): void {
    switch (event.kind) {
      case "agent.started":
        this.agents.updateSession(event.sessionId, { status: "running", pid: event.pid })
        return
      case "agent.exited":
        this.agents.updateSession(event.sessionId, { status: "exited", exitCode: event.exitCode })
        return
      case "agent.failed":
        this.agents.updateSession(event.sessionId, { status: "failed", error: event.message })
    }
  }

  // ── internals ───────────────────────────────────────────────────────────

  /**
   * Everything both launch paths need, resolved and authorized once.
   *
   * Refuses rather than falling back when there is no folder or the folder has
   * gone: an agent started in whatever directory happened to be current would
   * read and edit files the user never pointed it at.
   */
  private async prepareLaunch(request: AgentLaunchRequest): Promise<PreparedLaunch> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, request.workspaceId, "run", RESOURCE_AGENTS)
    this.assertScopeInWorkspace(request.workspaceId, request.scope)

    const definition = this.mustGetDefinition(request.workspaceId, request.agentKey)
    const resolution = this.resolvePathForScope(request.workspaceId, request.scope)
    if (resolution.localPath === null) {
      throw new ValidationError("No local folder is set for this project — choose one before launching an agent")
    }
    const cwd = resolution.localPath
    if (!isDirectory(cwd)) {
      throw new ValidationError(`The configured folder no longer exists: ${cwd}`)
    }

    const executablePath = resolveExecutable(definition.detectCmd)
    if (executablePath === undefined) {
      throw new ValidationError(`${definition.detectCmd} was not found on PATH`)
    }

    return {
      definition,
      cwd,
      executablePath,
      args: [...definition.argv, ...this.mcpArgsFor(definition), ...promptArgsFor(definition, request.prompt)],
      env: this.launchEnvFor(request, definition),
    }
  }

  /**
   * Resolve a renderer-supplied session id to its row, then authorize the caller
   * against *that row's* workspace.
   *
   * The order is the point. Authorizing against a workspace the renderer names
   * would prove only that the caller may act on some workspace of their own, and
   * a session id is as renderer-controlled as a scope id was — the same hole
   * that made every path method reachable across workspaces. Missing rather than
   * denied for an id that does not exist, matching the existence-hiding the
   * scope resolver already established.
   */
  private async mustAuthorizeSession(sessionId: string, action: Action): Promise<AgentSession> {
    const session = this.agents.getSession(sessionId)
    if (session === undefined) {
      throw new NotFoundError(`agent session ${sessionId} not found`)
    }
    await authorizeWorkspace(this.scopeResolver, this.permissions, session.workspaceId, action, RESOURCE_AGENTS)
    return session
  }

  private async buildRoster(workspaceId: string, force: boolean): Promise<readonly AgentRosterEntry[]> {
    const definitions = this.effectiveDefinitions(workspaceId)
    const availability = await this.availabilityFor(workspaceId, definitions, force)
    const defaultKey = this.agents.getDefaultAgentKey(workspaceId) ?? DEFAULT_AGENT_KEY
    const stored = new Map(this.agents.listDefinitions(workspaceId).map((row) => [row.agentKey, row]))

    return definitions.map((definition) => ({
      definition,
      availability:
        availability.find((entry) => entry.agentKey === definition.agentKey) ??
        unknownAvailability(definition.agentKey),
      isCustom: stored.get(definition.agentKey)?.isCustom ?? false,
      isDefault: definition.agentKey === defaultKey,
    }))
  }

  /**
   * Built-ins, with a stored row of the same key replacing it. An override is a
   * full replacement rather than a merge, because a user who edits `detectCmd`
   * to point at a wrapper almost certainly wants their `argv` too.
   */
  private effectiveDefinitions(workspaceId: string): readonly AgentDefinition[] {
    const stored = this.agents.listDefinitions(workspaceId)
    const overrides = new Map(stored.map((row) => [row.agentKey, toDefinition(row)]))
    const builtins = BUILTIN_AGENTS.map((builtin) => overrides.get(builtin.agentKey) ?? builtin)
    const builtinKeys = new Set(BUILTIN_AGENTS.map((builtin) => builtin.agentKey))
    const customs = stored.filter((row) => !builtinKeys.has(row.agentKey)).map(toDefinition)
    return [...builtins, ...customs]
  }

  private async availabilityFor(
    workspaceId: string,
    definitions: readonly AgentDefinition[],
    force: boolean,
  ): Promise<readonly AgentAvailability[]> {
    const cached = this.availabilityCache.get(workspaceId)
    if (!force && cached !== undefined && Date.now() - cached.at < AVAILABILITY_TTL_MS) {
      return cached.items
    }
    const items = await detectAgents(definitions)
    this.availabilityCache.set(workspaceId, { at: Date.now(), items })
    return items
  }

  private mustGetDefinition(workspaceId: string, agentKey: string): AgentDefinition {
    const definition = this.effectiveDefinitions(workspaceId).find((entry) => entry.agentKey === agentKey)
    if (definition === undefined) {
      throw new NotFoundError(`agent ${agentKey} not found`)
    }
    return definition
  }

  /**
   * Workflow override first, then the project the workflow belongs to. The
   * two-level lookup is what makes monorepos work: the project maps to the
   * repository and a workflow may map to a sub-package inside it.
   */
  private resolvePathForScope(workspaceId: string, scope: AgentScope): AgentPathResolution {
    this.assertScopeInWorkspace(workspaceId, scope)

    const own = this.agents.getLocalPath(scope)
    if (own !== undefined) {
      return { localPath: own, source: scope.kind === "workflow" ? "workflow" : "project" }
    }
    if (scope.kind === "project") {
      return { localPath: null, source: "none" }
    }

    const collectionId = this.workflows.getByIdInWorkspace(scope.id, workspaceId)?.collectionId
    if (collectionId === undefined || collectionId === null) {
      return { localPath: null, source: "none" }
    }
    const inherited = this.agents.getLocalPath({ kind: "project", id: collectionId })
    return inherited === undefined ? { localPath: null, source: "none" } : { localPath: inherited, source: "project" }
  }

  /**
   * A scope id is renderer-controlled, so it is proved to belong to the
   * workspace the caller was authorized against before it is used as a key into
   * the path table — otherwise `{kind:"project", id:<someone else's>}` would
   * read, and overwrite, a path outside the authorized workspace.
   */
  private assertScopeInWorkspace(workspaceId: string, scope: AgentScope): void {
    if (scope.kind === "workflow") {
      if (this.workflows.getByIdInWorkspace(scope.id, workspaceId) === undefined) {
        throw new NotFoundError(`workflow ${scope.id} not found`)
      }
      return
    }
    const collection = this.collections.getById(scope.id)
    if (collection === undefined || collection.workspaceId !== workspaceId) {
      throw new NotFoundError(`project ${scope.id} not found`)
    }
  }

  /**
   * Hand the agent APIWeave's own MCP bridge, so it can read the workflow, run
   * it, and ask for a diagnosis without the user editing a config file first.
   *
   * Silently skipped when the bridge is off or the agent does not take the
   * flags — a launch that works without MCP beats an error that blocks it.
   */
  private mcpArgsFor(definition: AgentDefinition): readonly string[] {
    if (definition.mcpConfigArgs.length === 0) {
      return []
    }
    const config = this.environment.getMcpConfig()
    if (config === null) {
      return []
    }
    const configPath = writeAgentMcpConfig(this.environment.agentFilesDir, config)
    return renderMcpConfigArgs(definition.mcpConfigArgs, configPath)
  }

  /**
   * The environment the launch hands the child: the definition's own configured
   * variables, plus which workflow the session is about — read by MCP tools and
   * by the agent itself.
   *
   * The definition's env goes in first and the APIWEAVE_* variables after it,
   * so the app-owned keys always win: they name the session's identity, and a
   * custom agent reusing one must not be able to spoof it.
   */
  private launchEnvFor(request: AgentLaunchRequest, definition: AgentDefinition): Record<string, string> {
    const env: Record<string, string> = { ...definition.env }
    env["APIWEAVE_WORKSPACE_ID"] = request.workspaceId
    if (request.scope.kind === "workflow") {
      env["APIWEAVE_WORKFLOW_ID"] = request.scope.id
    } else {
      env["APIWEAVE_PROJECT_ID"] = request.scope.id
    }
    return env
  }
}

/** The resolved, authorized launch — shared by the external and embedded paths. */
interface PreparedLaunch {
  readonly definition: AgentDefinition
  readonly cwd: string
  readonly executablePath: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

function clampDimension(value: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return minimum
  }
  return Math.min(MAX_TERMINAL_DIMENSION, Math.max(minimum, Math.floor(value)))
}

function toDefinition(stored: AgentDefinition): AgentDefinition {
  return {
    agentKey: stored.agentKey,
    name: stored.name,
    detectCmd: stored.detectCmd,
    argv: stored.argv,
    expectedProcess: stored.expectedProcess ?? null,
    env: stored.env,
    promptMode: stored.promptMode,
    promptFlag: stored.promptFlag ?? null,
    mcpConfigArgs: stored.mcpConfigArgs,
    unsupportedPlatforms: stored.unsupportedPlatforms,
    installUrl: stored.installUrl ?? null,
  }
}

function promptArgsFor(definition: AgentDefinition, prompt: string | undefined): readonly string[] {
  if (prompt === undefined || prompt.length === 0) {
    return []
  }
  switch (definition.promptMode) {
    case "argv":
      return [prompt]
    case "flag":
      return definition.promptFlag === null || definition.promptFlag === undefined
        ? []
        : [definition.promptFlag, prompt]
    // `stdin` is typed into a live PTY, which an external terminal does not
    // give us a handle on; `none` has nowhere to put it either.
    case "stdin":
    case "none":
      return []
  }
}

function unknownAvailability(agentKey: string): AgentAvailability {
  return { agentKey, state: "not-found", resolvedPath: null, detail: null, checkedAt: Date.now() }
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
