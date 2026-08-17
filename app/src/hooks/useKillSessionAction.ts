import { useCallback, useEffect, useRef } from "react";
import { describeError } from "../utils/describeError";

/**
 * The "stop this session" action shared by the sessions list and the dock.
 *
 * A kill can be refused — the process may already be gone, or the session may
 * not be ours to stop. The earlier `void killSession(...)` turned that into an
 * unhandled rejection behind a button that appeared to do nothing, which
 * invites the user to press it again. The wrapped action reports the refusal
 * through `reportError` instead, guarded so a failure settling after unmount
 * is dropped rather than written to a dead component.
 */
export function useKillSessionAction(
  killSession: (sessionId: string) => Promise<unknown>,
  reportError: (message: string | null) => void,
): (sessionId: string) => void {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return useCallback(
    (sessionId: string) => {
      // Clear first: a message left over from the last attempt sits on screen
      // contradicting the action now in flight.
      reportError(null);
      void killSession(sessionId).catch((cause: unknown) => {
        if (mountedRef.current) reportError(describeError(cause));
      });
    },
    [killSession, reportError],
  );
}
