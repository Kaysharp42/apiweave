import { describe, expect, it } from "vitest"
import type { RunResult } from "@shared/types/RunResult"
import type { RunTerminalStatus } from "@shared/types/RunProgressEvent"
import { startLoadRun, type LoadScheduler } from "../load"
import type { EnqueueRequest } from "../scheduler"
import { parseThreshold } from "../thresholds"

/** A scheduler whose runs take `delayMs` and report one http node of that duration. */
function fakeScheduler(delayMs: number, failIndexes: ReadonlySet<number> = new Set()) {
  const state = { inFlight: 0, peak: 0, enqueued: [] as EnqueueRequest[], cleared: [] as string[], cap: 0 }
  const outcomes = new Map<string, Promise<RunTerminalStatus>>()
  const scheduler: LoadScheduler = {
    enqueue: (request) => {
      const runId = `run${state.enqueued.length}`
      const index = state.enqueued.length
      state.enqueued.push(request)
      state.inFlight += 1
      state.peak = Math.max(state.peak, state.inFlight)
      outcomes.set(
        runId,
        new Promise((resolve) =>
          setTimeout(() => {
            state.inFlight -= 1
            resolve(failIndexes.has(index) ? "failed" : "completed")
          }, delayMs),
        ),
      )
      return runId
    },
    whenFinished: (runId) => outcomes.get(runId)!,
    resultsOf: (runId): readonly RunResult[] => {
      const index = Number(runId.slice(3))
      const failed = failIndexes.has(index)
      return [{ nodeId: "http", status: failed ? "failed" : "passed", duration: delayMs, request: null, response: null, error: failed ? `failure ${index}` : null }]
    },
    clearIterationResults: (runId) => state.cleared.push(runId),
    ensureConcurrency: (count) => {
      state.cap = count
    },
  }
  return { scheduler, state }
}

const info = new Map([["http", { label: "GET /x", type: "http-request" }]])

describe("startLoadRun", () => {
  it("keeps `concurrency` iterations in flight, cycles data rows and clears every iteration's results", async () => {
    const { scheduler, state } = fakeScheduler(20)
    const handle = startLoadRun(scheduler, { workspaceId: "w", workflowId: "f" }, [{ n: 1 }, { n: 2 }], { iterations: 7, concurrency: 3 }, [], info)
    const result = await handle.done

    expect(state.cap).toBe(3)
    expect(state.peak).toBe(3)
    expect(state.enqueued.map((request) => request.data)).toEqual([{ n: 1 }, { n: 2 }, { n: 1 }, { n: 2 }, { n: 1 }, { n: 2 }, { n: 1 }])
    expect(state.enqueued[0]!.iteration).toMatchObject({ index: 1, count: 7 })
    expect(state.cleared).toHaveLength(7)
    expect(result).toMatchObject({ status: "completed", iterationCount: 7 })
    expect(result.nodeStats[0]).toMatchObject({ nodeId: "http", label: "GET /x", count: 7, errorCount: 0 })
  })

  it("retains the first failure per node and fails the run", async () => {
    const { scheduler } = fakeScheduler(5, new Set([2, 4]))
    const result = await startLoadRun(scheduler, { workspaceId: "w", workflowId: "f" }, [{}], { iterations: 6, concurrency: 2 }, [], info).done

    expect(result.status).toBe("failed")
    expect(result.nodeStats[0]).toMatchObject({ count: 6, errorCount: 2 })
    expect([...result.firstFailures.values()].map((failure) => failure.error)).toEqual(["failure 2"])
  })

  it("stops launching after the duration and finishes what is in flight", async () => {
    const { scheduler, state } = fakeScheduler(30)
    const result = await startLoadRun(scheduler, { workspaceId: "w", workflowId: "f" }, [{}], { iterations: 10_000, concurrency: 2, durationMs: 150 }, [], info).done

    expect(result.iterationCount).toBe(state.enqueued.length)
    expect(result.iterationCount).toBeGreaterThan(2)
    expect(result.iterationCount).toBeLessThan(40)
    expect(state.inFlight).toBe(0)
  })

  it("ramps concurrency up instead of starting everything at once", async () => {
    const { scheduler, state } = fakeScheduler(400)
    const handle = startLoadRun(scheduler, { workspaceId: "w", workflowId: "f" }, [{}], { iterations: 4, concurrency: 4, rampUpMs: 400 }, [], info)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(state.enqueued.length).toBeLessThan(4)
    await handle.done
    expect(state.enqueued).toHaveLength(4)
  })

  it("fails the run when a threshold is breached", async () => {
    const { scheduler } = fakeScheduler(10)
    const result = await startLoadRun(scheduler, { workspaceId: "w", workflowId: "f" }, [{}], { iterations: 3, concurrency: 1 }, [parseThreshold("p95<1")], info).done

    expect(result.status).toBe("failed")
    expect(result.breaches).toHaveLength(1)
  })

  it.each([
    [{ iterations: 0, concurrency: 1 }],
    [{ iterations: 1, concurrency: 0 }],
    [{ iterations: 1_000_000, concurrency: 1 }],
  ])("rejects bad options %j", (options) => {
    expect(() => startLoadRun(fakeScheduler(1).scheduler, { workspaceId: "w", workflowId: "f" }, [{}], options, [], info)).toThrow(/load run needs/)
  })
})
