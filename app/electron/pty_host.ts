import type { IPty } from "node-pty"
import { spawn as spawnPty } from "node-pty"
import type { MessagePortMain } from "electron"
import type { AgentOutputEvent } from "@shared/types/AgentOutputEvent"
import {
  PTY_REPLAY_MAX_BYTES,
  type PtyHostReply,
  type PtyHostRequest,
  type PtySpawnRequest,
} from "../core/agents/pty_protocol"

/**
 * The PTY host: an Electron `utilityProcess` that owns every embedded agent's
 * pseudoterminal, and nothing else.
 *
 * Three reasons it is a separate process rather than a module in main, all of
 * them VS Code's pty-host reasoning:
 *
 * - A native addon that segfaults takes down this process only. Main keeps the
 *   window, the database and every other session's bookkeeping.
 * - Sessions survive a renderer reload, because the process holding the child's
 *   file descriptors is not the one being reloaded.
 * - The addon never has to load in a renderer, which runs with
 *   `contextIsolation: true`, `nodeIntegration: false` and Electron 33's default
 *   `sandbox: true` — where it could not load at all.
 *
 * Output does not go back through main. Each session hands the renderer a
 * `MessagePort`, and chunks travel over it directly; see
 * {@link AgentOutputEvent}.
 */

interface Session {
  readonly pty: IPty
  /** Bounded replay, so a terminal that mounts late is not blank. */
  readonly replay: string[]
  replayBytes: number
  port: MessagePortMain | null
  /** Set the moment the child exits, so a late `write` cannot resurrect it. */
  exited: boolean
  /** Kept for the replay: a terminal mounting after the exit still gets told. */
  exitCode: number
}

/** How many finished sessions keep their scrollback for a later re-attach. */
const MAX_RETAINED_EXITED = 20

/**
 * How long shutdown gives a child to exit on its own before escalating to
 * SIGKILL, which cannot be ignored. Sized to finish — with the final forced
 * exit after it — inside the manager's own shutdown grace
 * (`SHUTDOWN_GRACE_MS` in `agent_process_manager.ts`): the manager's timer must
 * stay the backstop for a host that is itself stuck, not race the host's
 * escalation.
 */
const SHUTDOWN_ESCALATE_MS = 1_500

const sessions = new Map<string, Session>()

const parentPort = process.parentPort

/** Set when a `shutdown` request arrives, so session exits start being counted. */
let shuttingDown = false
let escalateTimer: ReturnType<typeof setTimeout> | null = null
let forcedExitTimer: ReturnType<typeof setTimeout> | null = null

parentPort.on("message", (event) => {
  const request = event.data as PtyHostRequest
  // One try/catch around the whole dispatch: the host has no supervisor of its
  // own, so an exception escaping here would kill every other live session.
  try {
    handle(request, event.ports)
  } catch (error) {
    if ("sessionId" in request) {
      reply({ type: "failed", sessionId: request.sessionId, message: describeError(error) })
    }
  }
})

// fallow-ignore-next-line complexity -- a dispatch switch over the fixed message vocabulary of the PTY protocol; each branch is a one-line call, and the estimated-coverage CRAP misses that pty_host.test.ts exercises every arm
function handle(request: PtyHostRequest, ports: readonly MessagePortMain[]): void {
  switch (request.type) {
    case "spawn":
      if (shuttingDown) {
        // The kill pass has already run; a child started now would outlive it
        // and the app. The manager's own `disposed` guard stops this request
        // from being sent at all — this is the race where it was in flight.
        reply({ type: "failed", sessionId: request.sessionId, message: "APIWeave is shutting down" })
        return
      }
      start(request)
      return
    case "write": {
      const session = sessions.get(request.sessionId)
      // Writing into an exited PTY is a no-op at best and an EPIPE at worst;
      // either way the keystroke never reaches anything.
      if (session === undefined || session.exited) return
      session.pty.write(request.data)
      return
    }
    case "resize":
      resize(request.sessionId, request.cols, request.rows)
      return
    case "setPaused": {
      const session = sessions.get(request.sessionId)
      if (session === undefined) return
      if (request.paused) session.pty.pause()
      else session.pty.resume()
      return
    }
    case "attach":
      attach(request.sessionId, ports[0])
      return
    case "kill":
      kill(request.sessionId)
      return
    case "shutdown":
      shutDown()
  }
}

function start(request: PtySpawnRequest): void {
  const pty = spawnPty(request.file, [...request.args], {
    cwd: request.cwd,
    env: childEnv(request.env),
    cols: request.cols,
    rows: request.rows,
    // Bundled conpty.dll instead of the one in the user's Windows build. It is
    // both newer than what old Windows 10 ships and the one node-pty tests
    // against; the DLL travels in the module directory, which is why the whole
    // module is unpacked from the asar.
    useConptyDll: true,
  })

  const session: Session = { pty, replay: [], replayBytes: 0, port: null, exited: false, exitCode: 0 }
  sessions.set(request.sessionId, session)

  pty.onData((data) => {
    buffer(session, data)
    post(session, { kind: "output", sessionId: request.sessionId, data })
  })

  pty.onExit(({ exitCode, signal }) => {
    session.exited = true
    session.exitCode = exitCode
    post(session, { kind: "exit", sessionId: request.sessionId, exitCode })
    reply({ type: "exited", sessionId: request.sessionId, exitCode, signal: signal ?? null })
    // The replay buffer outlives the child on purpose: what the user most wants
    // to read is why it exited, and that is the last thing in the buffer.
    pruneExited()
    noteSettled()
  })

  reply({ type: "spawned", sessionId: request.sessionId, pid: pty.pid })
}

/**
 * The host's own environment with the request merged over it.
 *
 * A replacement rather than a merge would be wrong: the agent CLI needs PATH,
 * HOME/USERPROFILE and the user's own auth-related variables — it runs under
 * their credentials, not APIWeave's. Two Electron-specific variables are removed
 * because a Node-based agent CLI inheriting them misbehaves in ways that look
 * like the agent is broken.
 */
function childEnv(overrides: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env["ELECTRON_RUN_AS_NODE"]
  delete env["NODE_OPTIONS"]
  return {
    ...env,
    // Overwriting any inherited value, not defaulting: what is on the other end
    // of this PTY is xterm.js, whatever terminal APIWeave itself was started
    // from. Launched from a `TERM=dumb` shell, an inherited TERM would make the
    // agent print its own escape codes as text.
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    ...overrides,
  }
}

function resize(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId)
  if (session === undefined || session.exited) return
  // A zero or negative dimension throws inside conpty; an unmounted xterm.js
  // reports exactly that while it has no layout.
  if (cols < 1 || rows < 1) return
  session.pty.resize(cols, rows)
}

/**
 * Hand this session's output to a renderer over a fresh port, oldest output
 * first.
 *
 * Replaying the buffer through the same port as the live stream is what keeps
 * the ordering honest: a chunk that arrives between the replay write and the
 * first live write is queued behind it, because it is the same queue.
 */
function attach(sessionId: string, port: MessagePortMain | undefined): void {
  const session = sessions.get(sessionId)
  if (port === undefined) return
  if (session === undefined) {
    port.close()
    return
  }
  session.port?.close()
  session.port = port
  // The pause belongs to whichever consumer invoked it, and that consumer is
  // gone (or is being replaced by this one). A paused PTY must not stay frozen
  // under a fresh terminal, so attach resumes unconditionally: a new consumer
  // that falls behind re-pauses at its own threshold, and on an already-exited
  // session resuming the closed stream is a no-op.
  session.pty.resume()
  if (session.replay.length > 0) {
    port.postMessage({ kind: "output", sessionId, data: session.replay.join("") } satisfies AgentOutputEvent)
  }
  if (session.exited) {
    port.postMessage({ kind: "exit", sessionId, exitCode: session.exitCode } satisfies AgentOutputEvent)
  }
}

/**
 * Ask the child to stop, and nothing else.
 *
 * Emphatically not "stop it and clean up": tearing the port down here would
 * close the only channel the imminent exit has to travel over, so the terminal
 * the user is looking at would never receive its `[process exited]` line and
 * would sit there looking live. The exit handler above owns settling and
 * pruning; this only pulls the trigger.
 */
function kill(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (session === undefined || session.exited) return
  try {
    session.pty.kill()
  } catch {
    // Already gone between the check and the call — nothing left to do, and
    // there is no one to tell who would act differently.
  }
}

/**
 * Stop every child and exit the host only once they have all actually died.
 *
 * `kill()` is a request, not a fact: a child that ignores SIGHUP — or takes its
 * time releasing the console — is still alive when the call returns. Exiting in
 * the same tick as the kill would abandon that child past app quit, and would
 * make the manager's shutdown grace measure nothing, because the host would be
 * gone before the kill ever had a chance to land. So the host stays up until
 * every session has settled, escalating to SIGKILL for stragglers and then
 * leaving on a hard deadline for whatever even that could not reach.
 */
function shutDown(): void {
  shuttingDown = true
  for (const sessionId of [...sessions.keys()]) {
    kill(sessionId)
  }
  // Nothing left alive (or nothing was ever started): leave at once.
  if (allSettled()) {
    process.exit(0)
    return
  }
  escalateTimer = setTimeout(() => {
    for (const session of sessions.values()) {
      if (session.exited) continue
      try {
        session.pty.kill("SIGKILL")
      } catch {
        // Gone between the check and the call.
      }
    }
    // SIGKILL cannot be ignored, so a child that is somehow still alive after
    // this is outside the host's reach. One beat for the OS to reap, then
    // leave regardless: quitting must not hang on an unkillable process.
    forcedExitTimer = setTimeout(() => process.exit(0), 250)
  }, SHUTDOWN_ESCALATE_MS)
}

/**
 * Called whenever a session exits. During shutdown, the last settled child is
 * the moment the host may leave: cancel the escalation machinery and exit.
 */
function noteSettled(): void {
  if (!shuttingDown || !allSettled()) return
  if (escalateTimer !== null) clearTimeout(escalateTimer)
  if (forcedExitTimer !== null) clearTimeout(forcedExitTimer)
  process.exit(0)
}

function allSettled(): boolean {
  for (const session of sessions.values()) {
    if (!session.exited) return false
  }
  return true
}

/**
 * Keep the replay of the most recent finished sessions and drop the rest.
 *
 * Every retained session holds up to {@link PTY_REPLAY_MAX_BYTES}, so "keep them
 * for the scrollback" needs a bound or a long-lived window slowly eats memory
 * for terminals nobody will reopen. Each drop is announced, because the main
 * process advertises "this ended session can be reopened" by host retention —
 * a pruned session it still advertised would open as a silent, blank terminal.
 */
function pruneExited(): void {
  const finished = [...sessions].filter(([, session]) => session.exited)
  for (const [sessionId, session] of finished.slice(0, finished.length - MAX_RETAINED_EXITED)) {
    session.port?.close()
    sessions.delete(sessionId)
    reply({ type: "pruned", sessionId })
  }
}

function buffer(session: Session, data: string): void {
  session.replay.push(data)
  session.replayBytes += data.length
  while (session.replayBytes > PTY_REPLAY_MAX_BYTES && session.replay.length > 1) {
    session.replayBytes -= session.replay.shift()?.length ?? 0
  }
}

function post(session: Session, event: AgentOutputEvent): void {
  if (session.port === null) return
  try {
    session.port.postMessage(event)
  } catch {
    // The renderer went away without closing its end. Drop the port; the
    // replay buffer still has everything, so the next attach is complete.
    session.port = null
  }
}

function reply(message: PtyHostReply): void {
  parentPort.postMessage(message)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
