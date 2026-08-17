import type { RunEvent, RunProgressEvent, RunTerminalStatus } from "@shared/types/RunProgressEvent"
import { BoundedEventBroker, type TrackedState } from "../shared/bounded_event_broker"

export interface RunEventBrokerOptions {
  /** ISO clock — injected so tests are deterministic and the app shares its ClockProvider. */
  readonly now: () => string
  /** Bounded per-run replay buffer (operational limit). */
  readonly maxReplayEventsPerRun?: number
  /** Bounded number of tracked runs; the oldest is evicted past this (memory backstop). */
  readonly maxTrackedRuns?: number
}

const DEFAULT_MAX_REPLAY = 200
const DEFAULT_MAX_RUNS = 500

interface RunState extends TrackedState {
  status: RunTerminalStatus | "running" | "pending"
  /** Most-recent stamped events, bounded to maxReplayEventsPerRun. */
  readonly recent: RunProgressEvent[]
}

/**
 * Process-local run-event broker (Phase 6). Owned by the Electron composition
 * root, it sits between the {@link RunScheduler} and every subscriber (the
 * renderer's IPC progress channel and MCP resource subscriptions), so run
 * transitions are published exactly once and fanned out consistently.
 *
 * Responsibilities:
 * - Stamp each raw {@link RunEvent} with a monotonic per-run `seq` and a `ts`.
 * - Enforce exactly-once terminal semantics: a second `run.finished` for a run
 *   is dropped, so a cancel-then-fail race can't emit two terminal events.
 * - Keep a bounded per-run replay buffer and the authoritative latest sequence
 *   (so a resource read can report `latestSequence`).
 * - Fan out to global subscribers without letting one throwing listener break
 *   the run or the other subscribers.
 *
 * No raw payloads ever pass through here — events carry only the safe metadata
 * the scheduler already sanitized.
 */
export class RunEventBroker extends BoundedEventBroker<RunProgressEvent, RunState> {
  private readonly maxReplay: number

  constructor(options: RunEventBrokerOptions) {
    super({
      now: options.now,
      maxTracked: options.maxTrackedRuns ?? DEFAULT_MAX_RUNS,
    })
    this.maxReplay = options.maxReplayEventsPerRun ?? DEFAULT_MAX_REPLAY
  }

  /** Stamp, buffer, and fan out one raw run transition. Terminal events are
   *  idempotent per run. Bad subscribers are isolated (never rethrow). */
  publish(runId: string, event: RunEvent): void {
    const state = this.ensure(runId, () => ({ seq: 0, terminal: false, status: "pending", recent: [] }))
    if (event.kind === "run.finished") {
      if (state.terminal) return // exactly-once terminal
      state.terminal = true
      state.status = event.status
    } else if (event.kind === "run.started") {
      if (!state.terminal) state.status = "running"
    }

    // Buffer before dispatch: a subscriber that calls `getReplay` from inside
    // its own callback must see the event it was just handed, and the run-
    // progress subscribe path depends on replay-vs-live ordering.
    const stamped = this.stamp(state, event)
    state.recent.push(stamped)
    if (state.recent.length > this.maxReplay) state.recent.shift()
    this.dispatch(stamped)
  }

  /**
   * Bounded replay buffer for a run (most recent first-in order). Up to date
   * with the live event by the time any subscriber's callback runs — see
   * {@link publish}.
   */
  getReplay(runId: string): readonly RunProgressEvent[] {
    return this.getState(runId)?.recent ?? []
  }
}
