import { describe, expect, it, vi } from "vitest"
import { BoundedEventBroker, type TrackedState } from "../bounded_event_broker"

interface TestEvent {
  readonly id: string
  readonly seq: number
  readonly ts: string
}

/**
 * The smallest concrete broker: an entry carries nothing but the shared
 * `TrackedState`, and `publish` is the shared stamp+fan-out surface.
 */
class TestBroker extends BoundedEventBroker<TestEvent, TrackedState> {
  publish(id: string): TestEvent {
    return this.publishStamped(this.ensure(id, () => ({ seq: 0, terminal: false })), { id })
  }
}

describe("BoundedEventBroker", () => {
  it("evicts the oldest entry once it reaches capacity", () => {
    let n = 0
    const broker = new TestBroker({ now: () => `t${++n}`, maxTracked: 2 })

    broker.publish("first")
    broker.publish("second")
    // At capacity, tracking a third entry evicts the oldest (insertion order).
    broker.publish("third")

    expect(broker.getLatestSequence("first")).toBe(0)
    expect(broker.isTerminal("first")).toBe(false)
    // The survivors keep their own sequences, independent of the eviction.
    expect(broker.getLatestSequence("second")).toBe(1)
    expect(broker.getLatestSequence("third")).toBe(1)
  })

  it("isolates a throwing subscriber from the others and from the publisher", () => {
    const broker = new TestBroker({ now: () => "t" })
    const good = vi.fn()
    broker.subscribe(() => {
      throw new Error("bad subscriber")
    })
    broker.subscribe(good)

    expect(() => broker.publish("a")).not.toThrow()
    expect(good).toHaveBeenCalledOnce()
    // The entry itself is unaffected: the stamp that reached the good
    // subscriber is the same one the publisher returns.
    const stamped = broker.publish("a")
    expect(stamped.seq).toBe(2)
    expect(broker.getLatestSequence("a")).toBe(2)
  })

  it("stamps a monotonic per-entry sequence and an ISO timestamp from the injected clock", () => {
    let n = 0
    const broker = new TestBroker({ now: () => `t${++n}` })
    const seen: TestEvent[] = []
    broker.subscribe((event) => seen.push(event))

    broker.publish("a")
    broker.publish("b")
    broker.publish("a")

    expect(seen.filter((e) => e.id === "a").map((e) => e.seq)).toEqual([1, 2])
    expect(seen.filter((e) => e.id === "b").map((e) => e.seq)).toEqual([1])
    expect(seen.map((e) => e.ts)).toEqual(["t1", "t2", "t3"])
  })
})
