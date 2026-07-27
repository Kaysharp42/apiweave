import { describe, expect, it, vi } from "vitest"
import { RunEventBroker } from "../run_event_broker"
import type { RunEvent, RunProgressEvent } from "@shared/types/RunProgressEvent"

const node = (runId: string, nodeId: string): RunEvent => ({
  kind: "node.status",
  runId,
  nodeId,
  status: "passed",
  variables: {},
})

describe("RunEventBroker", () => {
  it("stamps a monotonic per-run sequence and timestamp", () => {
    let n = 0
    const broker = new RunEventBroker({ now: () => `t${++n}` })
    const seen: RunProgressEvent[] = []
    broker.subscribe((e) => seen.push(e))

    broker.publish("r1", { kind: "run.started", runId: "r1" })
    broker.publish("r1", node("r1", "a"))
    broker.publish("r2", { kind: "run.started", runId: "r2" })
    broker.publish("r1", node("r1", "b"))

    const r1 = seen.filter((e) => e.runId === "r1")
    expect(r1.map((e) => e.seq)).toEqual([1, 2, 3]) // sequence is per-run
    expect(seen.filter((e) => e.runId === "r2").map((e) => e.seq)).toEqual([1])
    expect(r1.every((e) => typeof e.ts === "string" && e.ts.length > 0)).toBe(true)
    expect(broker.getLatestSequence("r1")).toBe(3)
    expect(broker.getLatestSequence("unknown")).toBe(0)
  })

  it("delivers a terminal event exactly once (no double-finish)", () => {
    const broker = new RunEventBroker({ now: () => "t" })
    const seen: RunProgressEvent[] = []
    broker.subscribe((e) => seen.push(e))

    broker.publish("r1", { kind: "run.finished", runId: "r1", status: "cancelled" })
    // A racing second terminal (e.g. shutdown after cancel) must be dropped.
    broker.publish("r1", { kind: "run.finished", runId: "r1", status: "interrupted" })

    const finished = seen.filter((e) => e.kind === "run.finished")
    expect(finished).toHaveLength(1)
    expect(finished[0]?.status).toBe("cancelled")
    expect(broker.isTerminal("r1")).toBe(true)
  })

  it("bounds the per-run replay buffer", () => {
    const broker = new RunEventBroker({ now: () => "t", maxReplayEventsPerRun: 3 })
    for (let i = 0; i < 10; i++) broker.publish("r1", node("r1", `n${i}`))
    const replay = broker.getReplay("r1")
    expect(replay).toHaveLength(3)
    // Keeps the most recent events; sequence keeps climbing regardless of trim.
    expect(replay.map((e) => e.seq)).toEqual([8, 9, 10])
  })

  it("stops delivering after unsubscribe", () => {
    const broker = new RunEventBroker({ now: () => "t" })
    const seen: RunProgressEvent[] = []
    const unsub = broker.subscribe((e) => seen.push(e))
    broker.publish("r1", node("r1", "a"))
    unsub()
    broker.publish("r1", node("r1", "b"))
    expect(seen).toHaveLength(1)
  })

  it("isolates a throwing subscriber from the others and from the run", () => {
    const broker = new RunEventBroker({ now: () => "t" })
    const good = vi.fn()
    broker.subscribe(() => {
      throw new Error("bad subscriber")
    })
    broker.subscribe(good)
    expect(() => broker.publish("r1", node("r1", "a"))).not.toThrow()
    expect(good).toHaveBeenCalledOnce()
  })
})
