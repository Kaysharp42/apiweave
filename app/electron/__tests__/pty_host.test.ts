import { beforeEach, describe, expect, it, vi } from "vitest"
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
  readonly sent: unknown[] = []

  on(event: string, listener: HostListener): void {
    // One module evaluation per test; each registers its own handler.
    if (event === "message") this.listener = listener
  }
  postMessage(message: unknown): void {
    this.sent.push(message)
  }
  dispatch(request: unknown, ports: unknown[] = []): void {
    this.listener?.({ data: request, ports })
  }
  reset(): void {
    this.listener = null
    this.sent.length = 0
  }
}

const parentPort = new FakeParentPort()

Object.defineProperty(process, "parentPort", {
  value: parentPort,
  writable: true,
  configurable: true,
})

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
  kill = (signal?: string): void => {
    this.kills.push(signal)
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

function spawnRequest(sessionId: string): PtySpawnRequest {
  return {
    sessionId,
    file: "/usr/local/bin/claude",
    args: ["--dangerously-skip-permissions"],
    cwd: "/src/shop-api",
    env: {},
    cols: 80,
    rows: 24,
  }
}

const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never)

function startSession(sessionId: string): FakePty {
  const pty = new FakePty()
  spawnMock.mockReturnValue(pty)
  parentPort.dispatch({ type: "spawn", ...spawnRequest(sessionId) })
  return pty
}

beforeEach(async () => {
  vi.resetModules()
  spawnMock.mockReset()
  parentPort.reset()
  exitSpy.mockClear()
  await import("../pty_host")
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
   * exit.
   */
  it("escalates to SIGKILL a child that ignores the polite kill, then exits on the deadline", async () => {
    vi.useFakeTimers()
    try {
      const pty = startSession("a")

      parentPort.dispatch({ type: "shutdown" })
      await vi.advanceTimersByTimeAsync(1_500)

      expect(pty.kills).toEqual([undefined, "SIGKILL"])
      expect(exitSpy).not.toHaveBeenCalled()

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
      expect(pty.kills).toEqual([undefined, "SIGKILL"])

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
  })
})
