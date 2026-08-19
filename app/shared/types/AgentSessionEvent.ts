/**
 * A raw agent-session transition, before {@link AgentEventBroker} stamps it.
 *
 * Deliberately metadata only: three facts about a process, and never a byte of
 * its output. Terminal output travels over a `MessagePort` straight to the
 * renderer ({@link AgentOutputEvent}) precisely so that it is not fanned out
 * through a broker to subscribers that do not want it.
 *
 * - `agent.started` — the PTY host reported a pid; the child is running.
 * - `agent.exited` — the child exited on its own or was killed. Terminal.
 * - `agent.failed` — the spawn never happened, or the host died under it. Terminal.
 * - `agent.activity` — the child started or stopped printing. Not a transition.
 */
export type AgentEvent =
  | { readonly kind: "agent.started"; readonly sessionId: string; readonly pid: number }
  | { readonly kind: "agent.exited"; readonly sessionId: string; readonly exitCode: number }
  | { readonly kind: "agent.failed"; readonly sessionId: string; readonly message: string }
  /**
   * Whether the agent is working or waiting on the user — the difference a
   * running pid cannot express, and the one the session list is otherwise
   * forced to paper over by calling every live agent "running".
   *
   * The odd one out here, deliberately: the other three change what the session
   * row says and are written to it. This one is never persisted. It flips
   * several times a minute, it belongs to no column, and it would be a lie the
   * moment the app restarts and the flag outlives the process it described.
   * Subscribers hold it in memory for as long as they are looking at it.
   */
  | { readonly kind: "agent.activity"; readonly sessionId: string; readonly busy: boolean }
  /**
   * The agent's own identifier for the conversation, learned from its output.
   *
   * Persisted, unlike `agent.activity`, and that is the entire point: it is what
   * lets a finished session be handed back to the CLI that owns it. It arrives
   * at most once per session, and often at the very end — the agents that need
   * scanning print their id in the banner they write as they exit.
   */
  | { readonly kind: "agent.sessionRef"; readonly sessionId: string; readonly ref: string }
  /** What the agent called the work, from the terminal title it set. Persisted. */
  | { readonly kind: "agent.title"; readonly sessionId: string; readonly title: string }

/**
 * A broker-stamped session transition, as delivered to subscribers — the
 * renderer over its own IPC channel today, and whatever else needs to know
 * later. `seq` is monotonic per session and `ts` is an ISO timestamp, so a
 * consumer can tell whether a re-read reflects newer state than the event that
 * prompted it.
 */
export type AgentSessionEvent = AgentEvent & { readonly seq: number; readonly ts: string }
