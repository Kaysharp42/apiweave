import { MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from "electron"
import type { AgentEvent } from "@shared/types/AgentSessionEvent"
import type { PtyHostReply, PtyHostRequest, PtySpawnRequest } from "../core/agents/pty_protocol"

/**
 * How long a spawn may take before it is called a failure.
 *
 * This exists for one specific documented failure mode rather than out of
 * caution. On Windows, node-pty runs a CommonJS worker to read the conout pipe
 * and resolves it from `__dirname`; if the module's own `package.json` is not
 * unpacked beside it, Node walks up to `app/package.json`, finds
 * `"type": "module"`, loads the worker as ESM, and it throws before signalling
 * ready — at which point node-pty blocks on `ConnectNamedPipe` for ever with no
 * error surfaced. `build.asarUnpack` is what prevents it; this is what makes it
 * legible if a future packaging change breaks that, instead of a spinner that
 * never stops.
 */
const SPAWN_TIMEOUT_MS = 10_000

/**
 * How long the host gets to settle its children on shutdown before it is
 * killed itself. The host does the settling — it exits only after every child
 * has actually died, with its own SIGKILL escalation (`SHUTDOWN_ESCALATE_MS` in
 * `pty_host.ts`) — so this timer is a backstop for a host that cannot exit at
 * all, and by design never fires on the ordinary path.
 */
const SHUTDOWN_GRACE_MS = 2_000

export interface AgentProcessManagerOptions {
  /** Absolute path to the built `pty-host.cjs`, resolved by the caller against `__dirname`. */
  readonly hostEntryPath: string
  /**
   * Raw transitions, for the composition root to publish into
   * {@link AgentEventBroker} and persist. The manager deliberately owns no
   * database handle: what a session row should say about a dead process is a
   * policy question, and this class only knows processes.
   */
  readonly onEvent: (event: AgentEvent) => void
}

interface PendingSpawn {
  readonly resolve: (pid: number) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * Owns the PTY host process and every embedded agent session running inside it.
 *
 * One host for all sessions, forked on the first embedded launch and re-forked
 * after a crash — the alternative, a process per session, multiplies Electron's
 * per-process overhead by however many terminals the user leaves open, and buys
 * nothing: a PTY that takes down its host takes down that host either way.
 *
 * Lives in `electron/` rather than `core/` because it is Electron all the way
 * down (`utilityProcess`, `MessageChannelMain`), which is the same reason
 * `updater.ts` lives here. The Electron-free half of this feature — path
 * resolution, argv composition, the roster — stays in `core/agents/`.
 */
export class AgentProcessManager {
  private host: UtilityProcess | null = null
  private readonly pending = new Map<string, PendingSpawn>()
  private readonly live = new Set<string>()
  /**
   * Sessions the host reported as exited but whose replay it still holds. They
   * can be re-attached for their scrollback — the user most wants to read why
   * an agent stopped — until the host announces a `pruned` for them.
   */
  private readonly retained = new Set<string>()
  /**
   * Sessions whose spawn was cancelled while the host might still report back —
   * the caller gave up, so the row already says failed. A late `spawned`,
   * `exited` or `failed` for one of these must not rewrite it.
   */
  private readonly abandoned = new Set<string>()
  private disposed = false

  constructor(private readonly options: AgentProcessManagerOptions) {}

  /**
   * Start one PTY and resolve its pid.
   *
   * Rejects rather than resolving a half-started session: the caller records the
   * failure on the session row, so "the folder vanished" and "the binary is
   * gone" reach the user as text instead of as an empty terminal.
   */
  async start(request: PtySpawnRequest): Promise<number> {
    if (this.disposed) {
      throw new Error("APIWeave is shutting down")
    }
    const host = this.ensureHost()
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.sessionId)
        // The row will say failed the moment the caller records the rejection,
        // but the spawn request is already with the host and may still report
        // back. Abandoning rather than simply deleting is what stops a late
        // `spawned` from resurrecting the session after its failure was shown.
        this.abandoned.add(request.sessionId)
        reject(new Error("The terminal backend did not start. Restart APIWeave and try again."))
      }, SPAWN_TIMEOUT_MS)
      this.pending.set(request.sessionId, { resolve, reject, timer })
      host.postMessage({ type: "spawn", ...request } satisfies PtyHostRequest)
    })
  }

  write(sessionId: string, data: string): void {
    this.send({ type: "write", sessionId, data })
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.send({ type: "resize", sessionId, cols, rows })
  }

  /** Backpressure from the renderer: xterm.js parses far slower than a PTY can produce. */
  setPaused(sessionId: string, paused: boolean): void {
    this.send({ type: "setPaused", sessionId, paused })
  }

  kill(sessionId: string): void {
    this.send({ type: "kill", sessionId })
  }

  isLive(sessionId: string): boolean {
    return this.live.has(sessionId)
  }

  /**
   * Whether `attach` can hand over a working port — a running process, or an
   * exited one whose replay the host still retains. The host replays the
   * buffer and then the exit event for the second case, so a reopened
   * terminal shows the scrollback that explains why the agent stopped.
   */
  canAttach(sessionId: string): boolean {
    return this.live.has(sessionId) || this.retained.has(sessionId)
  }

  liveSessionIds(): readonly string[] {
    return [...this.live]
  }

  /**
   * Open a direct output channel for one session and return the renderer's end.
   *
   * The port pair is created here, in main, because only main may send a port to
   * both a renderer and a utility process — but once both ends are delivered,
   * main is not in the path. Terminal throughput is then bounded by the
   * renderer, not by main's event loop.
   *
   * Works for exited sessions too while the host retains their replay; see
   * {@link canAttach}. Returns `null` when there is nothing to attach to, which
   * is the ordinary case for a session that ended before this app run or has
   * since been pruned: its row is still in the list, and the caller shows it as
   * history rather than as a live terminal.
   */
  attach(sessionId: string): MessagePortMain | null {
    if (this.host === null || !this.canAttach(sessionId)) {
      return null
    }
    const { port1, port2 } = new MessageChannelMain()
    this.host.postMessage({ type: "attach", sessionId } satisfies PtyHostRequest, [port1])
    return port2
  }

  /**
   * Kill every session and stop the host.
   *
   * Waits for the host to confirm rather than killing it outright: the children
   * are the host's, so killing it first would leave the user's agent processes
   * running with nothing attached to them. The host is what does the waiting —
   * it exits once every child has actually died — and the grace period below
   * only fires when the host is stuck, not when a child merely ignores its
   * polite kill.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const host = this.host
    // Same race as the spawn timeout, on the way out: a spawn that reports back
    // while the host is stopping must not flip its already-failed row.
    for (const sessionId of this.pending.keys()) {
      this.abandoned.add(sessionId)
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("APIWeave is shutting down"))
    }
    this.pending.clear()
    if (host === null) {
      this.abandoned.clear()
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        host.kill()
        resolve()
      }, SHUTDOWN_GRACE_MS)
      host.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
      host.postMessage({ type: "shutdown" } satisfies PtyHostRequest)
    })
    this.host = null
    this.live.clear()
    this.retained.clear()
    this.abandoned.clear()
  }

  private send(request: PtyHostRequest): void {
    this.host?.postMessage(request)
  }

  private ensureHost(): UtilityProcess {
    const existing = this.host
    if (existing !== null) {
      return existing
    }
    const host = utilityProcess.fork(this.options.hostEntryPath, [], {
      serviceName: "APIWeave PTY host",
      // Default `inherit` on purpose: node-pty's own diagnostics are the first
      // thing anyone debugging a spawn wants, and they are worth nothing in a
      // pipe nobody reads.
      //
      // `allowLoadingUnsignedLibraries` is deliberately not set. It routes the
      // process through Electron's Plugin helper, which only helps if that
      // helper is codesigned with the library-validation entitlements — the mac
      // build here is unsigned, so there is nothing to disable. It is the knob
      // to reach for if a signed macOS build ever fails to load `pty.node`.
    })
    host.on("message", (message: PtyHostReply) => {
      this.onHostMessage(message)
    })
    host.once("exit", (code) => {
      this.onHostExit(code)
    })
    this.host = host
    return host
  }

  private onHostMessage(message: PtyHostReply): void {
    switch (message.type) {
      case "spawned": {
        if (!this.settle(message.sessionId, (pending) => pending.resolve(message.pid))) {
          // The caller already gave up — the spawn timeout fired, or the app is
          // shutting down — and the row says failed. This PTY now exists but
          // nobody owns it, and publishing `agent.started` would flip the row
          // back to running. Kill it instead; the host's `exited` for it is
          // suppressed below.
          this.send({ type: "kill", sessionId: message.sessionId })
          return
        }
        this.live.add(message.sessionId)
        this.options.onEvent({ kind: "agent.started", sessionId: message.sessionId, pid: message.pid })
        return
      }
      case "exited": {
        this.live.delete(message.sessionId)
        if (this.abandoned.delete(message.sessionId)) {
          // The reap of a spawn nobody was still waiting for. The row already
          // records the failure, and an `agent.exited` would overwrite it.
          return
        }
        // The host retains the session's replay for re-attach — nothing to
        // announce to the renderer yet, but `attach` must keep accepting it.
        this.retained.add(message.sessionId)
        this.options.onEvent({
          kind: "agent.exited",
          sessionId: message.sessionId,
          exitCode: message.exitCode,
        })
        return
      }
      case "pruned": {
        this.retained.delete(message.sessionId)
        return
      }
      case "failed": {
        this.live.delete(message.sessionId)
        // A spawn that failed is reported to its caller, which turns it into an
        // error the user can read. Publishing it as well would record the same
        // failure on the session row twice, in two different wordings.
        const settled = this.settle(message.sessionId, (pending) =>
          pending.reject(new Error(message.message)),
        )
        if (settled || this.abandoned.delete(message.sessionId)) {
          return
        }
        this.options.onEvent({
          kind: "agent.failed",
          sessionId: message.sessionId,
          message: message.message,
        })
      }
    }
  }

  /**
   * The host died with sessions in it — a native crash, or the OS killing it.
   *
   * Every live session is now a process APIWeave cannot see, so each is reported
   * failed rather than left sitting at "running" for ever. The host is cleared
   * instead of restarted: re-forking would produce a host with no sessions,
   * which is exactly what the next launch does anyway.
   */
  private onHostExit(code: number): void {
    const reason = `The terminal backend stopped unexpectedly (exit ${String(code)})`
    this.host = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pending.clear()
    // A dead host cannot send any of the late replies `abandoned` exists for,
    // and its replay buffers went with it.
    this.abandoned.clear()
    this.retained.clear()
    const stranded = [...this.live]
    this.live.clear()
    if (this.disposed) {
      return
    }
    for (const sessionId of stranded) {
      this.options.onEvent({ kind: "agent.failed", sessionId, message: reason })
    }
  }

  private settle(sessionId: string, apply: (pending: PendingSpawn) => void): boolean {
    const pending = this.pending.get(sessionId)
    if (pending === undefined) {
      return false
    }
    clearTimeout(pending.timer)
    this.pending.delete(sessionId)
    apply(pending)
    return true
  }
}
