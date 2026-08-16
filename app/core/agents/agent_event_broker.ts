import type { AgentEvent, AgentSessionEvent } from "@shared/types/AgentSessionEvent"

export interface AgentEventBrokerOptions {
  /** ISO clock — injected so tests are deterministic and the app shares its ClockProvider. */
  readonly now: () => string
  /** Bounded number of tracked sessions; the oldest is evicted past this (memory backstop). */
  readonly maxTrackedSessions?: number
}

const DEFAULT_MAX_SESSIONS = 200

interface SessionState {
  seq: number
  terminal: boolean
}

type Listener = (event: AgentSessionEvent) => void

/**
 * Process-local broker for agent session transitions, sitting between the PTY
 * host and every subscriber so a transition is published once and fanned out
 * consistently.
 *
 * Modelled on {@link RunEventBroker} — same stamping, same exactly-once terminal
 * rule, same subscriber isolation — but a separate class rather than a second
 * mode of that one. Two reasons, and the first is the one that matters: the run
 * broker is also consumed by the MCP bridge's resource subscriptions, so a local
 * agent watching run progress would start receiving notifications about agent
 * processes, including its own. The second is that its state is per *run* and
 * carries a replay buffer these events do not need — an agent's replay is its
 * terminal scrollback, which lives in the PTY host.
 *
 * Exactly-once terminal matters here for a concrete race: killing a session
 * makes the host report an exit, and a host that dies while doing it reports a
 * failure. Both are terminal, one session should settle once.
 */
export class AgentEventBroker {
  private readonly sessions = new Map<string, SessionState>()
  private readonly subscribers = new Set<Listener>()
  private readonly now: () => string
  private readonly maxSessions: number

  constructor(options: AgentEventBrokerOptions) {
    this.now = options.now
    this.maxSessions = options.maxTrackedSessions ?? DEFAULT_MAX_SESSIONS
  }

  /**
   * Stamp and fan out one transition. Takes only the event, which already names
   * its session — `RunEventBroker.publish` takes the id separately as well, and
   * two sources of truth for one identifier is a bug waiting to be written.
   */
  publish(event: AgentEvent): void {
    const state = this.ensure(event.sessionId)
    if (event.kind === "agent.exited" || event.kind === "agent.failed") {
      if (state.terminal) return
      state.terminal = true
    }

    const stamped = { ...event, seq: ++state.seq, ts: this.now() } as AgentSessionEvent
    for (const listener of this.subscribers) {
      try {
        listener(stamped)
      } catch {
        // One failing subscriber must never strand the session or starve the
        // others, and there is no safe channel to report to from in here.
      }
    }
  }

  /** Subscribe to every session's events. Returns an idempotent unsubscribe. */
  subscribe(listener: Listener): () => void {
    this.subscribers.add(listener)
    return () => {
      this.subscribers.delete(listener)
    }
  }

  /** Latest published sequence for a session (0 before its first event). */
  getLatestSequence(sessionId: string): number {
    return this.sessions.get(sessionId)?.seq ?? 0
  }

  isTerminal(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.terminal ?? false
  }

  private ensure(sessionId: string): SessionState {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    // Evict the oldest tracked session at capacity (Map preserves insertion order).
    if (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value
      if (oldest !== undefined) this.sessions.delete(oldest)
    }
    const created: SessionState = { seq: 0, terminal: false }
    this.sessions.set(sessionId, created)
    return created
  }
}
