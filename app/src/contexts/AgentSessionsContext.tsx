// fallow-ignore-file code-duplication -- the shared shape with UpdateStatusContext ("one IPC subscription behind a context, hook throws outside the provider") is a consumer contract this file names explicitly in its own docs, not copied logic: the subscription, the state, and the mutators are entirely different, and merging them would mean threading a factory through a pre-existing context file for a 40-line pattern echo; fallow 2.104 has no range form, so file-level is the narrowest marker that still covers the group
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
  /**
   * Which sessions are printing right now. Held here and nowhere else because
   * it is the one piece of session state that is not on the row: it never
   * reaches the database (see `agent.activity`), so a re-read cannot recover it
   * and a component that mounts late simply starts from "quiet" — which the
   * next chunk of output corrects within a frame.
   */
  const [busySessionIds, setBusySessionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
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
    const unsubscribe = agents.onSessionChanged((event) => {
      if (event.kind === "agent.activity") {
        // Emphatically not a refresh. Activity changes nothing the session row
        // records, and an agent that prints in bursts would otherwise put an
        // IPC round trip and a table read behind every one of them — for a
        // list that would come back byte-identical.
        setBusySessionIds((current) =>
          withBusy(current, event.sessionId, event.busy),
        );
        return;
      }
      // A session that has just ended is not busy, whatever the last activity
      // event said. The host stops reporting at the exit rather than sending a
      // final "quiet", so this is where the flag is cleared — and clearing it
      // here also keeps the set from holding ids of rows that are gone.
      if (event.kind !== "agent.started") {
        setBusySessionIds((current) => withBusy(current, event.sessionId, false));
      }
      void refresh();
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [refresh]);

  // Both mutators reject on failure rather than absorbing it into `error`. The
  // provider's `error` is about the *list* — a failed read that leaves every row
  // stale — and a failed kill or delete is about one row, next to the control
  // the user just pressed. Absorbing it here would put the message at the top of
  // a panel the user is not looking at, and would also hide the failure from a
  // caller that wants to keep its own button in the pressed state.
  const killSession = useCallback(async (sessionId: string) => {
    // No refresh: the kill produces a real exit from the PTY host, and that
    // event refreshes the list with the exit code the row will actually carry.
    await agents.killSession(sessionId);
  }, []);

  const resumeSession = useCallback(
    async (sessionId: string, cols: number, rows: number) => {
      const resumed = await agents.resumeSession(sessionId, cols, rows);
      // Refreshed explicitly rather than left to the event. The row's status,
      // exit code and `startedAt` have all just changed, and the last of those
      // is half the terminal's React key — so until the list is re-read, the
      // dock is still showing the previous run's terminal, attached to a port
      // the host has already closed.
      await refresh();
      return resumed.sessionId;
    },
    [refresh],
  );

  const removeSession = useCallback(
    async (sessionId: string) => {
      // Refreshed explicitly, unlike the kill: deleting a record produces no
      // process event, so nothing else would ever tell the list the row is gone.
      await agents.deleteSession(sessionId);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<AgentSessionsContextValue>(
    () => ({
      sessions,
      busySessionIds,
      loading,
      error,
      isAvailable,
      refresh,
      killSession,
      removeSession,
      resumeSession,
    }),
    [
      sessions,
      busySessionIds,
      loading,
      error,
      isAvailable,
      refresh,
      killSession,
      removeSession,
      resumeSession,
    ],
  );

  return (
    <AgentSessionsContext.Provider value={value}>
      {children}
    </AgentSessionsContext.Provider>
  );
}

/**
 * The set with one session's flag set, or the very same set when it already
 * said that. Identity is the point: activity events arrive on the edges of
 * every burst an agent prints, and returning a fresh `Set` each time would
 * re-render the whole session list for a value that did not change.
 */
function withBusy(
  current: ReadonlySet<string>,
  sessionId: string,
  busy: boolean,
): ReadonlySet<string> {
  if (current.has(sessionId) === busy) return current;
  const next = new Set(current);
  if (busy) next.add(sessionId);
  else next.delete(sessionId);
  return next;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default AgentSessionsContext;
