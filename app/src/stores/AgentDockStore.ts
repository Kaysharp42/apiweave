import { create } from "zustand";

interface AgentDockState {
  /** The session showing in the agent panel, or `null` when it is closed. */
  openSessionId: string | null;
  /**
   * How many times a session has been asked for. The panel puts the keyboard
   * into the terminal on each request, and this is what carries the request the
   * id cannot: opening the session that is *already* open leaves `openSessionId`
   * exactly as it was, so nothing would re-render and the click that was meant
   * to say "let me type at this agent" would do nothing at all.
   *
   * A counter rather than a flag because it describes an event, and the only
   * honest way to spell an event as state is a value that differs from the last.
   */
  focusRequest: number;
  openSession: (sessionId: string) => void;
  close: () => void;
}

/**
 * Which agent session the left-hand agent panel is showing.
 *
 * A store rather than a context because of who has to talk to whom: the launch
 * control lives inside the canvas toolbar and the panel is a sibling column of
 * the canvas, so passing it down would mean threading a callback through
 * `WorkflowCanvas` and `CanvasToolbar` for a value neither of them uses. That is
 * what `SidebarStore` and `NavigationStore` already exist for.
 *
 * Deliberately not persisted. A session id survives a restart in SQLite but the
 * process behind it does not, so restoring the panel would reopen a terminal
 * that can only say the session is gone.
 */
const useAgentDockStore = create<AgentDockState>()((set) => ({
  openSessionId: null,
  focusRequest: 0,
  openSession: (sessionId: string) =>
    set((state) => ({
      openSessionId: sessionId,
      focusRequest: state.focusRequest + 1,
    })),
  // Not bumped on close: there is no terminal left to focus, and moving the
  // count here would make the next open look like a repeat of this one.
  close: () => set({ openSessionId: null }),
}));

export default useAgentDockStore;
