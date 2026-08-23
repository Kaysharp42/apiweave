import type { IPty } from "node-pty"
import { spawn as spawnPty } from "node-pty"
import type { MessagePortMain } from "electron"
import type { AgentOutputEvent } from "@shared/types/AgentOutputEvent"
import {
  PTY_IDLE_AFTER_MS,
  PTY_MAX_OSC_LENGTH,
  PTY_REPLAY_MAX_BYTES,
  PTY_SCAN_WINDOW,
  type PtyHostReply,
  type PtyHostRequest,
  type PtySpawnRequest,
} from "../core/agents/pty_protocol"
import { getLogger } from "../core/logging/logger"

// The host is a utilityProcess: it shares no module instance with main, so the
// electron-log file backend bound there never exists here and the facade falls
// back to stderr. The records that matter — fatal V8 errors, exits — are
// mirrored into the daily files by AgentProcessManager's `error`/`exit`
// handlers on its side of the fork.
const log = getLogger("pty-host")

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
  replay: string[]
  replayBytes: number
  port: MessagePortMain | null
  /** Set the moment the child exits, so a late `write` cannot resurrect it. */
  exited: boolean
  /** Whether the child is currently printing; see {@link PTY_IDLE_AFTER_MS}. */
  busy: boolean
  /** Pending "it has gone quiet", restarted by every chunk. Null while idle. */
  idleTimer: ReturnType<typeof setTimeout> | null
  /**
   * Compiled `sessionIdPattern`, or null for an agent that does not need
   * scanning — and also the moment its id has been found, which is what stops
   * the scan running for the rest of a long session.
   */
  idPattern: RegExp | null
  /** The tail of recent output, so an id split across two chunks still matches. */
  scanTail: string
  /** An OSC payload being accumulated across chunks, or null when outside one. */
  osc: string | null
  /** The last title reported, so an unchanged repaint is not reported again. */
  title: string | null
  /** Kept for the replay: a terminal mounting after the exit still gets told. */
  exitCode: number
  /**
   * Order of exit, not of spawn. Retention is "the most recent finished
   * sessions", and the map is in spawn order — a long-lived terminal started
   * first and closed last would otherwise be pruned before short ones that
   * ended hours earlier.
   */
  exitSeq: number
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
/** Monotonic, so exit order is total even for exits inside one tick. */
let exitCounter = 0

/**
 * The host has no supervisor inside itself: an exception that reaches the event
 * loop ends the process, and with it every unrelated session's PTY — the exact
 * blast radius the separate process exists to prevent.
 *
 * This is a live risk rather than a theoretical one, because node-pty defers.
 * `WindowsTerminal` queues any call made before the conout pipe signals ready
 * and runs it later, so a call that throws throws from a timer, past the
 * try/catch at its call site. Nothing in an anonymous async throw identifies a
 * session, so all this can do is survive and leave a trace; the throws that
 * *are* attributable are caught at the dispatch and per-session boundaries
 * below, and fail only their own session.
 */
process.on("uncaughtException", (error: unknown) => {
  log.error("uncaught exception", error)
})
process.on("unhandledRejection", (reason: unknown) => {
  log.error("unhandled rejection", reason)
})

parentPort.on("message", (event) => {
  const request = event.data as PtyHostRequest
  // One try/catch around the whole dispatch: an exception escaping here would
  // kill every other live session, and the session it belongs to is knowable
  // exactly here, so it is failed by name rather than taken down with the host.
  try {
    handle(request, event.ports)
  } catch (error) {
    if ("sessionId" in request) {
      fail(request.sessionId, describeError(error))
    }
  }
})

/**
 * Main is gone — it crashed, or something killed it outside the quit path.
 *
 * Nothing will read a reply again and no `shutdown` is coming, so these
 * children are the user's agent processes with no owner and no window showing
 * their output. The ordinary teardown runs: kill them, wait for them to
 * actually die, and leave. Without this, every main-process crash strands a
 * host and a process tree until the user finds them in Task Manager.
 *
 * Registered through the `EventEmitter` face of the port because Electron's
 * `ParentPort` typings enumerate only `message`, while the object is an emitter
 * over the same pipe `MessagePortMain` publishes `close` on. Belt and braces
 * rather than the only line of defence — Chromium puts utility processes in a
 * job object that the browser process takes with it on Windows — so if a given
 * Electron never emits it, this costs one dormant listener.
 */
;(parentPort as NodeJS.EventEmitter).on("close", () => {
  shutDown()
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
  // A session id can arrive twice: resuming runs a conversation again in the row
  // it is already in, so the same id comes back with a new process behind it.
  // The entry it replaces has to be dismantled rather than dropped on the floor
  // — its port is a live channel to a terminal that is about to be shown the new
  // process, and its idle timer would fire against a session object nothing
  // points at any more.
  retire(request.sessionId)

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

  const session: Session = {
    pty,
    replay: [],
    replayBytes: 0,
    port: null,
    exited: false,
    busy: false,
    idleTimer: null,
    idPattern: compilePattern(request.sessionIdPattern),
    scanTail: "",
    osc: null,
    title: null,
    exitCode: 0,
    exitSeq: 0,
  }
  sessions.set(request.sessionId, session)

  // Both callbacks run from node-pty's own emitter, which is to say from the
  // event loop with no try/catch above it: a throw in here would be an
  // uncaught exception that ends the host. Guarded so it ends one session.
  pty.onData((data) => {
    guard(request.sessionId, () => {
      buffer(session, data)
      noteBusy(request.sessionId, session)
      scanForSessionId(request.sessionId, session, data)
      scanForTitle(request.sessionId, session, data)
      post(session, { kind: "output", sessionId: request.sessionId, data })
    })
  })

  pty.onExit(({ exitCode, signal }) => {
    guard(request.sessionId, () => {
      session.exited = true
      // Silently, without an `activity` reply: the `exited` below is the same
      // news and outranks it, and a busy flag arriving after an exit is exactly
      // what would leave a finished row claiming the agent is still typing.
      stopIdleTimer(session)
      session.busy = false
      session.exitCode = exitCode
      exitCounter += 1
      session.exitSeq = exitCounter
      post(session, { kind: "exit", sessionId: request.sessionId, exitCode })
      reply({ type: "exited", sessionId: request.sessionId, exitCode, signal: signal ?? null })
      // The replay buffer outlives the child on purpose: what the user most
      // wants to read is why it exited, and that is the last thing in it.
      pruneExited()
      noteSettled()
    })
  })

  reply({ type: "spawned", sessionId: request.sessionId, pid: pty.pid })
}

/**
 * Drop a session the host is about to replace under the same id.
 *
 * Kills it first if it is somehow still alive — that would be a resume racing a
 * process that never actually died, and leaving it running would strand a child
 * with no entry naming it, which is precisely what nothing could then stop.
 */
function retire(sessionId: string): void {
  const existing = sessions.get(sessionId)
  if (existing === undefined) return
  stopIdleTimer(existing)
  if (!existing.exited) {
    try {
      existing.pty.kill()
    } catch {
      // Already gone. Nothing to do, and nobody who would act differently.
    }
  }
  existing.port?.close()
  existing.port = null
  sessions.delete(sessionId)
}

/**
 * This session just printed: say so if it was quiet, and restart the clock that
 * will say it has gone quiet again.
 *
 * Reported on the edges only. Output arrives in thousands of small chunks, and
 * a message per chunk would put main's event loop back in the terminal's path —
 * the thing the `MessagePort` exists to keep it out of. What main learns is
 * "started printing" and, {@link PTY_IDLE_AFTER_MS} later, "stopped".
 *
 * The timer is `unref`'d so a session sitting mid-burst cannot be the reason the
 * host stays alive: shutdown exits explicitly once every child has settled, and
 * a pending 1.5s timeout must not hold that open.
 */
function noteBusy(sessionId: string, session: Session): void {
  stopIdleTimer(session)
  if (!session.busy) {
    session.busy = true
    reply({ type: "activity", sessionId, busy: true })
  }
  const timer = setTimeout(() => {
    session.idleTimer = null
    session.busy = false
    reply({ type: "activity", sessionId, busy: false })
  }, PTY_IDLE_AFTER_MS)
  timer.unref?.()
  session.idleTimer = timer
}

function stopIdleTimer(session: Session): void {
  if (session.idleTimer === null) return
  clearTimeout(session.idleTimer)
  session.idleTimer = null
}

/**
 * Compile a definition's session-id pattern, or decide there is none.
 *
 * A definition can be a *user's* — the roster is editable — so the pattern is
 * untrusted input, and `new RegExp` throws on a malformed one. Thrown from
 * here, inside the host, it would take down every unrelated session's PTY. A
 * pattern that will not compile is therefore no pattern: that agent simply
 * never learns its session id, which is where it started.
 *
 * Deliberately not `g`: the scan wants the first match and nothing else, and a
 * global regex carries `lastIndex` between calls — which, on a fresh string each
 * time, silently skips matches.
 */
function compilePattern(source: string | null): RegExp | null {
  if (source === null || source === "") return null
  try {
    return new RegExp(source)
  } catch (error) {
    log.error("ignoring an invalid sessionIdPattern", error)
    return null
  }
}

/**
 * Look for the agent's own session id, and report the first one found.
 *
 * Matched against a short tail of previous output joined to this chunk, because
 * the OS splits reads wherever it likes and an id landing across that boundary
 * is not a rare case — it is what happens whenever the id is near the end of a
 * write. The tail is bounded by {@link PTY_SCAN_WINDOW}, so this costs the same
 * per chunk whether the session has printed a kilobyte or a gigabyte.
 *
 * The pattern is dropped after the first match. That ends the scanning cost for
 * the rest of the session, and it is also the correctness rule: see the
 * `sessionRef` reply for why a later match is not trustworthy.
 */
function scanForSessionId(sessionId: string, session: Session, data: string): void {
  const pattern = session.idPattern
  if (pattern === null) return
  const haystack = session.scanTail + data
  const found = pattern.exec(haystack)
  if (found === null) {
    session.scanTail = haystack.slice(-PTY_SCAN_WINDOW)
    return
  }
  // Capture group 1 when the pattern defines one, the whole match otherwise.
  // Not a nicety: some agents' ids are bare UUIDs with nothing distinctive
  // about them, so the only safe pattern anchors on the words around the id
  // ("run codex resume <uuid>") and captures the id out of the middle. Without
  // a group, such a pattern would store the sentence.
  const ref = found[1] ?? found[0]
  if (ref === undefined || ref === "") return
  session.idPattern = null
  session.scanTail = ""
  reply({ type: "sessionRef", sessionId, ref })
}

/**
 * Pull the terminal title out of the stream: `ESC ] 0 ; <text> BEL`, or the
 * same with `2` for the title alone and `ESC \` (ST) as the terminator.
 *
 * Written as two `indexOf` scans rather than as a character loop through the
 * escape automaton `trim` already has. That automaton runs only over output
 * being *discarded*, a few kilobytes at a time; this runs over every byte the
 * agent ever prints, so a per-character loop in JS would put a real cost on the
 * host's hot path. The overwhelmingly common chunk contains no OSC at all and
 * costs exactly one native substring search.
 *
 * Reported only when the title actually changes, because TUIs re-set the same
 * title on every repaint.
 */
function scanForTitle(sessionId: string, session: Session, data: string): void {
  let rest = data
  while (rest !== "") {
    if (session.osc === null) {
      const start = rest.indexOf(OSC_START)
      if (start === -1) return
      session.osc = ""
      rest = rest.slice(start + OSC_START.length)
      continue
    }
    const end = findOscEnd(rest)
    if (end === null) {
      session.osc += rest
      // An OSC nobody ever terminates must not grow for ever; abandoning it
      // resynchronises on the next `ESC ]` instead of buffering the session.
      if (session.osc.length > PTY_MAX_OSC_LENGTH) session.osc = null
      return
    }
    const payload = session.osc + rest.slice(0, end.index)
    session.osc = null
    rest = rest.slice(end.index + end.length)
    const title = titleFrom(payload)
    if (title === null || title === session.title) continue
    session.title = title
    reply({ type: "title", sessionId, title })
  }
}

// Escapes rather than the raw control bytes they stand for. The bytes are
// legal in a string literal, but they are invisible in a diff and unfindable
// by eye -- the same reason `ESC` below is spelled out. Deliberately not
// `${ESC}...`: these initialise at module scope ABOVE that declaration, where
// reading it is a temporal-dead-zone ReferenceError that fails the host at load.
const OSC_START = "\u001b]"
const BEL = "\u0007"
/** String Terminator: the other legal way to end an OSC. */
const ST = "\u001b\\"

function findOscEnd(text: string): { readonly index: number; readonly length: number } | null {
  const bell = text.indexOf(BEL)
  const terminator = text.indexOf(ST)
  if (bell === -1 && terminator === -1) return null
  // Whichever comes first: a payload may legitimately contain the other's
  // opening byte, and taking the later one would swallow the text after it.
  if (terminator === -1 || (bell !== -1 && bell < terminator)) {
    return { index: bell, length: BEL.length }
  }
  return { index: terminator, length: ST.length }
}

/**
 * The title out of an OSC payload, or null when the payload is some other OSC —
 * a colour query, a hyperlink, a clipboard write. Only `0` (icon name *and*
 * window title) and `2` (window title) carry one.
 *
 * An empty title is null rather than an empty string: clearing the title is
 * something TUIs do on the way out, and it means "no title", not "the session is
 * called nothing".
 */
function titleFrom(payload: string): string | null {
  const separator = payload.indexOf(";")
  if (separator === -1) return null
  const code = payload.slice(0, separator)
  if (code !== "0" && code !== "2") return null
  const title = payload.slice(separator + 1).trim()
  return title === "" ? null : title
}

/**
 * Run a callback that belongs to exactly one session, so a throw inside it
 * fails that session instead of the process. The counterpart of the dispatch
 * try/catch, for the paths node-pty calls rather than main.
 */
function guard(sessionId: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    fail(sessionId, describeError(error))
  }
}

/**
 * Report a session as failed — and make that report true.
 *
 * `failed` is the end of a row's life: main removes the session from its live
 * set, writes the row terminal, and unlinks the scratch files named after it,
 * including the MCP config holding a live bearer token. All of that is correct
 * for the case this reply was written for, a spawn that never produced a child.
 *
 * It is a lie for the other case. Every operation on an *existing* session
 * reaches the same dispatch try/catch — a node-pty `write` that throws on a
 * broken pipe is the ordinary example — and reporting that as `failed` left the
 * child running with nothing tracking it: the Stop button disappears with the
 * live flag, the terminal can no longer be attached, and the real `exited`
 * arrives to a row that is already terminal and drops it. An agent process with
 * no owner and no way to reach it, holding a config file that was just deleted
 * out from under it.
 *
 * So the kill comes with the message. Whatever went wrong, the session really
 * is over by the time main is told it is — and the exit that follows is the
 * same news arriving second, which the terminal-status pin already ignores.
 */
function fail(sessionId: string, message: string): void {
  reply({ type: "failed", sessionId, message })
  const session = sessions.get(sessionId)
  if (session === undefined || session.exited) {
    return
  }
  try {
    session.pty.kill()
  } catch {
    // Already gone, or unreachable. `forceKill` is shutdown's escalation and
    // has no business here: this session is being abandoned, not the host.
  }
}

/**
 * The host's own environment with the request merged over it.
 *
 * A replacement rather than a merge would be wrong: the agent CLI needs PATH,
 * HOME/USERPROFILE and the user's own auth-related variables — it runs under
 * their credentials, not APIWeave's. Two Electron-specific variables are removed
 * because a Node-based agent CLI inheriting them misbehaves in ways that look
 * like the agent is broken.
 *
 * The merge is case-insensitive on Windows, where the environment itself is:
 * a plain object spread would put both `PATH` and a `Path` override in the
 * block, and which of the two a child reads is not defined — `%PATH%` resolves
 * one of them and libc-style `getenv("PATH")` may resolve the other. The first
 * spelling seen wins the *name*, the last write wins the *value*, so an
 * override always takes effect and never duplicates the entry it overrides.
 */
function childEnv(overrides: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {}
  const foldCase = process.platform === "win32"
  const spellings = new Map<string, string>()
  const set = (key: string, value: string): void => {
    if (!foldCase) {
      env[key] = value
      return
    }
    const folded = key.toUpperCase()
    const existing = spellings.get(folded)
    if (existing !== undefined) {
      env[existing] = value
      return
    }
    spellings.set(folded, key)
    env[key] = value
  }
  const unset = (key: string): void => {
    const spelling = foldCase ? spellings.get(key.toUpperCase()) : key
    if (spelling === undefined) return
    delete env[spelling]
    spellings.delete(key.toUpperCase())
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) set(key, value)
  }
  unset("ELECTRON_RUN_AS_NODE")
  unset("NODE_OPTIONS")
  // Overwriting any inherited value, not defaulting: what is on the other end
  // of this PTY is xterm.js, whatever terminal APIWeave itself was started
  // from. Launched from a `TERM=dumb` shell, an inherited TERM would make the
  // agent print its own escape codes as text. Set before the overrides so a
  // caller that means to choose the terminal type still can.
  set("TERM", "xterm-256color")
  set("COLORTERM", "truecolor")
  for (const [key, value] of Object.entries(overrides)) {
    set(key, value)
  }
  return env
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
 * The escalation kill: the one a child cannot ignore.
 *
 * Platform-split because node-pty's `kill(signal)` is not portable.
 * `WindowsTerminal.prototype.kill` throws `Signals not supported on windows.`
 * for *any* signal argument (node-pty/lib/windowsTerminal.js), and throws it
 * from inside `_deferNoArgs` — so on a terminal that has not signalled ready
 * the throw is queued and later escapes asynchronously, past the try/catch
 * here. The no-argument form is already the hard kill on Windows: it closes
 * the pseudoconsole and terminates the child, with nothing for the child to
 * ignore the way a POSIX process can ignore SIGHUP.
 *
 * On POSIX the polite kill was SIGHUP, so this has to be SIGKILL, and it is
 * sent to the pid directly rather than through `IPty.kill`: that method
 * swallows every failure, which would make a child we cannot signal at all
 * indistinguishable from one that died.
 */
function forceKill(session: Session): void {
  try {
    if (process.platform === "win32") {
      session.pty.kill()
    } else {
      process.kill(session.pty.pid, "SIGKILL")
    }
  } catch {
    // Gone between the check and the call, or already unreachable. Either way
    // the forced-exit deadline below is what actually gets the host out.
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
  // Re-entrant: the parent port closing during an ordinary shutdown would
  // otherwise start a second escalation and leak its timers.
  if (shuttingDown) return
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
      forceKill(session)
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
 *
 * Ordered by when each session *exited*, not by when it started: the map is in
 * spawn order, which would prune the session that just ended before one that
 * ended an hour ago whenever the first terminal opened is the last to close.
 */
function pruneExited(): void {
  const finished = [...sessions]
    .filter(([, session]) => session.exited)
    .sort(([, left], [, right]) => left.exitSeq - right.exitSeq)
  // `Math.max` because a negative `end` is not "take nothing" to `Array.slice`
  // — it counts back from the length instead. With 15 finished sessions the
  // bare subtraction asked for `slice(0, -5)` and pruned ten of them, so the
  // effective retention oscillated around half the intended bound.
  const excess = Math.max(0, finished.length - MAX_RETAINED_EXITED)
  for (const [sessionId, session] of finished.slice(0, excess)) {
    // A terminal may still be attached to a finished session — that is the
    // whole point of retaining it. Tell it why it is about to go quiet before
    // the port disappears under it.
    const port = session.port
    if (port !== null) {
      post(session, { kind: "replayReleased", sessionId })
      port.close()
      session.port = null
    }
    sessions.delete(sessionId)
    reply({ type: "pruned", sessionId })
  }
}

function buffer(session: Session, data: string): void {
  session.replay.push(data)
  // Bytes, not code units: the budget is a memory bound and
  // `PTY_REPLAY_MAX_BYTES` says bytes. A session emitting box-drawing or CJK
  // output would otherwise hold up to three times the intended buffer.
  session.replayBytes += Buffer.byteLength(data, "utf8")
  trim(session)
}

/**
 * Drop oldest-first until the buffer is inside its budget, then keep dropping
 * until it starts at a place a terminal can be dropped into.
 *
 * The trim boundary is a chunk boundary, and a chunk boundary is wherever the
 * OS happened to split the read — routinely in the middle of an escape
 * sequence. Replaying from there feeds xterm.js the tail of a sequence it never
 * saw the start of, which it renders as garbage text, or worse leaves it
 * waiting in a parser state that eats the next screenful.
 *
 * The fix is to parse rather than guess. The buffer's invariant is that it
 * begins in the ground state, so scanning only what is being dropped gives the
 * parser state at the cut for free; if that state is not ground, the rest of
 * the unterminated sequence is consumed off the front of the new head and the
 * invariant holds again. The cost is bounded by the dropped chunk plus one
 * sequence, and the alternative — keeping a byte-exact ring and cutting on a
 * boundary — needs the same parser to find the boundary anyway.
 */
function trim(session: Session): void {
  let state: EscapeState = "ground"
  while (session.replayBytes > PTY_REPLAY_MAX_BYTES && session.replay.length > 1) {
    const chunk = session.replay.shift() ?? ""
    session.replayBytes -= Buffer.byteLength(chunk, "utf8")
    state = finalState(chunk, state)
  }
  while (state !== "ground" && session.replay.length > 0) {
    const head = session.replay[0] ?? ""
    const resumed = scan(head, state)
    state = resumed.state
    session.replayBytes -= Buffer.byteLength(head, "utf8") - Buffer.byteLength(resumed.rest, "utf8")
    if (resumed.rest === "") session.replay.shift()
    else session.replay[0] = resumed.rest
  }
}

/**
 * Where the escape-sequence parser is between characters. Only enough of the
 * real automaton to answer one question — "is a sequence open here?" — because
 * xterm.js is the parser that matters and this one only picks a cut point.
 */
type EscapeState = "ground" | "escape" | "csi" | "string" | "string-escape"

const ESC = "\u001b"

/**
 * The parser state after reading all of `text`.
 *
 * Deliberately not {@link scan}, which stops at the first return to ground
 * because its job is to strip one sequence's tail. Asking that function "where
 * does this chunk leave us?" reads only as far as the first close, so a chunk
 * that closed one sequence and then opened another reported `ground` — and the
 * caller skipped the repair, leaving the tail of a CSI at the head of the
 * replay. That is the exact garbage this parser exists to prevent, and it needs
 * only two dropped chunks in a row ending mid-sequence, which is ordinary for a
 * colourful TUI.
 */
function finalState(text: string, from: EscapeState): EscapeState {
  let state = from
  for (let index = 0; index < text.length; index++) {
    state = step(state, text.charAt(index))
  }
  return state
}

/**
 * Advance the parser over `text`, stopping the moment it returns to ground.
 * Returns that state and whatever is left after the stop, so one call both
 * reports "still inside a sequence" and strips a sequence's tail.
 */
function scan(text: string, from: EscapeState): { readonly state: EscapeState; readonly rest: string } {
  let state = from
  for (let index = 0; index < text.length; index++) {
    state = step(state, text.charAt(index))
    if (state === "ground" && from !== "ground") {
      return { state, rest: text.slice(index + 1) }
    }
  }
  return { state, rest: from === "ground" ? text : "" }
}

// fallow-ignore-next-line complexity -- a state-transition table written as a switch; splitting it would hide the automaton it is
function step(state: EscapeState, char: string): EscapeState {
  switch (state) {
    case "ground":
      return char === ESC ? "escape" : "ground"
    case "escape":
      if (char === "[") return "csi"
      // OSC, DCS, SOS, PM and APC all carry a payload terminated by ST (or, by
      // long convention for OSC, by BEL).
      if (char === "]" || char === "P" || char === "X" || char === "^" || char === "_") return "string"
      // Intermediate bytes (0x20-0x2F) come before the final byte of a
      // multi-character sequence such as `ESC ( B`; anything else is itself
      // the final byte of a two-character one.
      return char >= " " && char <= "/" ? "escape" : "ground"
    case "csi":
      // Parameter and intermediate bytes run 0x20-0x3F; the final byte, which
      // ends the sequence, is 0x40-0x7E.
      return char >= "@" && char <= "~" ? "ground" : "csi"
    case "string":
      if (char === "\u0007") return "ground"
      return char === ESC ? "string-escape" : "string"
    case "string-escape":
      // `ESC \` is ST. A bare ESC inside the payload is malformed, and the
      // lenient reading — stay in the string — is the one that does not eat
      // the rest of the buffer.
      return char === "\\" ? "ground" : "string"
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
  try {
    parentPort.postMessage(message)
  } catch {
    // Main is gone and took the channel with it. The `close` handler above is
    // already tearing the children down; there is nothing to report to and
    // nothing a throw from here could improve.
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
