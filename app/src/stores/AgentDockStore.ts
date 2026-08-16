import { create } from "zustand";

interface AgentDockState {
  /** The session showing in the workflow view's bottom dock, or `null` for closed. */
  openSessionId: string | null;
  openSession: (sessionId: string) => void;
  close: () => void;
}

/**
 * Which agent session the workflow view's bottom dock is showing.
 *
 * A store rather than a context because of who has to talk to whom: the launch
 * control lives inside the canvas toolbar and the dock is a sibling of the
 * canvas, so passing it down would mean threading a callback through
 * `WorkflowCanvas` and `CanvasToolbar` for a value neither of them uses. That is
 * what `SidebarStore` and `NavigationStore` already exist for.
 *
 * Deliberately not persisted. A session id survives a restart in SQLite but the
 * process behind it does not, so restoring the dock would reopen a terminal that
 * can only say the session is gone.
 */
const useAgentDockStore = create<AgentDockState>()((set) => ({
  openSessionId: null,
  openSession: (sessionId: string) => set({ openSessionId: sessionId }),
  close: () => set({ openSessionId: null }),
}));

export default useAgentDockStore;
