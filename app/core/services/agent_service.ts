import { randomUUID } from "node:crypto"
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
import {
  deleteLauncherScript,
  launchInExternalTerminal,
  NoTerminalFoundError,
  sweepLauncherScripts,
} from "../agents/external_terminal"
import { deleteAgentMcpConfig, renderMcpConfigArgs, sweepAgentMcpConfigs, writeAgentMcpConfig } from "../agents/mcp_config"
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

  /**
   * The startup sweep runs once, and it has to run before this process writes
   * any scratch file of its own — everything in that directory at that point
   * belongs to a run that is already over. See {@link sweepScratchFiles}.
   */
  private sweptScratch = false

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
    // A stored row with `isCustom: false` is an *override* of a built-in, not a
    // user-created agent, and deleting it silently reverts the user's edited
    // `detectCmd`/`argv` to the shipped definition. The roster hides the button
    // for these, but the handler behind it is reachable regardless of what the
    // UI chose to render — a check in the renderer is a hint, not a rule.
    if (!existing.isCustom) {
      throw new ValidationError(`${agentKey} is a built-in agent — edit its override instead of deleting it`)
    }
    this.agents.deleteDefinition(workspaceId, agentKey)
    // The default is a loose `app_settings` key with no FK to the row it names,
    // so deleting the agent it points at leaves the roster with no default
    // marked at all and `getDefaultAgentKey` reporting a key nothing can launch.
    if (this.agents.getDefaultAgentKey(workspaceId) === agentKey) {
      this.agents.clearDefaultAgentKey(workspaceId)
    }
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
    // Refused rather than dropped. `stdin` means "type the prompt into the live
    // terminal once the agent is up", and an external launch hands the process
    // to an emulator APIWeave has no handle on — there is no stdin to write to.
    // Launching anyway would open an agent that silently never received the
    // question the user asked, which reads as the agent ignoring them.
    if (prepared.stdinPrompt !== null) {
      throw new ValidationError(
        `${prepared.definition.name} takes its prompt on stdin, which only the embedded terminal can supply — launch it embedded, or launch it externally without a prompt`,
      )
    }
    // An external session gets an identity too, for the agents that accept one.
    // APIWeave never sees a byte of its output — the emulator forked and took
    // it — so `scan` can never work here, but `assign` does: the id was minted
    // before the process started, so a conversation handed to the user's own
    // terminal can still be picked back up in the dock afterwards.
    const identity = this.sessionIdentityFor(prepared.definition)
    const session = this.agents.createSession({
      workspaceId: request.workspaceId,
      agentKey: prepared.definition.agentKey,
      launchMode: "external",
      status: "starting",
      cwd: prepared.cwd,
      scopeKind: request.scope.kind,
      scopeId: request.scope.id,
      agentSessionRef: identity.ref,
    })

    try {
      await launchInExternalTerminal({
        executablePath: prepared.executablePath,
        args: this.argsFor(prepared, session.sessionId, identity.args),
        cwd: prepared.cwd,
        env: prepared.env,
        scratchDir: this.environment.agentFilesDir,
        sessionId: session.sessionId,
      })
    } catch (error) {
      const message = error instanceof NoTerminalFoundError ? error.message : describeError(error)
      this.agents.updateSession(session.sessionId, { status: "failed", error: message })
      // Nothing was handed to a terminal, so both scratch files can go now —
      // unlike the success path below, where the agent is still using them.
      this.discardSessionScratch(session.sessionId)
      throw new ValidationError(message)
    }

    // An external terminal is fire-and-forget — there is no pid to watch and no
    // exit to wait for, so the session settles immediately rather than sitting
    // at "starting" for ever.
    //
    // Deliberately *not* cleaned up here: the agent this session handed off is
    // still running in the user's terminal and still reading the MCP config
    // file, however terminal the row now looks. Its scratch is reclaimed by the
    // startup sweep, and the launcher script by its own short TTL.
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
    const identity = this.sessionIdentityFor(prepared.definition)

    const session = this.agents.createSession({
      workspaceId: request.workspaceId,
      agentKey: prepared.definition.agentKey,
      launchMode: "embedded",
      status: "starting",
      cwd: prepared.cwd,
      scopeKind: request.scope.kind,
      scopeId: request.scope.id,
      // Written at insert, not after the spawn. A launch that fails — a missing
      // binary, a folder that vanished — still leaves a row that knows which
      // conversation it was for, which is exactly the row a user retries from.
      agentSessionRef: identity.ref,
    })
    // `.cmd`/`.bat` shims cannot be executed directly on Windows, in a PTY any
    // more than anywhere else. The same composition the external path uses.
    // Built after the row exists because the MCP config file is named for the
    // session, which is what gives it an owner that can delete it.
    const command = spawnCommandFor(
      prepared.executablePath,
      this.argsFor(prepared, session.sessionId, identity.args),
    )

    try {
      const pid = await pty.start({
        sessionId: session.sessionId,
        file: command.file,
        args: command.args,
        cwd: prepared.cwd,
        env: prepared.env,
        cols: clampDimension(request.cols, MIN_TERMINAL_COLS),
        rows: clampDimension(request.rows, MIN_TERMINAL_ROWS),
        // Only for an agent that mints its own id and has somewhere to put it.
        // Null everywhere else, which is what stops the host scanning output it
        // has no question to ask of.
        sessionIdPattern: this.scanPatternFor(prepared.definition, identity.ref),
      })
      // The `stdin` prompt mode, finally implemented. It cannot be an argv
      // entry — that is what `argv`/`flag` are for — so the only place it can
      // go is the PTY, and only once there is a PTY to write to. The trailing
      // newline is the submit: without it the prompt sits on the agent's input
      // line waiting for a keypress nobody will send.
      if (prepared.stdinPrompt !== null) {
        pty.write(session.sessionId, `${prepared.stdinPrompt}\n`)
      }
      return (
        this.agents.updateSession(session.sessionId, { status: "running", pid }) ??
        { ...session, status: "running" as const, pid }
      )
    } catch (error) {
      const message = describeError(error)
      this.agents.updateSession(session.sessionId, { status: "failed", error: message })
      this.discardSessionScratch(session.sessionId)
      throw new ValidationError(message)
    }
  }

  /**
   * Run a finished session's conversation again, in the row it is already in.
   *
   * The row is the conversation, not the process. An earlier version of this
   * created a second row per resume — defensible on the grounds that each row
   * recorded one run, and wrong in practice: resuming the same agent three times
   * left three near-identical rows in a list that has no way to show which was
   * which, and the user is looking for the *conversation* they were having, not
   * an audit trail of the processes that hosted it.
   *
   * So the previous run's outcome is overwritten. What survives is what
   * identifies the conversation — `agentSessionRef`, the title, the folder, the
   * scope — and the row goes back to `starting` before the spawn, which is also
   * what lets the ordinary launch machinery record the outcome: `updateSession`
   * pins terminal statuses, so a row left at `exited` could not be moved to
   * `running` by the success path nor to `failed` by the error path.
   *
   * The renderer passes the id of a *row*, never a ref. Resolving the ref here
   * keeps the launch path's rule intact — the renderer sends identifiers, main
   * decides what they mean — so a caller cannot ask APIWeave to hand an
   * arbitrary string to a CLI as its session id.
   */
  async resumeSession(sessionId: string, cols: number, rows: number): Promise<AgentSession> {
    const pty = this.environment.pty
    if (pty === undefined) {
      throw new ValidationError("The embedded terminal is not available — launch in your own terminal instead")
    }
    // `run`, not `read`: this starts a process. A role that may watch an agent
    // does not thereby get to launch one.
    const previous = await this.mustAuthorizeSession(sessionId, "run")
    const ref = previous.agentSessionRef ?? null
    if (ref === null) {
      throw new ValidationError("This session cannot be resumed — no conversation id was recorded for it")
    }
    if (previous.status === "starting" || previous.status === "running") {
      // Two processes on one conversation both write to its history, and the
      // agent's own store is not built for that.
      throw new ValidationError("This session is still running")
    }
    if (
      previous.scopeKind === null ||
      previous.scopeKind === undefined ||
      previous.scopeId === null ||
      previous.scopeId === undefined
    ) {
      throw new ValidationError("This session cannot be resumed — it was not launched against a project or workflow")
    }
    const definition = this.mustGetDefinition(previous.workspaceId, previous.agentKey)
    if (definition.resumeArgs.length === 0) {
      throw new ValidationError(`${definition.name} does not support resuming a session`)
    }

    const prepared = await this.prepareLaunch({
      workspaceId: previous.workspaceId,
      agentKey: previous.agentKey,
      scope: { kind: previous.scopeKind, id: previous.scopeId },
    })
    const command = spawnCommandFor(
      prepared.executablePath,
      this.argsFor(prepared, sessionId, fillTemplate(definition.resumeArgs, ref)),
    )
    // Cleared before the spawn, not after it: everything below reports through
    // `updateSession`, which will not move a row out of a terminal status.
    const revived = this.agents.reviveSession(sessionId) ?? previous

    try {
      const pid = await pty.start({
        sessionId,
        file: command.file,
        args: command.args,
        cwd: prepared.cwd,
        env: prepared.env,
        cols: clampDimension(cols, MIN_TERMINAL_COLS),
        rows: clampDimension(rows, MIN_TERMINAL_ROWS),
        // Nothing to look for — the id is the one being handed back.
        sessionIdPattern: null,
      })
      return (
        this.agents.updateSession(sessionId, { status: "running", pid }) ??
        { ...revived, status: "running" as const, pid }
      )
    } catch (error) {
      const message = describeError(error)
      this.agents.updateSession(sessionId, { status: "failed", error: message })
      this.discardSessionScratch(sessionId)
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
    // An external session has nothing here to kill. The pid APIWeave spawned was
    // the emulator's, it was never recorded, and the PTY host has no entry for a
    // session it did not start — so `pty.kill` matched nothing and returned, and
    // the caller was told the agent had been stopped while it kept running. A
    // refusal that says where the agent actually is beats a successful no-op.
    if (session.launchMode === "external") {
      throw new ValidationError(
        "This agent is running in your own terminal window — close that window to stop it",
      )
    }
    this.environment.pty?.kill(sessionId)
    return session
  }

  /**
   * Forget a session row, and the scratch files named after it.
   *
   * Refused while the session is live rather than killing it first: removing the
   * row of a running process orphans that process — nothing would be left to
   * attach to it, stop it, or record its exit — so stopping is the user's
   * explicit second decision, not a side effect of tidying a list.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.mustAuthorizeSession(sessionId, "delete")
    if (session.status === "starting" || session.status === "running") {
      throw new ValidationError("stop the session before removing it")
    }
    this.agents.deleteSession(sessionId)
    // Not for an external session, whose row says `exited` from the instant the
    // emulator was spawned — the agent it handed off is very likely still
    // running in the user's own terminal, still holding the MCP config this
    // would unlink. Removing the row is the user asking to tidy a list, and it
    // must not reach into a live process to do it. The startup sweep reclaims
    // the file, which is what `launchExternal` already relies on.
    if (session.launchMode !== "external") {
      this.discardSessionScratch(sessionId)
    }
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
    // Nothing to persist, and deliberately so: `agent.activity` describes what
    // the process is doing right now, not what happened to it. Writing it would
    // touch the session table on every burst of output an agent produces, to
    // store a flag that is meaningless the moment this app run ends.
    if (event.kind === "agent.activity") return
    // Handled *before* the terminal guard below, which the status transitions
    // need and these two must not be subject to. An agent that mints its own
    // session id prints it as it exits, so its ref lands on a row that is
    // already `exited` — the guard would drop the one fact that makes that row
    // resumable. Neither field is status, so writing them past the end cannot
    // resurrect anything; `updateSession` pins the status independently.
    if (event.kind === "agent.sessionRef") {
      this.recordSessionRef(event.sessionId, event.ref)
      return
    }
    if (event.kind === "agent.title") {
      this.agents.updateSession(event.sessionId, { title: event.title })
      return
    }
    const session = this.agents.getSession(event.sessionId)
    // `exited` and `failed` are the end of a row's life. The host can still emit
    // after one — a `agent.failed` for the whole host as it tears down arrives
    // after each child's own `agent.exited`, and a respawned host re-announces
    // ids it remembers — and any of those would otherwise overwrite a real exit
    // code with a generic message, or move a dead session back to `running`.
    // The repository pins the status too; this stops the row being rewritten at
    // all, so `error` and `exitCode` survive as well.
    if (session === undefined || session.status === "exited" || session.status === "failed") {
      return
    }
    switch (event.kind) {
      case "agent.started":
        this.agents.updateSession(event.sessionId, { status: "running", pid: event.pid })
        return
      case "agent.exited":
        this.agents.updateSession(event.sessionId, { status: "exited", exitCode: event.exitCode })
        this.discardSessionScratch(event.sessionId)
        return
      case "agent.failed":
        this.agents.updateSession(event.sessionId, { status: "failed", error: event.message })
        this.discardSessionScratch(event.sessionId)
    }
  }

  /**
   * Record the agent's own session id, once.
   *
   * Refuses to overwrite a ref the row already has, which matters for both ways
   * one arrives. A resumed session is created carrying the ref it is continuing,
   * and the agent will print that same id again — harmless. But an agent asked
   * about its own history will also print *other* sessions' ids, and the host
   * only stops scanning once it has reported a match, so first-write-wins is
   * what keeps a row pointing at its own conversation rather than at whichever
   * id its agent happened to mention last.
   */
  private recordSessionRef(sessionId: string, ref: string): void {
    const session = this.agents.getSession(sessionId)
    if (session === undefined || (session.agentSessionRef ?? null) !== null) {
      return
    }
    this.agents.updateSession(sessionId, { agentSessionRef: ref })
  }

  /**
   * Reclaim scratch files left behind by a previous run of the app.
   *
   * Both kinds hold a secret. The MCP config carries a bearer token good for
   * every whitelisted MCP tool; the POSIX launcher script carries an `export`
   * line for every variable in the agent's definition, which is where a user
   * puts an API key. Neither has an owner once the process that wrote it is
   * gone, so a crash or a hard quit used to leave them in userData for ever.
   *
   * Safe to call only before this run has written any of its own, which is why
   * it is idempotent and why the launch path calls it through
   * {@link ensureScratchSwept} rather than repeating it: a second sweep would
   * delete the config of a session that is currently running.
   */
  sweepScratchFiles(): number {
    this.sweptScratch = true
    const directory = this.environment.agentFilesDir
    return sweepAgentMcpConfigs(directory) + sweepLauncherScripts(directory)
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
    this.ensureScratchSwept()

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
      promptArgs: promptArgsFor(definition, request.prompt),
      stdinPrompt: stdinPromptFor(definition, request.prompt),
      env: this.launchEnvFor(request, definition),
    }
  }

  /**
   * The final argv, once there is a session id to name the MCP config after.
   *
   * MCP args go *before* the prompt args and not simply on the end: with
   * `promptMode: "argv"` the prompt is a positional, and every CLI in the roster
   * expects positionals last. Splicing the flags after one would make the prompt
   * look like the flag's value.
   */
  private argsFor(
    prepared: PreparedLaunch,
    sessionId: string,
    sessionArgs: readonly string[] = [],
  ): readonly string[] {
    return [
      ...prepared.definition.argv,
      // Immediately after the base argv, ahead of everything else, because for
      // some CLIs resuming is a *subcommand* rather than a flag
      // (`codex resume <id>`) and a subcommand has to be the first word. Flags
      // do not care where they sit; subcommands do, so the stricter position is
      // the one that works for both.
      ...sessionArgs,
      ...this.mcpArgsFor(prepared.definition, sessionId),
      ...prepared.promptArgs,
    ]
  }

  /**
   * The pattern the host should watch this session's output for, or null.
   *
   * Null once the ref is already known — a resumed session, or an `assign`
   * agent — because there is nothing left to find, and scanning anyway would
   * mean watching every byte of a long session to learn something already on
   * the row. Also null for an agent that cannot resume at all: there is no point
   * capturing an id nothing will ever use.
   */
  private scanPatternFor(definition: AgentDefinition, ref: string | null): string | null {
    if (ref !== null || definition.sessionIdMode !== "scan" || definition.resumeArgs.length === 0) {
      return null
    }
    return definition.sessionIdPattern ?? null
  }

  /**
   * How a *new* launch names its conversation to the agent — the id to store on
   * the row, and the argv that carries it. Resuming composes its own argv from
   * `resumeArgs` and the ref already on the row; see {@link resumeSession}.
   *
   * Two cases, and the split is the whole reason `sessionIdMode` exists: an
   * agent that accepts an id is given one now, so the row is resumable before
   * the process has printed a byte; an agent that mints its own is given nothing
   * and watched instead. An agent with no session concept gets neither.
   */
  private sessionIdentityFor(definition: AgentDefinition): SessionIdentity {
    // The `newSessionArgs` check is not redundant with the mode. Definitions are
    // user-editable, and one that claims `assign` while naming no flag to assign
    // *with* would otherwise store a ref the agent was never told about — a row
    // that offers Resume and reopens a conversation that does not exist.
    if (definition.sessionIdMode === "assign" && definition.newSessionArgs.length > 0) {
      // A UUID rather than this codebase's ULID: Claude Code's `--session-id`
      // documents "must be a valid UUID" and rejects anything else, and no agent
      // is served worse by one.
      const ref = randomUUID()
      return { ref, args: fillTemplate(definition.newSessionArgs, ref) }
    }
    return { ref: null, args: [] }
  }

  /**
   * Both scratch files a session owns, dropped together.
   *
   * Best-effort and silent: every caller is a terminal transition that has
   * already been persisted, and a session must not fail to end because a file
   * was already gone or is held open by a Windows virus scanner. Anything left
   * is reclaimed by {@link sweepScratchFiles} on the next start.
   */
  private discardSessionScratch(sessionId: string): void {
    deleteAgentMcpConfig(this.environment.agentFilesDir, sessionId)
    deleteLauncherScript(this.environment.agentFilesDir, sessionId)
  }

  /**
   * The composition root is expected to call {@link sweepScratchFiles} at
   * startup, next to `markOrphanedSessionsFailed`. This is the belt to that
   * braces: a build that forgets the wiring still reclaims stale tokens before
   * it adds another, and the flag guarantees it happens at most once — after
   * this run has written a config, a sweep would delete a live session's.
   */
  private ensureScratchSwept(): void {
    if (this.sweptScratch) {
      return
    }
    this.sweepScratchFiles()
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

  /**
   * A cache hit is only a hit for the agents that were actually in it.
   *
   * The cache is invalidated on save and delete, but those are not the only ways
   * the definition list changes: a built-in row added by an app update, a
   * workspace switched underneath a warm entry, an override written straight
   * through the repository. Any definition missing from the cached probe used to
   * fall through to a hardcoded `not-found`, which told the user an agent they
   * have installed is not installed — a confident answer for a probe that never
   * ran. Probing just the misses keeps the TTL doing its job (opening the launch
   * dropdown does not re-probe six binaries) while making every row in the
   * result a measured one.
   */
  private async availabilityFor(
    workspaceId: string,
    definitions: readonly AgentDefinition[],
    force: boolean,
  ): Promise<readonly AgentAvailability[]> {
    const cached = this.availabilityCache.get(workspaceId)
    if (force || cached === undefined || Date.now() - cached.at >= AVAILABILITY_TTL_MS) {
      const items = await detectAgents(definitions)
      this.availabilityCache.set(workspaceId, { at: Date.now(), items })
      return items
    }
    const probed = new Set(cached.items.map((entry) => entry.agentKey))
    const missing = definitions.filter((definition) => !probed.has(definition.agentKey))
    if (missing.length === 0) {
      return cached.items
    }
    const fresh = await detectAgents(missing)
    // Re-read before publishing. A probe can sit here for seconds per agent, and
    // an explicit Refresh — or the invalidation a save or delete performs — can
    // land inside that window. Writing the pre-await snapshot back would undo
    // the user's refresh and restore rows for a definition they just deleted,
    // with the stale entry then serving the TTL out. Identity, not timestamp:
    // an invalidation removes the entry entirely.
    const current = this.availabilityCache.get(workspaceId)
    if (current !== cached) {
      const have = new Set((current?.items ?? []).map((entry) => entry.agentKey))
      return [...(current?.items ?? []), ...fresh.filter((entry) => !have.has(entry.agentKey))]
    }
    // The cache keeps its original timestamp: the newly probed rows are merged
    // in, not treated as a refresh of the ones that were already there, so the
    // TTL still expires when the oldest measurement does.
    const items = [...cached.items, ...fresh]
    this.availabilityCache.set(workspaceId, { at: cached.at, items })
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
  private mcpArgsFor(definition: AgentDefinition, sessionId: string): readonly string[] {
    if (definition.mcpConfigArgs.length === 0) {
      return []
    }
    const config = this.environment.getMcpConfig()
    if (config === null) {
      return []
    }
    // One file per session. A single shared `apiweave.json` meant two
    // simultaneous launches raced on one path — the second overwrote the token
    // the first had already been handed — and left a live bearer token on disk
    // with no owner to delete it.
    const configPath = writeAgentMcpConfig(this.environment.agentFilesDir, config, sessionId)
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

/**
 * The resolved, authorized launch — shared by the external and embedded paths.
 *
 * Note that it carries argv *fragments* rather than the finished argv: the MCP
 * config file is named for the session, and the session row does not exist until
 * after everything here has been resolved and validated. `AgentService.argsFor`
 * assembles the three pieces once there is an id.
 */
/** What a launch calls its conversation: the id to store, and the argv carrying it. */
interface SessionIdentity {
  readonly ref: string | null
  readonly args: readonly string[]
}

/** Substitute the session id into a definition's argv template. */
function fillTemplate(template: readonly string[], id: string): readonly string[] {
  return template.map((part) => part.replaceAll("{id}", id))
}

interface PreparedLaunch {
  readonly definition: AgentDefinition
  readonly cwd: string
  readonly executablePath: string
  /** The prompt as argv, when the agent's mode puts it there. Always last. */
  readonly promptArgs: readonly string[]
  /** The prompt to type into the PTY, for `promptMode: "stdin"`. */
  readonly stdinPrompt: string | null
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
    // This function is an explicit field list rather than a spread, which is
    // what keeps a stored row's extra columns out of a definition — and is also
    // how a field added to `AgentDefinition` gets silently dropped on the way
    // out of the database. These four are how a session is resumed, so dropping
    // them left every stored agent unable to resume while the shipped roster
    // could, which is the kind of difference that looks like a database bug.
    sessionIdMode: stored.sessionIdMode,
    newSessionArgs: stored.newSessionArgs,
    resumeArgs: stored.resumeArgs,
    sessionIdPattern: stored.sessionIdPattern ?? null,
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
    // `stdin` is typed into the PTY after the spawn — see `stdinPromptFor` and
    // `launchEmbedded`; `none` has nowhere to put it at all.
    case "stdin":
    case "none":
      return []
  }
}

/**
 * The prompt only when it is going to be typed, so the two launch paths can each
 * decide what that means: the embedded one writes it into the PTY, the external
 * one refuses the launch rather than dropping it.
 */
function stdinPromptFor(definition: AgentDefinition, prompt: string | undefined): string | null {
  if (definition.promptMode !== "stdin" || prompt === undefined || prompt.length === 0) {
    return null
  }
  return prompt
}

/**
 * Structural fallback only. `availabilityFor` now probes any definition the
 * cached roster does not cover, so every row comes back measured — this exists
 * because `find` returns `undefined` in the type system, not because a real
 * roster can reach it. The detail says so rather than claiming the binary was
 * looked for and missing.
 */
function unknownAvailability(agentKey: string): AgentAvailability {
  return {
    agentKey,
    state: "not-found",
    resolvedPath: null,
    detail: "Availability has not been checked yet — use Refresh",
    checkedAt: Date.now(),
  }
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
