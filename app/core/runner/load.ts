import type { RunTerminalStatus } from "@shared/types/RunProgressEvent"
import type { RunResult } from "@shared/types/RunResult"
import type { LoadNodeStats } from "@shared/types/LoadNodeStats"
import type { IterationRow } from "@shared/iteration-data/iterationData"
import { generateId } from "../id"
import { ValidationError } from "../ipc/errors"
import type { EnqueueRequest } from "./scheduler"
import { LoadStatsAccumulator } from "./load_stats"
import { describeBreach, evaluateThresholds, type Threshold, type ThresholdBreach } from "./thresholds"
import type { LoadRun } from "@shared/types/LoadRun"
import type { LoadRunSettings } from "@shared/types/LoadRunSettings"

/**
 * A load run: the same workflow, many iterations at once. Each iteration is an
 * ordinary run (history, masking, cancellation, agent approval) that reads its
 * row as `{{data.<column>}}` and records its place. Unlike a data-driven run,
 * iterations run in parallel up to `concurrency`, with an optional ramp-up that
 * grows concurrency over time and an optional duration that stops new launches.
 *
 * Retention is bounded on purpose: as each iteration finishes its results are
 * folded into {@link LoadStatsAccumulator} and then cleared, so a load run keeps
 * the first failure per node plus aggregate statistics — never every iteration's
 * full response.
 */

export interface LoadScheduler {
  enqueue(request: EnqueueRequest): string
  whenFinished(runId: string): Promise<RunTerminalStatus>
  /** The finished run's per-node results, read once for folding before they are cleared. */
  resultsOf(runId: string): readonly RunResult[]
  /** Drop a finished iteration's per-node results and response bodies. */
  clearIterationResults(runId: string): void
  /** Make room for `count` runs at once: the scheduler's cap would otherwise queue them and inflate latency. */
  ensureConcurrency(count: number): void
}

/** Most iterations one load run may launch, whatever the data or duration says. */
export const MAX_LOAD_ITERATIONS = 100_000

export interface LoadRunOptions {
  /** Total iterations to launch. Data rows are reused in order when there are fewer rows than iterations. */
  readonly iterations: number
  readonly concurrency: number
  /** Stop launching new iterations once this long has elapsed; in-flight ones finish. */
  readonly durationMs?: number
  /** Grow concurrency from 1 to `concurrency` over this long. */
  readonly rampUpMs?: number
}

export interface LoadRunHandle {
  readonly groupId: string
  /** Iteration 1's run id, already enqueued. */
  readonly firstRunId: string
  /** Settles once the last iteration finishes. Never rejects. */
  readonly done: Promise<LoadRunResult>
}

export interface LoadRunResult {
  readonly status: RunTerminalStatus
  /** Iterations that actually ran. */
  readonly iterationCount: number
  readonly elapsedMs: number
  readonly nodeStats: readonly LoadNodeStats[]
  readonly firstFailures: ReadonlyMap<string, RunResult>
  readonly breaches: readonly ThresholdBreach[]
}

/** A node's display identity, so a report can name it even when the workflow later changes. */
export interface LoadNodeInfo {
  readonly label: string
  readonly type: string
}

export function startLoadRun(
  scheduler: LoadScheduler,
  request: Omit<EnqueueRequest, "data" | "iteration">,
  rows: readonly IterationRow[],
  options: LoadRunOptions,
  thresholds: readonly Threshold[],
  nodeInfo: ReadonlyMap<string, LoadNodeInfo>,
): LoadRunHandle {
  if (rows.length === 0) throw new ValidationError("A load run needs at least one iteration.")
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new ValidationError("A load run needs a concurrency of at least 1.")
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > MAX_LOAD_ITERATIONS) {
    throw new ValidationError(`A load run needs between 1 and ${MAX_LOAD_ITERATIONS} iterations.`)
  }
  scheduler.ensureConcurrency(options.concurrency)
  const total = options.iterations
  const groupId = generateId()
  const accumulator = new LoadStatsAccumulator(nodeInfo)
  const { concurrency } = options

  // A single waiter (the pump loop) is signalled on each completion and on the
  // ramp/duration timers. The version counter closes the lost-wakeup window.
  let version = 0
  let waiter: (() => void) | null = null
  const signal = (): void => {
    version += 1
    waiter?.()
    waiter = null
  }
  const waitForChange = async (seen: number): Promise<number> => {
    if (version > seen) return version
    return await new Promise<number>((resolve) => {
      waiter = () => resolve(version)
    })
  }

  let firstRunId: string | undefined

  const done = (async (): Promise<LoadRunResult> => {
    const start = Date.now()
    let next = 0
    let running = 0
    let stop = false
    let aborted: RunTerminalStatus | null = null
    let launched = 0

    const allowed = (): number => {
      if (options.rampUpMs === undefined) return concurrency
      const elapsed = Date.now() - start
      if (elapsed >= options.rampUpMs) return concurrency
      return Math.max(1, Math.ceil((concurrency * elapsed) / options.rampUpMs))
    }

    const settle = async (runId: string): Promise<void> => {
      let outcome: RunTerminalStatus
      try {
        outcome = await scheduler.whenFinished(runId)
      } catch {
        outcome = "failed"
      }
      accumulator.fold(scheduler.resultsOf(runId))
      scheduler.clearIterationResults(runId)
      if (outcome === "cancelled" || outcome === "interrupted") {
        if (aborted === null) aborted = outcome
        stop = true
      }
      running -= 1
      signal()
    }

    const launch = (): void => {
      while (!stop && running < allowed() && next < total) {
        const index = next
        next += 1
        const runId = scheduler.enqueue({
          ...request,
          data: rows[index % rows.length]!,
          iteration: { groupId, index: index + 1, count: total },
        })
        firstRunId ??= runId
        launched += 1
        running += 1
        void settle(runId)
      }
      if (next >= total) stop = true
    }

    const rampInterval =
      options.rampUpMs !== undefined && options.rampUpMs > 0
        ? setInterval(() => {
            launch()
            signal()
          }, Math.max(1, Math.floor(options.rampUpMs / concurrency)))
        : null
    rampInterval?.unref?.()

    const durationTimer =
      options.durationMs !== undefined
        ? setTimeout(() => {
            stop = true
            signal()
          }, options.durationMs)
        : null
    durationTimer?.unref?.()

    launch()

    let seen = version
    while (running > 0) {
      seen = await waitForChange(seen)
      launch()
    }

    if (rampInterval !== null) clearInterval(rampInterval)
    if (durationTimer !== null) clearTimeout(durationTimer)

    const elapsedMs = Date.now() - start
    const nodeStats = accumulator.finish(elapsedMs)
    const breaches = evaluateThresholds(nodeStats, thresholds)
    const anyFailed = nodeStats.some((stats) => stats.errorCount > 0)
    const status: RunTerminalStatus = aborted ?? (breaches.length > 0 || anyFailed ? "failed" : "completed")

    return {
      status,
      iterationCount: launched,
      elapsedMs,
      nodeStats,
      firstFailures: accumulator.failures(),
      breaches,
    }
  })()

  return { groupId, firstRunId: firstRunId!, done }
}

/** The retained record of a finished load run: settings, aggregates, first failures and breached thresholds. */
export function buildLoadRun(
  identity: { readonly workspaceId: string; readonly workflowId: string; readonly loadRunId: string },
  settings: LoadRunSettings,
  startedAt: string,
  result: LoadRunResult,
): LoadRun {
  return {
    ...identity,
    status: result.status,
    startedAt,
    completedAt: new Date(Date.parse(startedAt) + result.elapsedMs).toISOString(),
    durationMs: result.elapsedMs,
    iterationCount: result.iterationCount,
    settings,
    nodeStats: [...result.nodeStats],
    firstFailures: Object.fromEntries(result.firstFailures),
    breachedThresholds: result.breaches.map(describeBreach),
  }
}
