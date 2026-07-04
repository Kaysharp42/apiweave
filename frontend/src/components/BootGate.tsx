import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Button } from "./atoms/Button";
import API_BASE_URL from "../utils/api";

// The desktop shell shows its window immediately and boots mongod/backend/worker
// in the background, so on first launch the backend isn't reachable for a few
// seconds. Gate the app on backend health so the user sees a "Starting…" screen
// instead of a wall of failed requests. No-op on web/Docker (no injected runtime).
const isDesktop = (): boolean =>
  typeof window !== "undefined" && Boolean(window.__APIWEAVE_RUNTIME__?.apiUrl);

const POLL_MS = 800;
const TIMEOUT_MS = 90_000;

type Phase = "booting" | "ready" | "error";

export function BootGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(() =>
    isDesktop() ? "booting" : "ready",
  );

  const poll = useCallback((): (() => void) | undefined => {
    if (!isDesktop()) return undefined;
    setPhase("booting");
    const start = Date.now();
    let stopped = false;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        const res = await fetch(`${API_BASE_URL}/health`);
        if (res.ok) {
          setPhase("ready");
          return;
        }
      } catch {
        // backend not up yet — keep polling
      }
      if (Date.now() - start > TIMEOUT_MS) {
        setPhase("error");
        return;
      }
      window.setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => poll(), [poll]);

  if (phase === "ready") return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--aw-surface)] p-6">
      <div className="max-w-md text-center">
        {phase === "booting" ? (
          <>
            <div className="mx-auto w-8 h-8 border-4 border-[var(--aw-primary)] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
            <h1 className="mt-4 text-xl font-semibold text-text-primary dark:text-text-primary-dark">
              Starting APIWeave…
            </h1>
            <p className="mt-2 text-sm text-text-secondary dark:text-text-secondary-dark">
              Bringing up the local database and services. This can take a few
              seconds on first launch.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-text-primary dark:text-text-primary-dark">
              Couldn’t start the local services
            </h1>
            <p className="mt-2 text-sm text-text-secondary dark:text-text-secondary-dark">
              The backend didn’t become ready in time. Make sure nothing is
              blocking the app, then retry.
            </p>
            <Button className="mt-4" onClick={() => poll()}>
              Retry
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
