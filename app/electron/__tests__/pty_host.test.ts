import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PtySpawnRequest } from "../../core/agents/pty_protocol"

/**
 * The host is a script, not a library: it binds `process.parentPort` and starts
 * listening at module scope, which is exactly why it can be loaded as an
 * Electron `utilityProcess` entry. Tests therefore import it the way it runs —
 * a fake parent port is installed first, then the module is evaluated fresh
 * per test (`vi.resetModules`) so no session or shutdown state leaks between
 * them.
 */

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock("node-pty", () => ({ spawn: spawnMock }))

type HostListener = (event: { data: unknown; ports: unknown[] }) => void

class FakeParentPort {
  listener: HostListener | null = null
  closeListener: (() => void) | null = null
  readonly sent: unknown[] = []

  on(event: string, listener: HostListener): void {
    // One module evaluation per test; each registers its own handler.
    if (event === "message") this.listener = listener
    if (event === "close") this.closeListener = listener as unknown as () => void
  }
  postMessage(message: unknown): void {
    this.sent.push(message)
  }
  dispatch(request: unknown, ports: unknown[] = []): void {
    this.listener?.({ data: request, ports })
  }
  /** Main died: Electron closes the child's end of the channel. */
  dispatchClose(): void {
    this.closeListener?.()
  }
  reset(): void {
    this.listener = null
    this.closeListener = null
    this.sent.length = 0
  }
}

const parentPort = new FakeParentPort()

Object.defineProperty(process, "parentPort", {
  value: parentPort,
  writable: true,
  configurable: true,
})

const REAL_PLATFORM = process.platform

/** node-pty's behaviour is platform-split, and so is the host's; both are exercised. */
function pretendPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
}

type ExitListener = (event: { exitCode: number; signal?: number }) => void
type DataListener = (data: string) => void

class FakePty {
  readonly kills: (string | undefined)[] = []
  /** Pause/resume calls, in order — the flow-control half of the host's contract. */
  readonly flow: ("pause" | "resume")[] = []
  readonly writes: string[] = []
  readonly resizes: { cols: number; rows: number }[] = []
  readonly pid = 4242
  private readonly dataListeners: DataListener[] = []
  private readonly exitListeners: ExitListener[] = []

  onData = (listener: DataListener): this => {
    this.dataListeners.push(listener)
    return this
  }
  onExit = (listener: ExitListener): this => {
    this.exitListeners.push(listener)
    return this
  }
  write = (data: string): void => {
    this.writes.push(data)
  }
  resize = (cols: number, rows: number): void => {
    this.resizes.push({ cols, rows })
  }
  pause = (): void => void this.flow.push("pause")
  resume = (): void => void this.flow.push("resume")
  /**
   * Faithful to node-pty, which is the whole point of this method.
   * `WindowsTerminal.prototype.kill` throws `Signals not supported on windows.`
   * for *any* signal argument (node-pty/lib/windowsTerminal.js) — from inside
   * its deferred queue, so on a terminal that is not ready yet the throw does
   * not even come back to the caller. A fake that quietly accepted a signal
   * would let the host ship a shutdown escalation that never escalates.
   */
  kill = (signal?: string): void => {
    this.kills.push(signal)
    if (process.platform === "win32" && signal !== undefined) {
      throw new Error("Signals not supported on windows.")
    }
  }
  emitExit(exitCode: number, signal?: number): void {
    for (const listener of this.exitListeners) listener({ exitCode, signal })
  }
  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data)
  }
}

/** The renderer's end of the output channel, as the host sees it. */
class FakeMessagePort {
  readonly posted: unknown[] = []
  closed = false
  postMessage = (message: unknown): void => void this.posted.push(message)
  close = (): void => {
    this.closed = true
  }
}

function spawnRequest(sessionId: string, sessionIdPattern: string | null = null): PtySpawnRequest {
  return {
    sessionId,
    file: "/usr/local/bin/claude",
    args: ["--dangerously-skip-permissions"],
    cwd: "/src/shop-api",
    env: {},
    cols: 80,
    rows: 24,
    sessionIdPattern,
  }
}

const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never)
const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true)
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

function startSession(sessionId: string, sessionIdPattern: string | null = null): FakePty {
  const pty = new FakePty()
  spawnMock.mockReturnValue(pty)
  parentPort.dispatch({ type: "spawn", ...spawnRequest(sessionId, sessionIdPattern) })
  return pty
}

type CrashListener = (payload: unknown) => void

const CRASH_EVENTS = ["uncaughtException", "unhandledRejection"] as const

function crashListeners(event: (typeof CRASH_EVENTS)[number]): CrashListener[] {
  return process.listeners(event) as unknown as CrashListener[]
}

/** The guards this evaluation of the host installed on the real process. */
let installedGuards: { event: (typeof CRASH_EVENTS)[number]; listener: CrashListener }[] = []

beforeEach(async () => {
  vi.resetModules()
  spawnMock.mockReset()
  parentPort.reset()
  exitSpy.mockClear()
  processKillSpy.mockClear()
  consoleErrorSpy.mockClear()
  pretendPlatform("linux")
  const before = new Map(CRASH_EVENTS.map((event) => [event, new Set(crashListeners(event))]))
  await import("../pty_host")
  installedGuards = CRASH_EVENTS.flatMap((event) =>
    crashListeners(event)
      .filter((listener) => before.get(event)?.has(listener) !== true)
      .map((listener) => ({ event, listener })),
  )
})

afterEach(() => {
  // Every test evaluates the module again, and every evaluation installs its
  // own crash guards on the one real `process`. Left behind they pile up past
  // Node's listener warning within this file alone.
  for (const { event, listener } of installedGuards) {
    process.off(event, listener as unknown as (...args: unknown[]) => void)
  }
  installedGuards = []
})

afterAll(() => {
  pretendPlatform(REAL_PLATFORM)
})

describe("pty host shutdown", () => {
  /**
   * `kill()` is a request, not a fact. Exiting in the same tick as the kill
   * would abandon a child that ignores SIGHUP — and would make the manager's
   * shutdown grace measure nothing. The host must stay up until every child
   * has actually reported its exit.
   */
  it("waits for every child to exit before exiting the host", () => {
    const first = startSession("a")
    const second = startSession("b")

    parentPort.dispatch({ type: "shutdown" })

    expect(first.kills).toEqual([undefined])
    expect(second.kills).toEqual([undefined])
    expect(exitSpy).not.toHaveBeenCalled()

    first.emitExit(0)
    expect(exitSpy).not.toHaveBeenCalled()

    second.emitExit(0)
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it("still delivers each child's exit to the manager before the host leaves", () => {
    const pty = startSession("a")

    parentPort.dispatch({ type: "shutdown" })
    pty.emitExit(1, 15)

    expect(parentPort.sent).toContainEqual({
      type: "exited",
      sessionId: "a",
      exitCode: 1,
      signal: 15,
    })
  })

  it("exits immediately when there is nothing live to wait for", () => {
    parentPort.dispatch({ type: "shutdown" })
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  /**
   * The polite kill is SIGHUP, which a process may ignore. SIGKILL cannot be:
   * a child that refuses to die is escalated rather than left running past app
   * quit, and the host still exits on a hard deadline if even that produces no
   * exit. The signal goes to the pid rather than through `IPty.kill`, which
   * swallows the failure of a child it cannot reach.
   */
  it("escalates to SIGKILL a child that ignores the polite kill, then exits on the deadline", async () => {
    vi.useFakeTimers()
    try {
      const pty = startSession("a")

      parentPort.dispatch({ type: "shutdown" })
      await vi.advanceTimersByTimeAsync(1_500)

      expect(pty.kills).toEqual([undefined])
      expect(processKillSpy).toHaveBeenCalledWith(4242, "SIGKILL")
      expect(exitSpy).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(250)
      expect(exitSpy).toHaveBeenCalledWith(0)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The Windows half of the same escalation, and the reason it is a separate
   * branch: node-pty throws on any signal there, from a deferred queue where
   * the throw can escape asynchronously and take the host — every other
   * session included — with it. The no-argument kill is already the hard one.
   */
  it("escalates on Windows without passing a signal node-pty would reject", async () => {
    vi.useFakeTimers()
    pretendPlatform("win32")
    try {
      const pty = startSession("a")

      parentPort.dispatch({ type: "shutdown" })
      await vi.advanceTimersByTimeAsync(1_500)

      expect(pty.kills).toEqual([undefined, undefined])
      expect(processKillSpy).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(250)
      expect(exitSpy).toHaveBeenCalledWith(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("exits as soon as the last straggler dies after escalation", async () => {
    vi.useFakeTimers()
    try {
      const pty = startSession("a")

      parentPort.dispatch({ type: "shutdown" })
      await vi.advanceTimersByTimeAsync(1_500)
      expect(processKillSpy).toHaveBeenCalledWith(4242, "SIGKILL")

      pty.emitExit(1)
      expect(exitSpy).toHaveBeenCalledWith(0)

      // The hard deadline was cancelled by the exit: it must not fire again.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(exitSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The kill pass runs once, at shutdown time. A spawn that arrives after it —
   * the race where the manager posted it before noticing the app is quitting —
   * would start a child nobody will ever stop, so it is refused instead.
   */
  it("refuses to start a child once shutdown has begun", () => {
    parentPort.dispatch({ type: "shutdown" })
    exitSpy.mockClear()

    parentPort.dispatch({ type: "spawn", ...spawnRequest("a") })

    expect(spawnMock).not.toHaveBeenCalled()
    expect(parentPort.sent).toContainEqual({
      type: "failed",
      sessionId: "a",
      message: "APIWeave is shutting down",
    })
  })

  /**
   * Main crashing is the case nobody asks for: no `shutdown` is coming, no
   * reply will ever be read, and these children are the user's agent processes
   * with no window showing them. Stranding a whole process tree per crash is
   * the one outcome that must not happen.
   */
  it("tears its children down when the parent port closes", () => {
    const pty = startSession("a")

    parentPort.dispatchClose()

    expect(pty.kills).toEqual([undefined])
    expect(exitSpy).not.toHaveBeenCalled()
    pty.emitExit(0)
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it("does not start a second escalation when the port closes during shutdown", async () => {
    vi.useFakeTimers()
    try {
      const pty = startSession("a")

      parentPort.dispatch({ type: "shutdown" })
      parentPort.dispatchClose()

      expect(pty.kills).toEqual([undefined])
      await vi.advanceTimersByTimeAsync(1_500)
      expect(processKillSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("pty host attach", () => {
  /**
   * Backpressure belongs to a consumer, and the previous one is gone the
   * moment a new terminal attaches — including the case where it crashed
   * without running its cleanup, so no `setPaused(false)` is ever coming.
   * The host must not hand a fresh terminal a PTY it left paused.
   */
  it("resumes a paused PTY when a new consumer attaches", () => {
    const pty = startSession("a")

    parentPort.dispatch({ type: "setPaused", sessionId: "a", paused: true })
    expect(pty.flow).toEqual(["pause"])

    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "a" }, [port])

    expect(pty.flow).toEqual(["pause", "resume"])
    expect(port.closed).toBe(false)
  })

  it("replays buffered output to the attaching consumer", () => {
    const pty = startSession("a")
    pty.emitData("first\r\n")
    pty.emitData("second\r\n")

    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "a" }, [port])

    expect(port.posted).toEqual([
      { kind: "output", sessionId: "a", data: "first\r\nsecond\r\n" },
    ])
  })

  it("closes a port handed for a session it does not know", () => {
    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "no-such-session" }, [port])
    expect(port.closed).toBe(true)
  })
})

describe("pty host activity", () => {
  function activity(): unknown[] {
    return parentPort.sent.filter(
      (message) => (message as { type?: string }).type === "activity",
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * The whole point of the message: a pid says a process exists, not whether it
   * is working. Only the host sees the bytes — output goes straight to the
   * renderer, and only for the one session a terminal is open on — so this is
   * the only place the list can learn that an agent has started printing.
   */
  it("reports a session as busy on its first output, and idle once it stops", () => {
    const pty = startSession("a")

    pty.emitData("thinking...")

    expect(activity()).toEqual([{ type: "activity", sessionId: "a", busy: true }])

    vi.advanceTimersByTime(1_500)

    expect(activity()).toEqual([
      { type: "activity", sessionId: "a", busy: true },
      { type: "activity", sessionId: "a", busy: false },
    ])
  })

  /**
   * Edges, not a sample. Output arrives in thousands of small chunks, and a
   * message per chunk would put main's event loop back in the terminal's path —
   * the thing the `MessagePort` exists to keep it out of.
   */
  it("says nothing more while a session keeps printing", () => {
    const pty = startSession("a")

    for (let index = 0; index < 50; index++) {
      pty.emitData(`line ${String(index)}\r\n`)
      vi.advanceTimersByTime(100)
    }

    expect(activity()).toEqual([{ type: "activity", sessionId: "a", busy: true }])
  })

  /**
   * A pause inside one burst of work — a model between tokens, a test runner
   * between files — must not read as the agent having finished and gone quiet.
   */
  it("restarts the quiet clock on every chunk", () => {
    const pty = startSession("a")

    pty.emitData("first")
    vi.advanceTimersByTime(1_400)
    pty.emitData("second")
    vi.advanceTimersByTime(1_400)

    expect(activity()).toEqual([{ type: "activity", sessionId: "a", busy: true }])

    vi.advanceTimersByTime(100)

    expect(activity()).toHaveLength(2)
  })

  /**
   * The exit is the same news and outranks it. A busy flag landing after the
   * exit is exactly what would leave a finished row claiming the agent is still
   * typing — and the pending timer must not outlive the child either.
   */
  it("stops reporting activity once the child has exited", () => {
    const pty = startSession("a")
    pty.emitData("working")
    const before = activity().length

    pty.emitExit(0)
    vi.advanceTimersByTime(5_000)

    expect(activity()).toHaveLength(before)
  })
})

describe("pty host session id scanning", () => {
  const OPENCODE = "ses_[A-Za-z0-9]{16,}"
  /** Codex's id is a bare UUID, so its pattern anchors on text and captures. */
  const CODEX = "(?:codex resume |Session ID: )([0-9a-fA-F-]{36})"

  function refs(): unknown[] {
    return parentPort.sent.filter((message) => (message as { type?: string }).type === "sessionRef")
  }

  it("reports the agent's own session id when it appears in the output", () => {
    const pty = startSession("a", OPENCODE)

    pty.emitData("Continue  opencode -s ses_ff4aa6205ffehzvZgEfg3vHXmc\r\n")

    expect(refs()).toEqual([{ type: "sessionRef", sessionId: "a", ref: "ses_ff4aa6205ffehzvZgEfg3vHXmc" }])
  })

  /**
   * The OS splits reads wherever it likes, and an id landing across that seam is
   * not exotic — it is what happens whenever the id sits near the end of a
   * write. Scanning each chunk in isolation would miss exactly those.
   */
  it("finds an id split across two chunks", () => {
    const pty = startSession("a", OPENCODE)

    pty.emitData("Continue  opencode -s ses_ff4aa620")
    expect(refs()).toEqual([])
    pty.emitData("5ffehzvZgEfg3vHXmc\r\n")

    expect(refs()).toEqual([{ type: "sessionRef", sessionId: "a", ref: "ses_ff4aa6205ffehzvZgEfg3vHXmc" }])
  })

  /**
   * The id is what the pattern captures, not the sentence it was found in.
   * Without this, an agent whose id is a bare UUID cannot be matched safely at
   * all: the anchor text has to be part of the pattern and out of the result.
   */
  it("takes the capture group when the pattern has one", () => {
    const pty = startSession("a", CODEX)

    pty.emitData("To continue this session, run codex resume 123e4567-e89b-12d3-a456-426614174000\r\n")

    expect(refs()).toEqual([
      { type: "sessionRef", sessionId: "a", ref: "123e4567-e89b-12d3-a456-426614174000" },
    ])
  })

  /**
   * A session's output is arbitrary text — an agent asked about its own history
   * prints other sessions' ids, and nothing distinguishes those from its own
   * after the fact. First match wins, and the scan then stops entirely.
   */
  it("reports one id per session and stops looking", () => {
    const pty = startSession("a", OPENCODE)

    pty.emitData("ses_aaaaaaaaaaaaaaaaaa\r\n")
    pty.emitData("ses_bbbbbbbbbbbbbbbbbb\r\n")
    pty.emitData("ses_cccccccccccccccccc\r\n")

    expect(refs()).toEqual([{ type: "sessionRef", sessionId: "a", ref: "ses_aaaaaaaaaaaaaaaaaa" }])
  })

  it("scans nothing for an agent with no pattern", () => {
    const pty = startSession("a")

    pty.emitData("Continue  opencode -s ses_ff4aa6205ffehzvZgEfg3vHXmc\r\n")

    expect(refs()).toEqual([])
  })

  /**
   * Definitions are user-editable, so the pattern is untrusted input and
   * `new RegExp` throws on a bad one. Thrown here it would take down every
   * unrelated session's PTY — the exact blast radius this process exists to
   * contain.
   */
  it("survives a pattern that will not compile", () => {
    const pty = startSession("a", "ses_([A-Za-z")

    expect(() => pty.emitData("ses_anything\r\n")).not.toThrow()
    expect(refs()).toEqual([])
    // The session is otherwise entirely usable.
    parentPort.dispatch({ type: "write", sessionId: "a", data: "hello" })
    expect(pty.writes).toEqual(["hello"])
  })
})

describe("pty host respawning under a session id it already holds", () => {
  /**
   * Resuming runs a conversation again in the row it is already in, so the same
   * id comes back with a new process behind it. The entry being replaced holds a
   * live port to a terminal that is about to be shown the new process; dropping
   * it silently would leave that terminal reading a channel nothing writes to.
   */
  it("closes the previous session's port", () => {
    startSession("a")
    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "a" }, [port])

    startSession("a")

    expect(port.closed).toBe(true)
  })

  it("routes output to the new process, not the old one", () => {
    const first = startSession("a")
    const second = startSession("a")
    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "a" }, [port])

    first.emitData("from the run that ended")
    second.emitData("from the resumed run")

    expect(port.posted).toEqual([{ kind: "output", sessionId: "a", data: "from the resumed run" }])
  })

  it("sends keystrokes to the new process", () => {
    const first = startSession("a")
    const second = startSession("a")

    parentPort.dispatch({ type: "write", sessionId: "a", data: "hello" })

    expect(first.writes).toEqual([])
    expect(second.writes).toEqual(["hello"])
  })

  /**
   * A resume racing a process that never actually died. Leaving it running would
   * strand a child with no entry naming it — nothing could then stop it, not
   * even shutdown, which walks the session map.
   */
  it("kills a previous process that is somehow still alive", () => {
    const first = startSession("a")

    startSession("a")

    expect(first.kills).toEqual([undefined])
  })

  it("does not kill a previous process that had already exited", () => {
    const first = startSession("a")
    first.emitExit(0)

    startSession("a")

    expect(first.kills).toEqual([])
  })

  /** The replay belongs to the process that produced it, and that process is gone. */
  it("starts the new run with an empty replay", () => {
    const first = startSession("a")
    first.emitData("output from the first run")

    startSession("a")
    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "a" }, [port])

    expect(port.posted).toEqual([])
  })
})

describe("pty host title scanning", () => {
  function titles(): unknown[] {
    return parentPort.sent.filter((message) => (message as { type?: string }).type === "title")
  }

  it("reads the title an agent sets, whichever terminator it uses", () => {
    const pty = startSession("a")

    pty.emitData("\u001b]0;Fix the failing auth test\u0007")
    pty.emitData("\u001b]2;Now writing the migration\u001b\\")

    expect(titles()).toEqual([
      { type: "title", sessionId: "a", title: "Fix the failing auth test" },
      { type: "title", sessionId: "a", title: "Now writing the migration" },
    ])
  })

  /** TUIs re-set the same title on every repaint; only changes are news. */
  it("reports a title once, however often it is repainted", () => {
    const pty = startSession("a")

    pty.emitData("\u001b]0;Fix the failing auth test\u0007")
    pty.emitData("\u001b]0;Fix the failing auth test\u0007")
    pty.emitData("\u001b]0;Fix the failing auth test\u0007")

    expect(titles()).toHaveLength(1)
  })

  it("reassembles a title split across chunks", () => {
    const pty = startSession("a")

    pty.emitData("\u001b]0;Fix the fail")
    expect(titles()).toEqual([])
    pty.emitData("ing auth test\u0007")

    expect(titles()).toEqual([{ type: "title", sessionId: "a", title: "Fix the failing auth test" }])
  })

  /**
   * OSC carries far more than titles — colour queries, hyperlinks, clipboard
   * writes. Only 0 and 2 are the window title, and treating the rest as one
   * would put a colour probe in the session list.
   */
  it("ignores OSC sequences that are not a title", () => {
    const pty = startSession("a")

    pty.emitData("\u001b]11;?\u0007")
    pty.emitData("\u001b]4;0;?\u0007")
    pty.emitData("\u001b]8;;https://example.com\u0007")

    expect(titles()).toEqual([])
  })

  /** Clearing the title is what a TUI does on the way out. It is not a name. */
  it("does not report an empty title", () => {
    const pty = startSession("a")

    pty.emitData("\u001b]0;\u0007")

    expect(titles()).toEqual([])
  })

  /**
   * An OSC nobody terminates — truncated output, a confused TUI — must not grow
   * a buffer for the life of the session. It is abandoned, and the next real
   * sequence still lands.
   */
  it("abandons an unterminated OSC instead of buffering for ever", () => {
    const pty = startSession("a")

    pty.emitData(`\u001b]0;${"x".repeat(4_000)}`)
    expect(titles()).toEqual([])

    pty.emitData("\u001b]0;A real title\u0007")

    expect(titles()).toEqual([{ type: "title", sessionId: "a", title: "A real title" }])
  })

  /** The title travels inside ordinary output, and must not disturb it. */
  it("still forwards the output the title was embedded in", () => {
    const pty = startSession("a")
    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "a" }, [port])

    pty.emitData("before\u001b]0;A title\u0007after")

    expect(port.posted).toEqual([
      { kind: "output", sessionId: "a", data: "before\u001b]0;A title\u0007after" },
    ])
  })
})

describe("pty host replay bounds", () => {
  /**
   * The replay exists so a late-mounting terminal is not blank, and a byte
   * budget — not a chunk count — is what keeps a long-running session from
   * eating the renderer's heap. When the budget trips, the oldest output goes
   * first: a terminal attaching late most wants the tail, and the oldest is
   * the most likely to have scrolled off anyway.
   */
  it("drops the oldest output first once the byte budget is exceeded", () => {
    const pty = startSession("a")
    const dropped = "x".repeat(200 * 1024)
    const kept = "y".repeat(100 * 1024)
    pty.emitData(dropped)
    pty.emitData(kept)

    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "a" }, [port])

    expect(port.posted).toEqual([{ kind: "output", sessionId: "a", data: kept }])
  })

  /**
   * The budget is in bytes and the buffer is JavaScript strings, where
   * `.length` counts UTF-16 code units. An agent printing a progress bar of
   * box-drawing characters, or any non-Latin output, would otherwise hold up
   * to three times the memory the bound promises.
   */
  it("measures the budget in bytes, not in code units", () => {
    const pty = startSession("a")
    // 100K three-byte characters: comfortably under the budget by `.length`,
    // comfortably over it by encoded size.
    pty.emitData("€".repeat(100 * 1024))
    pty.emitData("tail")

    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "a" }, [port])

    expect(port.posted).toEqual([{ kind: "output", sessionId: "a", data: "tail" }])
  })

  /**
   * A chunk boundary is wherever the OS split the read, which is routinely the
   * middle of an escape sequence. Replaying from there hands xterm.js the tail
   * of a sequence it never saw open — printed as garbage, or worse, leaving
   * the parser eating the next screenful as parameters.
   */
  it("does not begin a replay in the middle of an escape sequence", () => {
    const esc = String.fromCharCode(27)
    const pty = startSession("a")
    // Ends mid-CSI: the terminator is in the next chunk.
    pty.emitData("A".repeat(256 * 1024) + esc + "[3")
    pty.emitData(`1mred${esc}[0m done`)

    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "a" }, [port])

    expect(port.posted).toEqual([
      { kind: "output", sessionId: "a", data: `red${esc}[0m done` },
    ])
  })

  /**
   * The prune pass keeps only the most recent finished sessions. A session
   * main still advertises as reopenable must not open as a silent, blank
   * terminal, so every drop is announced, and a late attach to a dropped
   * session is refused at the port.
   */
  it("prunes the oldest finished sessions beyond the retention cap and announces each drop", () => {
    for (let i = 0; i < 21; i++) {
      startSession(`session-${i}`).emitExit(0)
    }

    expect(parentPort.sent).toContainEqual({ type: "pruned", sessionId: "session-0" })
    expect(parentPort.sent).not.toContainEqual({ type: "pruned", sessionId: "session-20" })

    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "session-0" }, [port])
    expect(port.closed).toBe(true)
  })

  /**
   * Retention is "the most recent finished sessions", and the session map is
   * in spawn order. The terminal opened first and closed last — the one the
   * user has been living in all day — is precisely the one spawn order would
   * evict first.
   */
  it("prunes by when a session exited, not by when it started", () => {
    const ptys = new Map<string, FakePty>()
    for (let i = 0; i < 21; i++) {
      ptys.set(`session-${i}`, startSession(`session-${i}`))
    }
    // The first-spawned session is the last to finish.
    for (let i = 1; i < 21; i++) {
      ptys.get(`session-${i}`)?.emitExit(0)
    }
    ptys.get("session-0")?.emitExit(0)

    expect(parentPort.sent).toContainEqual({ type: "pruned", sessionId: "session-1" })
    expect(parentPort.sent).not.toContainEqual({ type: "pruned", sessionId: "session-0" })
  })

  /**
   * A terminal may still be attached to a finished session — retaining the
   * scrollback is what that terminal is for. Closing its port without a word
   * would leave the user staring at a pane that stopped for no visible reason,
   * indistinguishable from a hung agent.
   *
   * Announced as its own event rather than as terminal text: the wording is UI,
   * and the renderer owns it. This asserts the host says *that* it happened and
   * says it before the port goes, which is the part the renderer cannot recover
   * on its own.
   */
  it("tells a terminal still attached to a pruned session why it is going quiet", () => {
    const victim = startSession("victim")
    const port = new FakeMessagePort()
    parentPort.dispatch({ type: "attach", sessionId: "victim" }, [port])
    victim.emitExit(0)
    for (let i = 0; i < 20; i++) {
      startSession(`session-${i}`).emitExit(0)
    }

    const last = port.posted.at(-1) as { kind: string; sessionId: string }
    expect(last.kind).toBe("replayReleased")
    expect(last.sessionId).toBe("victim")
    expect(port.closed).toBe(true)
  })
})

describe("pty host environment", () => {
  function envOfLastSpawn(): Record<string, string> {
    const options = spawnMock.mock.calls.at(-1)?.[2] as { env: Record<string, string> }
    return options.env
  }

  /**
   * Windows environment variables are case-insensitive, so `PATH` inherited
   * from the host and a `Path` override are the same variable — but a plain
   * object spread puts both in the block, and which one the child reads is
   * undefined. A PATH override that silently does not take effect is exactly
   * how an agent CLI ends up running the wrong interpreter.
   */
  // A variable of our own rather than PATH itself: `process.env` is *already*
  // case-insensitive on a Windows test runner, which would decide the outcome
  // before the code under test ever saw it.
  const INHERITED = "APIWEAVE_TEST_PATH"
  const OVERRIDDEN = "ApiWeave_Test_Path"

  it("merges an override over an inherited variable of different case on Windows", () => {
    pretendPlatform("win32")
    vi.stubEnv(INHERITED, "C:\\inherited")
    try {
      spawnMock.mockReturnValue(new FakePty())
      parentPort.dispatch({
        type: "spawn",
        ...spawnRequest("a"),
        env: { [OVERRIDDEN]: "C:\\override" },
      })

      const env = envOfLastSpawn()
      const keys = Object.keys(env).filter((key) => key.toUpperCase() === INHERITED)
      expect(keys).toHaveLength(1)
      expect(env[keys[0] as string]).toBe("C:\\override")
    } finally {
      vi.unstubAllEnvs()
    }
  })

  /** POSIX environments really are case-sensitive; folding there would invent a bug. */
  it("keeps variables of different case distinct on POSIX", () => {
    vi.stubEnv(INHERITED, "/usr/bin")
    try {
      spawnMock.mockReturnValue(new FakePty())
      parentPort.dispatch({
        type: "spawn",
        ...spawnRequest("a"),
        env: { [OVERRIDDEN]: "/somewhere/else" },
      })

      const env = envOfLastSpawn()
      expect(env[INHERITED]).toBe("/usr/bin")
      expect(env[OVERRIDDEN]).toBe("/somewhere/else")
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe("pty host guards", () => {
  it("ignores writes to a session that has exited", () => {
    const pty = startSession("a")
    pty.emitExit(0)

    parentPort.dispatch({ type: "write", sessionId: "a", data: "echo hi" })

    expect(pty.writes).toEqual([])
  })

  it("ignores writes to an unknown session", () => {
    parentPort.dispatch({ type: "write", sessionId: "no-such-session", data: "echo hi" })
    // A no-op, not a crash: nothing is told, and the host keeps dispatching.
    expect(parentPort.sent).toEqual([])
    startSession("a").emitExit(0)
    expect(parentPort.sent).toContainEqual({ type: "exited", sessionId: "a", exitCode: 0, signal: null })
  })

  it("refuses a degenerate resize an unmounted xterm would report", () => {
    const pty = startSession("a")

    parentPort.dispatch({ type: "resize", sessionId: "a", cols: 0, rows: 24 })
    parentPort.dispatch({ type: "resize", sessionId: "a", cols: 80, rows: 0 })
    parentPort.dispatch({ type: "resize", sessionId: "a", cols: -1, rows: -1 })

    expect(pty.resizes).toEqual([])
  })

  it("answers a failed spawn without bringing down the other sessions", () => {
    const alive = startSession("alive")
    spawnMock.mockImplementationOnce(() => {
      throw new Error("boom")
    })

    parentPort.dispatch({ type: "spawn", ...spawnRequest("broken") })

    expect(parentPort.sent).toContainEqual({
      type: "failed",
      sessionId: "broken",
      message: "boom",
    })
    // The host's one dispatch try/catch kept the live session untouched.
    parentPort.dispatch({ type: "write", sessionId: "alive", data: "still here" })
    expect(alive.writes).toEqual(["still here"])
    // And nothing was killed: there is no child behind a spawn that threw.
    expect(alive.kills).toEqual([])
  })

  /**
   * `failed` is terminal for the row main keeps: it drops the session from the
   * live set, writes the row, and unlinks the scratch files named after it —
   * including the MCP config holding a live bearer token. Reporting it for a
   * session whose child is still running therefore orphaned that child: the
   * Stop button goes with the live flag, the terminal can no longer attach, and
   * the real exit arrives to a row the terminal-status pin has already closed.
   * Whatever the failure was, the session has to actually be over.
   */
  it("kills the child when it reports a live session as failed", () => {
    const pty = startSession("a")
    pty.write = (): void => {
      throw new Error("write EPIPE")
    }

    parentPort.dispatch({ type: "write", sessionId: "a", data: "hello" })

    expect(parentPort.sent).toContainEqual({
      type: "failed",
      sessionId: "a",
      message: "write EPIPE",
    })
    // The no-argument form: the polite kill, which is all a single abandoned
    // session gets. SIGKILL escalation belongs to shutdown.
    expect(pty.kills).toEqual([undefined])
  })

  /**
   * node-pty's callbacks run straight off the event loop, so a throw inside
   * one is an uncaught exception — which, unguarded, ends the host and every
   * unrelated session's PTY with it. The blast radius has to be one session.
   */
  it("fails only its own session when a data callback throws", () => {
    const alive = startSession("alive")
    const broken = startSession("broken")

    // Not a string: the replay cannot account for it, and the accounting is
    // the first thing the callback does.
    expect(() => broken.emitData(7 as unknown as string)).not.toThrow()

    expect(parentPort.sent.some((message) => {
      const reply = message as { type?: string; sessionId?: string }
      return reply.type === "failed" && reply.sessionId === "broken"
    })).toBe(true)
    parentPort.dispatch({ type: "write", sessionId: "alive", data: "still here" })
    expect(alive.writes).toEqual(["still here"])
  })

  /**
   * The last resort for a throw nothing can attribute — node-pty defers calls
   * made before its terminal is ready and runs them later, so the throw
   * arrives from a timer with no session attached to it. Surviving is the
   * whole reason the PTY host is a process of its own.
   */
  it("survives an exception that reaches the event loop", () => {
    const pty = startSession("a")

    const listener = installedGuards.find((guard) => guard.event === "uncaughtException")
    expect(listener).toBeDefined()
    listener?.listener(new Error("Signals not supported on windows."))

    expect(exitSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    parentPort.dispatch({ type: "write", sessionId: "a", data: "still here" })
    expect(pty.writes).toEqual(["still here"])
  })
})
