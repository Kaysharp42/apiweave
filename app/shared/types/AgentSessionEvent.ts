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
 */
export type AgentEvent =
  | { readonly kind: "agent.started"; readonly sessionId: string; readonly pid: number }
  | { readonly kind: "agent.exited"; readonly sessionId: string; readonly exitCode: number }
  | { readonly kind: "agent.failed"; readonly sessionId: string; readonly message: string }

/**
 * A broker-stamped session transition, as delivered to subscribers — the
 * renderer over its own IPC channel today, and whatever else needs to know
 * later. `seq` is monotonic per session and `ts` is an ISO timestamp, so a
 * consumer can tell whether a re-read reflects newer state than the event that
 * prompted it.
 */
export type AgentSessionEvent = AgentEvent & { readonly seq: number; readonly ts: string }
