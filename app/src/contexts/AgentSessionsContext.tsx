import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentSession } from "@shared/types/AgentSession";
import type { AgentSessionsContextValue } from "../types/AgentSessionsContextValue";
import { agents } from "../utils/apiweaveClient";
import { useWorkspace } from "./WorkspaceContext";

const AgentSessionsContext = createContext<AgentSessionsContextValue | null>(
  null,
);

/**
 * Agent sessions for every consumer in the tree.
 *
 * Throws outside a provider rather than falling back to its own subscription,
 * for the reason `useUpdateStatus` does: session transitions are pushed from
 * main to *all* subscribers, so N independent hooks would each hold an IPC
 * listener and each keep their own copy of one piece of global state. Failing
 * loudly is what keeps the count at one.
 */
export function useAgentSessions(): AgentSessionsContextValue {
  const context = useContext(AgentSessionsContext);
  if (context === null) {
    throw new Error(
      "useAgentSessions must be used within an AgentSessionsProvider",
    );
  }
  return context;
}

interface AgentSessionsProviderProps {
  readonly children: ReactNode;
}

/**
 * The single subscription.
 *
 * Every transition triggers a re-read of the list rather than a patch applied to
 * local state. The events carry only what changed about a process — a pid, an
 * exit code, an error — and reconstructing a row from them means keeping a
 * second model of the session table in the renderer, which can be wrong. The
 * list is bounded at fifty rows, so the honest option is also the cheap one.
 */
export function AgentSessionsProvider({
  children,
}: AgentSessionsProviderProps) {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.workspaceId ?? null;
  const [sessions, setSessions] = useState<readonly AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const isAvailable = agents.isAvailable();

  const refresh = useCallback(async () => {
    if (workspaceId === null || !isAvailable) {
      setSessions([]);
      setLoading(false);
      return;
    }
    try {
      const next = await agents.listSessions(workspaceId);
      if (mountedRef.current) {
        setSessions(next);
        setError(null);
      }
    } catch (cause: unknown) {
      if (mountedRef.current) setError(describe(cause));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [workspaceId, isAvailable]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    // Subscribed even when there is no workspace yet: the subscription is to
    // main, not to a workspace, and re-subscribing per workspace switch would
    // drop events in the gap.
    const unsubscribe = agents.onSessionChanged(() => {
      void refresh();
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [refresh]);

  const killSession = useCallback(async (sessionId: string) => {
    // No refresh: the kill produces a real exit from the PTY host, and that
    // event refreshes the list with the exit code the row will actually carry.
    await agents.killSession(sessionId);
  }, []);

  const value = useMemo<AgentSessionsContextValue>(
    () => ({ sessions, loading, error, isAvailable, refresh, killSession }),
    [sessions, loading, error, isAvailable, refresh, killSession],
  );

  return (
    <AgentSessionsContext.Provider value={value}>
      {children}
    </AgentSessionsContext.Provider>
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default AgentSessionsContext;
