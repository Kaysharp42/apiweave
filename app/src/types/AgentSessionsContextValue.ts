import type { AgentSession } from "@shared/types/AgentSession";

/**
 * Note what is absent: launching. A launch needs no shared state and produces an
 * `agent.started` event that refreshes every consumer anyway, so it goes through
 * the client directly — which also keeps the launch control usable in a tree that
 * has no provider above it.
 */
export interface AgentSessionsContextValue {
  /** Newest first, as the repository returns them. */
  readonly sessions: readonly AgentSession[];
  /** True until the first list has arrived, so an empty list is not shown as "none". */
  readonly loading: boolean;
  readonly error: string | null;
  /** False outside the desktop shell, where there is no process to launch. */
  readonly isAvailable: boolean;
  readonly refresh: () => Promise<void>;
  readonly killSession: (sessionId: string) => Promise<void>;
}
