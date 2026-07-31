import type { RunEvent, RunProgressEvent, RunTerminalStatus } from "@shared/types/RunProgressEvent"

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

interface RunState {
  seq: number
  terminal: boolean
  status: RunTerminalStatus | "running" | "pending"
  /** Most-recent stamped events, bounded to maxReplayEventsPerRun. */
  readonly recent: RunProgressEvent[]
}

type Listener = (event: RunProgressEvent) => void

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
export class RunEventBroker {
  private readonly runs = new Map<string, RunState>()
  private readonly subscribers = new Set<Listener>()
  private readonly now: () => string
  private readonly maxReplay: number
  private readonly maxRuns: number

  constructor(options: RunEventBrokerOptions) {
    this.now = options.now
    this.maxReplay = options.maxReplayEventsPerRun ?? DEFAULT_MAX_REPLAY
    this.maxRuns = options.maxTrackedRuns ?? DEFAULT_MAX_RUNS
  }

  /** Stamp, buffer, and fan out one raw run transition. Terminal events are
   *  idempotent per run. Bad subscribers are isolated (never rethrow). */
  publish(runId: string, event: RunEvent): void {
    const state = this.ensure(runId)
    if (event.kind === "run.finished") {
      if (state.terminal) return // exactly-once terminal
      state.terminal = true
      state.status = event.status
    } else if (event.kind === "run.started") {
      if (!state.terminal) state.status = "running"
    }

    const stamped = { ...event, seq: ++state.seq, ts: this.now() } as RunProgressEvent
    state.recent.push(stamped)
    if (state.recent.length > this.maxReplay) state.recent.shift()

    for (const listener of this.subscribers) {
      try {
        listener(stamped)
      } catch {
        // A single failing subscriber must never strand the run or starve the
        // other subscribers. Swallow — there is no safe channel to report to here.
      }
    }
  }

  /** Subscribe to every run's events. Returns an idempotent unsubscribe. */
  subscribe(listener: Listener): () => void {
    this.subscribers.add(listener)
    return () => {
      this.subscribers.delete(listener)
    }
  }

  /** Latest published sequence for a run (0 before its first event). */
  getLatestSequence(runId: string): number {
    return this.runs.get(runId)?.seq ?? 0
  }

  isTerminal(runId: string): boolean {
    return this.runs.get(runId)?.terminal ?? false
  }

  /** Bounded replay buffer for a run (most recent first-in order). */
  getReplay(runId: string): readonly RunProgressEvent[] {
    return this.runs.get(runId)?.recent ?? []
  }

  private ensure(runId: string): RunState {
    const existing = this.runs.get(runId)
    if (existing) return existing
    // Evict the oldest tracked run when at capacity (Map preserves insertion order).
    if (this.runs.size >= this.maxRuns) {
      const oldest = this.runs.keys().next().value
      if (oldest !== undefined) this.runs.delete(oldest)
    }
    const created: RunState = { seq: 0, terminal: false, status: "pending", recent: [] }
    this.runs.set(runId, created)
    return created
  }
}
