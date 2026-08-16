import type { AgentAvailability } from "./AgentAvailability"
import type { AgentDefinition } from "./AgentDefinition"
import type { AgentScope, AgentScopeKind } from "./AgentScope"
import type { AgentSession } from "./AgentSession"
import type { AgentSessionEvent } from "./AgentSessionEvent"

/** One row of the roster UI: what the agent is, and whether it actually works here. */
export interface AgentRosterEntry {
  readonly definition: AgentDefinition
  readonly availability: AgentAvailability
  /** User-defined, so it can be edited and deleted. Built-ins can only be overridden. */
  readonly isCustom: boolean
  readonly isDefault: boolean
}

export interface AgentLocalPathEntry {
  readonly scopeKind: AgentScopeKind
  readonly scopeId: string
  readonly localPath: string
}

/**
 * The effective working directory for a scope, and which level it came from —
 * the UI needs the source to say "inherited from the project" rather than
 * pretending the workflow has its own path.
 */
export interface AgentPathResolution {
  readonly localPath: string | null
  readonly source: "workflow" | "project" | "none"
}

/**
 * Everything the renderer may say about a launch. Note what is *absent*: no
 * path, no command, no argv. The renderer sends identifiers; main resolves them
 * against the local-path table and the agent registry. A path only ever enters
 * the system through the OS directory picker, which main opens itself.
 */
export interface AgentLaunchRequest {
  readonly workspaceId: string
  readonly agentKey: string
  readonly scope: AgentScope
  /** Opening prompt, injected per the agent's `promptMode`. */
  readonly prompt?: string
}

/**
 * An embedded launch adds the one thing the renderer legitimately knows better
 * than main does: how big the terminal is. Nothing else moves — the cwd, the
 * argv and the MCP wiring are resolved exactly as they are for an external
 * launch, because Phase 3 changed only *where* the process runs.
 */
export interface AgentEmbeddedLaunchRequest extends AgentLaunchRequest {
  readonly cols: number
  readonly rows: number
}

/**
 * The `window.__APIWEAVE_AGENTS__` contract, declared once because both ends of
 * it are real code — preload builds the object and the renderer's client reads
 * it. `UpdatesBridge` is the precedent; declaring the shape twice is what let
 * that one drift.
 *
 * This bridge is deliberately NOT on the IPC router. The router is also the MCP
 * bridge's handler list, so anything registered there is one whitelist entry
 * from being callable by a local agent over loopback HTTP. For workflow reads
 * that is the feature; for process spawning it would turn "an agent can drive
 * APIWeave" into "an agent can execute arbitrary code with an arbitrary working
 * directory". `main.ts` already bypasses the router for `mcp:*` and `updates:*`
 * for the same reason.
 */
export interface AgentsBridge {
  readonly listRoster: (workspaceId: string) => Promise<readonly AgentRosterEntry[]>
  readonly refreshAvailability: (workspaceId: string) => Promise<readonly AgentRosterEntry[]>
  readonly saveCustomAgent: (workspaceId: string, definition: AgentDefinition) => Promise<AgentRosterEntry>
  readonly deleteCustomAgent: (workspaceId: string, agentKey: string) => Promise<void>
  readonly getDefaultAgentKey: (workspaceId: string) => Promise<string>
  readonly setDefaultAgentKey: (workspaceId: string, agentKey: string) => Promise<void>
  readonly resolveLocalPath: (workspaceId: string, scope: AgentScope) => Promise<AgentPathResolution>
  /** Opens the OS directory picker in main and stores the result. Resolves `null` if cancelled. */
  readonly chooseLocalPath: (workspaceId: string, scope: AgentScope) => Promise<string | null>
  readonly clearLocalPath: (workspaceId: string, scope: AgentScope) => Promise<void>
  readonly listSessions: (workspaceId: string) => Promise<readonly AgentSession[]>
  readonly launchExternal: (request: AgentLaunchRequest) => Promise<AgentSession>
  readonly launchEmbedded: (request: AgentEmbeddedLaunchRequest) => Promise<AgentSession>
  /**
   * Run a finished session's conversation again, in the row it is already in.
   *
   * Resolves to that same session, now `running` with the previous run's exit
   * code and error cleared and a fresh `startedAt`. It does not create a second
   * row: the row is the conversation, and a list of near-identical rows is not
   * something the user can navigate.
   *
   * Takes the id of an existing *row*, never a conversation id: main looks up
   * what that row was for and decides what to hand the CLI. That is the same
   * rule the launch requests follow — the renderer names things, main resolves
   * them — and here it is what stops a caller asking APIWeave to pass an
   * arbitrary string to a process as its session id.
   *
   * Rejects when the row has no recorded conversation id, when its agent cannot
   * resume, or when it is still running. The caller should only offer this for a
   * finished session whose `agentSessionRef` is set, which is precisely the
   * condition for it working.
   */
  readonly resumeSession: (sessionId: string, cols: number, rows: number) => Promise<AgentSession>
  readonly write: (sessionId: string, data: string) => Promise<void>
  readonly resize: (sessionId: string, cols: number, rows: number) => Promise<void>
  /** Ask the PTY to stop producing while the terminal catches up, and to start again. */
  readonly setPaused: (sessionId: string, paused: boolean) => Promise<void>
  readonly killSession: (sessionId: string) => Promise<AgentSession>
  /**
   * Forget a session entirely: its row, and with it the history the list shows.
   *
   * Distinct from {@link killSession}, which stops a process and leaves the
   * record behind on purpose — the exit code and the scrollback are what the
   * user reopens it for. This is the one that removes it.
   */
  readonly deleteSession: (sessionId: string) => Promise<void>
  /**
   * Ask main for this session's output port. Resolves `false` when there is no
   * live process to attach to — an ended session, or one from a previous run of
   * the app — which the caller shows as history rather than as a terminal.
   *
   * The port itself does not come back through this promise, and cannot: a
   * `MessagePort` is transferable, not cloneable, so it can move but not be
   * copied — which is exactly what `contextBridge` and `invoke` both do. It
   * arrives instead as a `window.postMessage` into the page, keyed by
   * `AGENT_OUTPUT_PORT_MESSAGE_KEY`. That is the one part of this bridge that is
   * not a method on this bridge, because it is the one part that is not a copy.
   */
  readonly attach: (sessionId: string) => Promise<boolean>
  readonly onSessionChanged: (callback: (event: AgentSessionEvent) => void) => () => void
}
