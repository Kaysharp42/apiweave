import { describe, expect, it } from "vitest"
import type { RunResult } from "@shared/types/RunResult"
import { LoadStatsAccumulator, latencyStats } from "../load_stats"
import { evaluateThresholds, formatThreshold, parseThreshold } from "../thresholds"

const result = (nodeId: string, duration: number, status: RunResult["status"] = "passed"): RunResult => ({
  nodeId,
  status,
  duration,
  request: null,
  response: null,
  error: status === "failed" ? `boom ${duration}` : null,
})

describe("latencyStats", () => {
  it("uses nearest-rank percentiles", () => {
    const stats = latencyStats(Array.from({ length: 100 }, (_, index) => index + 1))
    expect(stats).toEqual({ minMs: 1, meanMs: 51, p50Ms: 50, p90Ms: 90, p95Ms: 95, p99Ms: 99, maxMs: 100 })
  })

  it("is all null without samples", () => {
    expect(latencyStats([]).p95Ms).toBeNull()
  })
})

describe("LoadStatsAccumulator", () => {
  it("aggregates per node, keeps only the first failure and computes throughput", () => {
    const accumulator = new LoadStatsAccumulator(new Map([["a", { label: "GET a", type: "http-request" }]]))
    accumulator.fold([result("a", 10), result("b", 5)])
    accumulator.fold([result("a", 30, "failed")])
    accumulator.fold([result("a", 50, "failed")])

    const stats = accumulator.finish(2000)
    const a = stats.find((node) => node.nodeId === "a")!
    expect(a).toMatchObject({ label: "GET a", count: 3, errorCount: 2, throughput: 1.5 })
    expect(a.errorRate).toBeCloseTo(2 / 3)
    expect(stats.find((node) => node.nodeId === "b")!.label).toBe("b")
    expect([...accumulator.failures().keys()]).toEqual(["a"])
    expect(accumulator.failures().get("a")!.error).toBe("boom 30")
  })
})

describe("thresholds", () => {
  it("parses and canonicalises expressions", () => {
    expect(formatThreshold(parseThreshold(" P95 < 500 "))).toBe("p95<500")
    expect(formatThreshold(parseThreshold("errors<1%"))).toBe("errors<1%")
    expect(formatThreshold(parseThreshold("throughput>=20"))).toBe("throughput>=20")
  })

  it.each(["p95", "p95<", "latency<5", "p95<5%", "<5"])("rejects %s", (expression) => {
    expect(() => parseThreshold(expression)).toThrow(/invalid threshold/)
  })

  it("reports each node that violates a threshold", () => {
    const accumulator = new LoadStatsAccumulator(new Map())
    for (let index = 0; index < 100; index++) accumulator.fold([result("slow", 900), result("fast", 10, index === 0 ? "failed" : "passed")])
    const nodes = accumulator.finish(1000)

    const breaches = evaluateThresholds(nodes, [parseThreshold("p95<500"), parseThreshold("errors<1%")])

    expect(breaches.map((breach) => `${breach.nodeId}:${breach.expression}`)).toEqual(["slow:p95<500", "fast:errors<1%"])
    expect(evaluateThresholds(nodes, [parseThreshold("errors<=1%")])).toEqual([])
  })
})
