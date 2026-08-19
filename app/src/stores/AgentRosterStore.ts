import { create } from "zustand";

interface AgentRosterState {
  /**
   * Bumped once per committed roster change. The value itself means nothing —
   * only that it differs from the one a reader last saw.
   */
  version: number;
  rosterChanged: () => void;
}

/**
 * A change ticket for the agent roster.
 *
 * The roster lives in main and is read per-consumer: Settings → Agents holds one
 * copy, every launch control holds another. Main pushes session transitions but
 * says nothing about the roster, so a consumer that fetched once has no way to
 * learn that a custom agent was added, edited, deleted, or made default — the
 * toolbar keeps offering the old list until something remounts it.
 *
 * A counter rather than the roster itself, and deliberately so: caching the
 * entries here would make this a second model of a table that main owns, which
 * is the thing `AgentSessionsContext` refuses to do for sessions. Readers keep
 * their own fetch; this only tells them when to run it again.
 */
const useAgentRosterStore = create<AgentRosterState>()((set) => ({
  version: 0,
  rosterChanged: () => set((state) => ({ version: state.version + 1 })),
}));

export default useAgentRosterStore;
