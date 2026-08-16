import { describe, expect, it } from "vitest"
import type { AgentSessionEvent } from "@shared/types/AgentSessionEvent"
import { AgentEventBroker } from "../agent_event_broker"

function brokerWithSink() {
  const seen: AgentSessionEvent[] = []
  let tick = 0
  const broker = new AgentEventBroker({
    now: () => {
      tick += 1
      return `2026-08-11T00:00:0${String(tick)}.000Z`
    },
  })
  const unsubscribe = broker.subscribe((event) => void seen.push(event))
  return { broker, seen, unsubscribe }
}

describe("AgentEventBroker", () => {
  it("stamps a monotonic sequence per session, not globally", () => {
    const { broker, seen } = brokerWithSink()

    broker.publish({ kind: "agent.started", sessionId: "a", pid: 1 })
    broker.publish({ kind: "agent.started", sessionId: "b", pid: 2 })
    broker.publish({ kind: "agent.exited", sessionId: "a", exitCode: 0 })

    expect(seen.map((event) => [event.sessionId, event.seq])).toEqual([
      ["a", 1],
      ["b", 1],
      ["a", 2],
    ])
    expect(broker.getLatestSequence("a")).toBe(2)
    expect(broker.getLatestSequence("never-seen")).toBe(0)
  })

  /**
   * The race this exists for: killing a session makes the host report an exit,
   * and a host that dies mid-kill reports a failure. Both are terminal, and one
   * session settles once — otherwise the row's status depends on which message
   * lost.
   */
  it("publishes one terminal transition per session and drops the rest", () => {
    const { broker, seen } = brokerWithSink()

    broker.publish({ kind: "agent.started", sessionId: "a", pid: 1 })
    broker.publish({ kind: "agent.exited", sessionId: "a", exitCode: 0 })
    broker.publish({ kind: "agent.failed", sessionId: "a", message: "host died" })
    broker.publish({ kind: "agent.exited", sessionId: "a", exitCode: 1 })

    expect(seen.map((event) => event.kind)).toEqual(["agent.started", "agent.exited"])
    expect(broker.isTerminal("a")).toBe(true)
    expect(broker.isTerminal("b")).toBe(false)
  })

  /**
   * Activity is the one non-transition here, so the exactly-once rule above
   * does not cover it — nothing about "it printed something" is terminal. It
   * still has to stop at the end: a chunk the host was mid-way through
   * reporting when the child exited would otherwise arrive behind the exit and
   * tell every subscriber a finished agent is working.
   */
  it("delivers activity while a session lives and drops it after the end", () => {
    const { broker, seen } = brokerWithSink()

    broker.publish({ kind: "agent.started", sessionId: "a", pid: 1 })
    broker.publish({ kind: "agent.activity", sessionId: "a", busy: true })
    broker.publish({ kind: "agent.exited", sessionId: "a", exitCode: 0 })
    broker.publish({ kind: "agent.activity", sessionId: "a", busy: true })

    expect(seen.map((event) => event.kind)).toEqual([
      "agent.started",
      "agent.activity",
      "agent.exited",
    ])
  })

  /**
   * Resuming keeps the row, and therefore the session id. Without clearing the
   * terminal flag on a fresh start, the second run's exit would be swallowed as
   * a duplicate of the first's — leaving a finished agent showing as running for
   * as long as the app stays open.
   */
  it("lets a resumed session settle again under the same id", () => {
    const { broker, seen } = brokerWithSink()

    broker.publish({ kind: "agent.started", sessionId: "a", pid: 1 })
    broker.publish({ kind: "agent.exited", sessionId: "a", exitCode: 1 })
    expect(broker.isTerminal("a")).toBe(true)

    broker.publish({ kind: "agent.started", sessionId: "a", pid: 2 })
    expect(broker.isTerminal("a")).toBe(false)
    broker.publish({ kind: "agent.exited", sessionId: "a", exitCode: 0 })

    expect(seen.map((event) => event.kind)).toEqual([
      "agent.started",
      "agent.exited",
      "agent.started",
      "agent.exited",
    ])
    // Still exactly once per run: the duplicate rule is reset, not removed.
    broker.publish({ kind: "agent.failed", sessionId: "a", message: "host died" })
    expect(seen).toHaveLength(4)
  })

  it("keeps a throwing subscriber from starving the others", () => {
    const broker = new AgentEventBroker({ now: () => "2026-08-11T00:00:00.000Z" })
    const reached: string[] = []
    broker.subscribe(() => {
      throw new Error("this subscriber is broken")
    })
    broker.subscribe((event) => void reached.push(event.kind))

    expect(() => broker.publish({ kind: "agent.started", sessionId: "a", pid: 1 })).not.toThrow()
    expect(reached).toEqual(["agent.started"])
  })

  it("stops delivering after unsubscribe, idempotently", () => {
    const { broker, seen, unsubscribe } = brokerWithSink()

    unsubscribe()
    unsubscribe()
    broker.publish({ kind: "agent.started", sessionId: "a", pid: 1 })

    expect(seen).toHaveLength(0)
    // Still tracked, though: the sequence is the session's, not the listener's.
    expect(broker.getLatestSequence("a")).toBe(1)
  })

  it("evicts the oldest session past its tracking bound", () => {
    const broker = new AgentEventBroker({ now: () => "2026-08-11T00:00:00.000Z", maxTrackedSessions: 2 })

    broker.publish({ kind: "agent.exited", sessionId: "first", exitCode: 0 })
    broker.publish({ kind: "agent.started", sessionId: "second", pid: 2 })
    broker.publish({ kind: "agent.started", sessionId: "third", pid: 3 })

    // `first` was dropped, so its terminal state is forgotten along with it —
    // acceptable because it is terminal: nothing more will be published for it.
    expect(broker.isTerminal("first")).toBe(false)
    expect(broker.getLatestSequence("second")).toBe(1)
    expect(broker.getLatestSequence("third")).toBe(1)
  })
})
