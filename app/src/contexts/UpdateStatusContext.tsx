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
import { updates } from "../utils/apiweaveClient";
import type { UpdatePolicy, UpdateStatus } from "@shared/types/UpdateStatus";
import type { UpdateStatusContextValue } from "../types/UpdateStatusContextValue";

/**
 * A check against a warm connection can resolve in ~80ms, which reads as a
 * flicker rather than as work happening. Holding the spinner this long makes
 * "nothing changed" legible as an answer instead of a glitch.
 */
const MIN_CHECK_SPINNER_MS = 400;

/**
 * True when there is something for the user to act on: a notice they haven't
 * downloaded yet ("available" — the macOS/deb/rpm/pacman path, and the
 * notify/manual policies everywhere) or a staged install waiting on a restart
 * ("downloaded"). Deliberately excludes "downloading" — a background download
 * the user can't help along isn't worth a badge.
 */
export function hasPendingUpdate(status: UpdateStatus | null): boolean {
  return status?.state === "available" || status?.state === "downloaded";
}

const UpdateStatusContext = createContext<UpdateStatusContextValue | null>(null);

/**
 * Update status for every consumer in the tree.
 *
 * Throws outside a provider rather than falling back to its own subscription.
 * The fallback would work, which is the problem: update status is pushed from
 * main to *all* subscribers, so N independent hooks each hold an IPC listener
 * and each keep a separate copy of one piece of global state. That is invisible
 * at two consumers and quietly wrong at four — one of them re-checking on mount
 * moves everyone's status, and nothing in the types says so. Failing loudly is
 * what keeps the count at one.
 */
export function useUpdateStatus(): UpdateStatusContextValue {
  const context = useContext(UpdateStatusContext);
  if (context === null) {
    throw new Error(
      "useUpdateStatus must be used within an UpdateStatusProvider",
    );
  }
  return context;
}

interface UpdateStatusProviderProps {
  readonly children: ReactNode;
}

/**
 * The single subscription. Reads status once on mount and then stays in sync
 * with main's pushed `onStatusChanged` events, so a check started anywhere —
 * the launch check, the recurring background one, another component's button —
 * reaches every consumer through the same state.
 */
export function UpdateStatusProvider({ children }: UpdateStatusProviderProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void updates.getStatus().then((next) => {
      if (mountedRef.current) setStatus(next);
    });
    const unsubscribe = updates.onStatusChanged((next) => {
      if (mountedRef.current) setStatus(next);
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const [next] = await Promise.all([
        updates.check(),
        new Promise((resolve) => setTimeout(resolve, MIN_CHECK_SPINNER_MS)),
      ]);
      if (mountedRef.current) setStatus(next);
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, []);

  const download = useCallback(async () => {
    const next = await updates.download();
    if (mountedRef.current) setStatus(next);
  }, []);

  const setPolicy = useCallback(async (policy: UpdatePolicy) => {
    const next = await updates.setPolicy(policy);
    if (mountedRef.current) setStatus(next);
  }, []);

  const restartAndInstall = useCallback(() => updates.restartAndInstall(), []);
  const openReleasePage = useCallback(() => updates.openReleasePage(), []);
  const openLogFile = useCallback(() => updates.openLogFile(), []);

  const value = useMemo<UpdateStatusContextValue>(
    () => ({
      status,
      checking,
      pending: hasPendingUpdate(status),
      checkNow,
      download,
      setPolicy,
      restartAndInstall,
      openReleasePage,
      openLogFile,
      isAvailable: updates.isAvailable(),
    }),
    [
      status,
      checking,
      checkNow,
      download,
      setPolicy,
      restartAndInstall,
      openReleasePage,
      openLogFile,
    ],
  );

  return (
    <UpdateStatusContext.Provider value={value}>
      {children}
    </UpdateStatusContext.Provider>
  );
}

export default UpdateStatusContext;
