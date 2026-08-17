import { useShallow } from "zustand/react/shallow";
import useAgentDockStore from "../stores/AgentDockStore";

/**
 * The agent-dock store's surface, in one selector.
 *
 * Every consumer used to write its own handful of
 * `useAgentDockStore((state) => state.x)` lines; these hooks assert the
 * store's shape here, once. They are split by what each consumer must
 * re-render on:
 *
 * - {@link useAgentDockControls} is the dock's own surface and includes
 *   `focusRequest` — a counter bumped on every "show me this session" click,
 *   even when the session is already open. Only the dock should re-render on
 *   it, because the dock is the component that puts the keyboard into the
 *   terminal.
 * - {@link useAgentDockSelection} is the same surface without `focusRequest`,
 *   for the sessions list.
 * - {@link useOpenAgentSessionId} and {@link useOpenAgentSession} are the
 *   single fields the layout branches and the canvas toolbar read.
 */
export function useAgentDockControls() {
  return useAgentDockStore(
    useShallow((state) => ({
      openSessionId: state.openSessionId,
      openSession: state.openSession,
      focusRequest: state.focusRequest,
      closeDock: state.close,
    })),
  );
}

/**
 * The open-session trio the sessions list reads. Deliberately *not*
 * `focusRequest`: a click that focuses the already-open session re-renders
 * the dock, not every row in the list.
 */
export function useAgentDockSelection() {
  return useAgentDockStore(
    useShallow((state) => ({
      openSessionId: state.openSessionId,
      openSession: state.openSession,
      closeDock: state.close,
    })),
  );
}

/**
 * The session showing in the agent panel, alone. Both layout branches render
 * the dock off this value and nothing else in the store.
 */
export function useOpenAgentSessionId(): string | null {
  return useAgentDockStore((state) => state.openSessionId);
}

/**
 * The open-session action, alone. The canvas toolbar launches and focuses an
 * agent from here and must not re-render when the dock merely changes which
 * session it is showing.
 */
export function useOpenAgentSession(): (sessionId: string) => void {
  return useAgentDockStore((state) => state.openSession);
}
