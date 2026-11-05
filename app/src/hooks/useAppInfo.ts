import { useEffect, useState } from "react";
import type { AppInfo } from "@shared/types/AppInfo";
import { apiweave } from "../utils/apiweaveClient";

/**
 * Read the app details from main, while `active` is true.
 *
 * Everything the About dialog reports comes from the `app` IPC domain; it never
 * guesses an Electron or Node version from the bundle it is running in. The
 * details are dropped as soon as the read starts so a reopened dialog never
 * shows the previous read's numbers while the new one is in flight.
 */
export function useAppInfo(active: boolean): {
  info: AppInfo | null;
  loadError: string | null;
} {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setInfo(null);
    setLoadError(null);
    apiweave.app
      .info()
      .then((loaded) => {
        if (!cancelled) setInfo(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "The app details could not be read.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { info, loadError };
}
