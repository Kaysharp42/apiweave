/**
 * The shared machinery behind the process-local event brokers
 * (`AgentEventBroker`, `RunEventBroker`).
 *
 * Each broker stamps events with a monotonic per-entry sequence and an ISO
 * timestamp, enforces its own exactly-once terminal rule against per-entry
 * state, and fans every stamped event out to global subscribers without
 * letting one throwing listener strand the entry or starve the others. The
 * state tracking is bounded: the oldest entry is evicted at capacity, which is
 * a memory backstop rather than a correctness mechanism.
 *
 * The brokers differ in what an entry's state holds and in which events are
 * terminal — so this class owns the pieces that are identical: the bounded
 * map, the stamping, the isolated fan-out, and the read surface
 * (`subscribe`, `getLatestSequence`, `isTerminal`) the brokers inherit.
 * Subclassing rather than delegation means that surface is defined once, not
 * re-declared identically in every broker. Each broker adds its own public
 * `publish` and its own terminal rules on top.
 */
export class BoundedEventBroker<TEvent, TState extends TrackedState> {
  private readonly tracked = new Map<string, TState>()
  private readonly subscribers = new Set<(event: TEvent) => void>()
  private readonly now: () => string
  private readonly maxTracked: number

  constructor(options: BoundedEventBrokerOptions) {
    this.now = options.now
    this.maxTracked = options.maxTracked ?? DEFAULT_MAX_TRACKED
  }

  /**
   * The tracked state for one id, created on first use. At capacity the oldest
   * entry is evicted (Map preserves insertion order). Protected: the brokers'
   * `publish` methods use it, but it is not part of what a consumer of a
   * broker can do.
   */
  protected ensure(id: string, create: () => TState): TState {
    const existing = this.tracked.get(id)
    if (existing !== undefined) return existing
    if (this.tracked.size >= this.maxTracked) {
      const oldest = this.tracked.keys().next().value
      if (oldest !== undefined) this.tracked.delete(oldest)
    }
    const created = create()
    this.tracked.set(id, created)
    return created
  }

  /**
   * Stamp one event — monotonic sequence, ISO timestamp — without fanning it
   * out. Split from {@link dispatch} so a broker that buffers events (the run
   * broker's replay) can update its buffer *before* subscribers run: a
   * subscriber asking for the replay from inside its own callback must see
   * the event it was just handed. Protected for the same reason as
   * {@link ensure}.
   */
  protected stamp<TRaw extends object>(state: TState, event: TRaw): TEvent {
    return { ...event, seq: ++state.seq, ts: this.now() } as TEvent
  }

  /**
   * Fan one stamped event out to every subscriber, isolating each listener so
   * a throwing one can neither strand the entry nor starve the others.
   */
  protected dispatch(event: TEvent): void {
    for (const listener of this.subscribers) {
      try {
        listener(event)
      } catch {
        // A single failing subscriber must never strand the entry or starve the
        // others. Swallow — there is no safe channel to report to from in here.
      }
    }
  }

  /**
   * Stamp one event and fan it out. Returns the stamped event, because a
   * broker that buffers events (the run broker's replay) needs the stamp the
   * subscribers received, not a second one. Protected for the same reason as
   * {@link ensure}.
   */
  protected publishStamped<TRaw extends object>(state: TState, event: TRaw): TEvent {
    const stamped = this.stamp(state, event)
    this.dispatch(stamped)
    return stamped
  }

  /** Subscribe to every entry's events. Returns an idempotent unsubscribe. */
  subscribe(listener: (event: TEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => {
      this.subscribers.delete(listener)
    }
  }

  /** Latest published sequence for an id (0 before its first event). */
  getLatestSequence(id: string): number {
    return this.tracked.get(id)?.seq ?? 0
  }

  isTerminal(id: string): boolean {
    return this.tracked.get(id)?.terminal ?? false
  }

  /** The tracked state for an id, without creating one — reads must never track. */
  protected getState(id: string): TState | undefined {
    return this.tracked.get(id)
  }
}

export interface BoundedEventBrokerOptions {
  /** ISO clock — injected so tests are deterministic and the app shares its ClockProvider. */
  readonly now: () => string
  /** Bounded number of tracked entries; the oldest is evicted past this (memory backstop). */
  readonly maxTracked?: number
}

/** Per-entry bookkeeping every broker built on {@link BoundedEventBroker} carries. */
export interface TrackedState {
  seq: number
  terminal: boolean
}

const DEFAULT_MAX_TRACKED = 500
