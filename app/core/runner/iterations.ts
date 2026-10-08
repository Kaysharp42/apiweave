import type { JsonValue } from "@shared/types/JsonValue"
import type { RunTerminalStatus } from "@shared/types/RunProgressEvent"
import { generateId } from "../id"
import { ValidationError } from "../ipc/errors"
import type { EnqueueRequest } from "./scheduler"

/** The part of {@link RunScheduler} a data-driven run drives. */
export interface IterationScheduler {
  enqueue(request: EnqueueRequest): string
  whenFinished(runId: string): Promise<RunTerminalStatus>
}

export interface IterationsHandle {
  readonly groupId: string
  /** Iteration 1, already enqueued: a request the scheduler refuses throws from `startIterations` itself. */
  readonly firstRunId: string
  /** Every iteration's run id, in order, once the last one ran. Never rejects. */
  readonly done: Promise<{ readonly runIds: readonly string[]; readonly status: RunTerminalStatus }>
}

/**
 * Run one workflow once per data row, one after another. Each iteration is an
 * ordinary run — history, masking, cancellation, the agent approval prompt —
 * that reads its row as `{{data.<column>}}` and records its place
 * (`iteration`: group, index, count).
 *
 * A failed iteration does not stop the next one unless `bail`; a cancelled or
 * interrupted one stops the rest, which is how cancelling the run on screen
 * cancels the data-driven run. Status: the first cancel/interrupt, else
 * `failed` when any iteration failed, else `completed`.
 */
export function startIterations(
  scheduler: IterationScheduler,
  request: Omit<EnqueueRequest, "data" | "iteration">,
  rows: readonly Readonly<Record<string, JsonValue>>[],
  options: { readonly bail?: boolean } = {},
): IterationsHandle {
  if (rows.length === 0) throw new ValidationError("A data-driven run needs at least one data row.")
  const groupId = generateId()
  const enqueue = (index: number): string =>
    scheduler.enqueue({ ...request, data: rows[index]!, iteration: { groupId, index: index + 1, count: rows.length } })
  const firstRunId = enqueue(0)
  const done = (async () => {
    const runIds = [firstRunId]
    let status: RunTerminalStatus = "completed"
    for (let index = 0; ; index++) {
      let outcome: RunTerminalStatus
      try {
        outcome = await scheduler.whenFinished(runIds[index]!)
      } catch {
        outcome = "failed"
      }
      if (outcome === "cancelled" || outcome === "interrupted") return { runIds, status: outcome }
      if (outcome === "failed") {
        status = "failed"
        if (options.bail === true) break
      }
      if (index + 1 >= rows.length) break
      try {
        runIds.push(enqueue(index + 1))
      } catch {
        // The workflow was deleted between iterations.
        return { runIds, status: "failed" as const }
      }
    }
    return { runIds, status }
  })()
  return { groupId, firstRunId, done }
}
