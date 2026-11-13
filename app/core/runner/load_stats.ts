import type { LoadLatencyStats } from "@shared/types/LoadLatencyStats"
import type { LoadNodeStats } from "@shared/types/LoadNodeStats"
import type { RunResult } from "@shared/types/RunResult"

/**
 * Folds per-iteration node results into the aggregate a load run retains: one
 * entry per node with count, error rate, latency percentiles and throughput.
 * The raw response bodies are never kept here — only status, duration and, in
 * the caller, the first failure per node.
 *
 * Plain Node, no Electron: shared by the headless CLI and the desktop app.
 */

interface NodeInfo {
  readonly label: string
  readonly type: string
}

interface AccumulatorEntry {
  readonly info: NodeInfo
  count: number
  errorCount: number
  /** Observed durations in ms, in completion order; retained only while the run lives. */
  durations: number[]
}

/** The first failure per node, keyed by node id. */
export class LoadStatsAccumulator {
  private readonly entries = new Map<string, AccumulatorEntry>()
  private readonly firstFailures = new Map<string, RunResult>()

  public constructor(private readonly nodeInfo: ReadonlyMap<string, NodeInfo>) {}

  /** Fold one finished run's results in. Failed nodes record their first failure. */
  public fold(results: readonly RunResult[]): void {
    for (const result of results) {
      const entry = this.entryFor(result.nodeId)
      entry.count += 1
      if (result.status === "failed") {
        entry.errorCount += 1
        if (!this.firstFailures.has(result.nodeId)) this.firstFailures.set(result.nodeId, result)
      }
      entry.durations.push(Math.max(0, Math.round(result.duration)))
    }
  }

  /** The first failed result per node, in first-failure order. */
  public failures(): ReadonlyMap<string, RunResult> {
    return this.firstFailures
  }

  /** One aggregate per node that ran, in first-execution order. */
  public finish(elapsedMs: number): LoadNodeStats[] {
    const elapsedSeconds = elapsedMs / 1000
    return [...this.entries.entries()].map(([nodeId, entry]) => ({
      nodeId,
      label: entry.info.label,
      type: entry.info.type,
      count: entry.count,
      errorCount: entry.errorCount,
      errorRate: entry.count === 0 ? 0 : entry.errorCount / entry.count,
      latency: latencyStats(entry.durations),
      throughput: elapsedSeconds > 0 ? entry.count / elapsedSeconds : 0,
    }))
  }

  private entryFor(nodeId: string): AccumulatorEntry {
    const existing = this.entries.get(nodeId)
    if (existing !== undefined) return existing
    const info = this.nodeInfo.get(nodeId) ?? { label: nodeId, type: "node" }
    const entry: AccumulatorEntry = { info, count: 0, errorCount: 0, durations: [] }
    this.entries.set(nodeId, entry)
    return entry
  }
}

/** Nearest-rank percentiles over the durations, in whole milliseconds. Null when there are none. */
export function latencyStats(durations: readonly number[]): LoadLatencyStats {
  if (durations.length === 0) {
    return { minMs: null, meanMs: null, p50Ms: null, p90Ms: null, p95Ms: null, p99Ms: null, maxMs: null }
  }
  const sorted = [...durations].sort((left, right) => left - right)
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    minMs: sorted[0]!,
    meanMs: Math.round(sum / sorted.length),
    p50Ms: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted[sorted.length - 1]!,
  }
}

/** Nearest-rank: the smallest sample at or above the p-th percentile. */
function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]!
}
