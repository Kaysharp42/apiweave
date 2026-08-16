import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "@shared/types/AgentSessionEvent"
import type { PtyHostReply, PtySpawnRequest } from "../../core/agents/pty_protocol"
import { AgentProcessManager } from "../agent_process_manager"

/**
 * A stand-in for the forked `utilityProcess`, recording what main sent it and
 * letting a test play the host's replies back. Everything interesting about this
 * class is how it behaves when the host says something unexpected — or stops
 * saying anything at all — so the host is the thing worth faking.
 */
class FakeHost {
  public readonly posted: { readonly message: unknown; readonly transfer: unknown[] }[] = []
  public killed = false
  private readonly listeners = new Map<string, ((payload: never) => void)[]>()

  on(event: string, listener: (payload: never) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }
  once(event: string, listener: (payload: never) => void): this {
    return this.on(event, listener)
  }
  postMessage(message: unknown, transfer: unknown[] = []): void {
    this.posted.push({ message, transfer })
  }
  kill(): boolean {
    this.killed = true
    return true
  }

  /** Play a host → main message. */
  reply(message: PtyHostReply): void {
    for (const listener of this.listeners.get("message") ?? []) {
      ;(listener as (payload: PtyHostReply) => void)(message)
    }
  }
  /** Play the host dying. */
  exit(code: number): void {
    for (const listener of this.listeners.get("exit") ?? []) {
      ;(listener as (payload: number) => void)(code)
    }
  }
  sent<T>(index: number): T {
    return this.posted[index]?.message as T
  }
}

let hosts: FakeHost[] = []
const closedPorts: string[] = []

vi.mock("electron", () => ({
  utilityProcess: {
    fork: () => {
      const host = new FakeHost()
      hosts.push(host)
      return host
    },
  },
  MessageChannelMain: class {
    port1 = { close: () => void closedPorts.push("port1") }
    port2 = { close: () => void closedPorts.push("port2") }
  },
}))

function spawnRequest(sessionId: string): PtySpawnRequest {
  return {
    sessionId,
    file: "/usr/local/bin/claude",
    args: [],
    cwd: "/src/shop-api",
    env: {},
    cols: 80,
    rows: 24,
  }
}

function managerWithSink() {
  const events: AgentEvent[] = []
  const manager = new AgentProcessManager({
    hostEntryPath: "/dist/desktop/pty-host.cjs",
    onEvent: (event) => void events.push(event),
  })
  return { manager, events }
}

beforeEach(() => {
  hosts = []
  closedPorts.length = 0
})

describe("AgentProcessManager", () => {
  it("forks one host for every session, not one per session", async () => {
    const { manager } = managerWithSink()

    const first = manager.start(spawnRequest("a"))
    const second = manager.start(spawnRequest("b"))
    hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
    hosts[0]?.reply({ type: "spawned", sessionId: "b", pid: 12 })

    await expect(first).resolves.toBe(11)
    await expect(second).resolves.toBe(12)
    expect(hosts).toHaveLength(1)
    expect(manager.liveSessionIds()).toEqual(["a", "b"])
  })

  it("rejects the launch that failed, and only that one", async () => {
    const { manager, events } = managerWithSink()

    const failing = manager.start(spawnRequest("a"))
    const fine = manager.start(spawnRequest("b"))
    hosts[0]?.reply({ type: "failed", sessionId: "a", message: "claude was not found on PATH" })
    hosts[0]?.reply({ type: "spawned", sessionId: "b", pid: 12 })

    await expect(failing).rejects.toThrow(/not found on PATH/)
    await expect(fine).resolves.toBe(12)
    // The rejection is the report. Publishing it as well would write the same
    // failure onto the session row twice, in two different wordings.
    expect(events.filter((event) => event.kind === "agent.failed")).toHaveLength(0)
    expect(manager.isLive("a")).toBe(false)
  })

  it("publishes an exit once the session is running", async () => {
    const { manager, events } = managerWithSink()

    const started = manager.start(spawnRequest("a"))
    hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
    await started
    hosts[0]?.reply({ type: "exited", sessionId: "a", exitCode: 130, signal: null })

    expect(events).toEqual([
      { kind: "agent.started", sessionId: "a", pid: 11 },
      { kind: "agent.exited", sessionId: "a", exitCode: 130 },
    ])
    expect(manager.liveSessionIds()).toEqual([])
  })

  /**
   * A native crash in node-pty takes the host with it. Every session it held is
   * now a process APIWeave cannot see, so each is reported failed — the
   * alternative is rows that claim to be running for ever.
   */
  it("fails every live session when the host dies under them", async () => {
    const { manager, events } = managerWithSink()

    const started = manager.start(spawnRequest("a"))
    hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
    await started
    const pendingWhenItDied = manager.start(spawnRequest("b"))
    // The assertion is attached before the host dies, not after: the rejection
    // is synchronous with `exit`, and a rejection with no handler yet is an
    // unhandled rejection that fails the run.
    const rejects = expect(pendingWhenItDied).rejects.toThrow(/stopped unexpectedly/)
    hosts[0]?.exit(3221226505)
    await rejects
    expect(events.at(-1)).toEqual({
      kind: "agent.failed",
      sessionId: "a",
      message: "The terminal backend stopped unexpectedly (exit 3221226505)",
    })
    expect(manager.liveSessionIds()).toEqual([])
  })

  it("forks a fresh host for the next launch after a crash", async () => {
    const { manager } = managerWithSink()

    const first = manager.start(spawnRequest("a"))
    const rejects = expect(first).rejects.toThrow(/stopped unexpectedly/)
    hosts[0]?.exit(1)
    await rejects

    const second = manager.start(spawnRequest("b"))
    hosts[1]?.reply({ type: "spawned", sessionId: "b", pid: 22 })

    await expect(second).resolves.toBe(22)
    expect(hosts).toHaveLength(2)
  })

  it("attaches only to a session with a process behind it", async () => {
    const { manager } = managerWithSink()

    expect(manager.attach("a")).toBeNull()

    const started = manager.start(spawnRequest("a"))
    hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
    await started

    expect(manager.attach("a")).not.toBeNull()
    // One end to the host with the request, the other returned for the renderer.
    expect(hosts[0]?.sent<{ type: string }>(1).type).toBe("attach")
    expect(hosts[0]?.posted[1]?.transfer).toHaveLength(1)
  })

  /**
   * An exited session's replay is the reason to reopen it: the user most wants
   * to read why the agent stopped. The host retains the buffer, so attach keeps
   * serving it — until the host announces the replay is gone, at which point
   * advertising an openable session would open as a silent, blank terminal.
   */
  it("keeps an exited session attachable until the host prunes its replay", async () => {
    const { manager } = managerWithSink()

    const started = manager.start(spawnRequest("a"))
    hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
    await started
    hosts[0]?.reply({ type: "exited", sessionId: "a", exitCode: 130, signal: null })

    expect(manager.isLive("a")).toBe(false)
    expect(manager.canAttach("a")).toBe(true)
    expect(manager.attach("a")).not.toBeNull()

    hosts[0]?.reply({ type: "pruned", sessionId: "a" })
    expect(manager.canAttach("a")).toBe(false)
    expect(manager.attach("a")).toBeNull()
  })

  /**
   * The replay buffers live in the host, so a host death takes them with it.
   * A retained session that outlived its host must not be advertised as
   * reopenable — there is nothing left to show.
   */
  it("forgets retained replays when the host dies with them", async () => {
    const { manager } = managerWithSink()

    const started = manager.start(spawnRequest("a"))
    hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
    await started
    hosts[0]?.reply({ type: "exited", sessionId: "a", exitCode: 0, signal: null })
    expect(manager.canAttach("a")).toBe(true)

    hosts[0]?.exit(1)
    expect(manager.canAttach("a")).toBe(false)
  })

  /**
   * The children belong to the host, so killing the host first would leave the
   * user's agent processes running with nothing attached to them. It is asked to
   * stop, and only killed if it will not.
   */
  it("asks the host to shut down before killing it", async () => {
    const { manager } = managerWithSink()
    const started = manager.start(spawnRequest("a"))
    hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
    await started

    const disposal = manager.dispose()
    expect(hosts[0]?.sent<{ type: string }>(1).type).toBe("shutdown")
    expect(hosts[0]?.killed).toBe(false)
    hosts[0]?.exit(0)
    await disposal

    expect(hosts[0]?.killed).toBe(false)
    expect(manager.liveSessionIds()).toEqual([])
  })

  it("kills a host that will not stop, after the grace period", async () => {
    vi.useFakeTimers()
    try {
      const { manager } = managerWithSink()
      const started = manager.start(spawnRequest("a"))
      hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
      await started

      const disposal = manager.dispose()
      await vi.advanceTimersByTimeAsync(2_000)
      await disposal

      expect(hosts[0]?.killed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The failure mode this timeout exists for is node-pty blocking for ever on
   * `ConnectNamedPipe` when its Windows conout worker cannot load — a silent
   * hang, with no error and no exit. A rejection is what makes it legible.
   */
  it("gives up on a spawn that never answers", async () => {
    vi.useFakeTimers()
    try {
      const { manager } = managerWithSink()
      const started = manager.start(spawnRequest("a"))
      const rejects = expect(started).rejects.toThrow(/did not start/)
      await vi.advanceTimersByTimeAsync(10_000)
      await rejects
      expect(manager.isLive("a")).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The row said failed the moment the timeout rejection was recorded. A spawn
   * that completes late is a real PTY, but nobody is waiting on it any more:
   * publishing `agent.started` would flip the row back to running and leave the
   * process alive with no terminal attached. It is killed, and its exit is not
   * published either — that would overwrite the failure with an exit code.
   */
  it("kills a spawn that reports back after the timeout instead of starting it", async () => {
    vi.useFakeTimers()
    try {
      const { manager, events } = managerWithSink()
      const started = manager.start(spawnRequest("a"))
      const rejects = expect(started).rejects.toThrow(/did not start/)
      await vi.advanceTimersByTimeAsync(10_000)
      await rejects

      hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
      expect(manager.isLive("a")).toBe(false)
      expect(hosts[0]?.sent<{ type: string }>(1)).toEqual({ type: "kill", sessionId: "a" })
      expect(events).toEqual([])

      hosts[0]?.reply({ type: "exited", sessionId: "a", exitCode: 1, signal: null })
      expect(events).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The twin of the late `spawned`: a spawn that throws after the timeout. The
   * row already carries the timeout failure, and publishing the host's wording
   * would record the same failure twice.
   */
  it("does not publish a second failure when a timed-out spawn fails late", async () => {
    vi.useFakeTimers()
    try {
      const { manager, events } = managerWithSink()
      const started = manager.start(spawnRequest("a"))
      const rejects = expect(started).rejects.toThrow(/did not start/)
      await vi.advanceTimersByTimeAsync(10_000)
      await rejects

      hosts[0]?.reply({ type: "failed", sessionId: "a", message: "claude was not found on PATH" })
      expect(events).toEqual([])
      expect(manager.isLive("a")).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * Shutting down while a spawn is in flight is the same race as the timeout:
   * the rejection fails the row, so the host reporting back while it stops must
   * not resurrect it. No `agent.started` is published, and nothing else either —
   * the host's exit is swallowed because the app is going away.
   */
  it("does not start a pending session that reports back during shutdown", async () => {
    const { manager, events } = managerWithSink()
    const started = manager.start(spawnRequest("a"))
    const rejects = expect(started).rejects.toThrow(/shutting down/)
    const disposal = manager.dispose()
    hosts[0]?.reply({ type: "spawned", sessionId: "a", pid: 11 })
    await rejects
    hosts[0]?.exit(0)
    await disposal

    expect(events).toEqual([])
    expect(manager.isLive("a")).toBe(false)
  })

  it("refuses to start anything once disposed", async () => {
    const { manager } = managerWithSink()
    await manager.dispose()

    await expect(manager.start(spawnRequest("a"))).rejects.toThrow(/shutting down/)
    expect(hosts).toHaveLength(0)
  })
})
