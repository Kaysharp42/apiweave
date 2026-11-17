import { useCallback, useState } from "react";
import type { UseBusyStepResult } from "../types/UseBusyStepResult";

/**
 * A dialog's one step at a time: busy while it runs, so its buttons wait, and
 * what it threw kept to show.
 */
export function useBusyStep(): UseBusyStepResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runStep = useCallback(async <T,>(step: () => Promise<T>, fallback: T): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await step();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      return fallback;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, runStep };
}
