import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "../atoms/Button";
import { useUpdateStatus } from "../../contexts/UpdateStatusContext";

/**
 * Surfaces the one update moment that is worth interrupting for: a version is
 * downloaded and a restart away. The dot next to Settings is enough for "an
 * update exists"; it is not enough for "the fix you're waiting on is already on
 * disk", which is a thing the user would act on immediately if they knew.
 *
 * Dismissal is per-version and in-memory: "Later" gets out of the way for this
 * session, and a subsequent release re-earns the interruption. Nothing is lost
 * by dismissing — `autoInstallOnAppQuit` still applies the staged update when
 * the app closes, and Settings > Updates keeps the explicit restart button.
 */
export function UpdateReadyBanner() {
  const { status, restartAndInstall } = useUpdateStatus();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const version = status?.latestVersion ?? null;
  const ready = status?.state === "downloaded" && version !== null;

  // A newer release supersedes an earlier dismissal.
  useEffect(() => {
    if (
      dismissedVersion !== null &&
      version !== null &&
      version !== dismissedVersion
    ) {
      setDismissedVersion(null);
    }
  }, [version, dismissedVersion]);

  if (!ready || version === dismissedVersion) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-primary/30 bg-primary/5 px-4 py-2 dark:border-primary-light/30 dark:bg-primary-light/10"
    >
      <span className="min-w-0 flex-1 text-xs text-text-primary dark:text-text-primary-dark">
        <span className="font-medium">APIWeave v{version} is ready.</span>{" "}
        <span className="text-text-secondary dark:text-text-secondary-dark">
          Restart to install it.
        </span>
      </span>

      <Button
        variant="primary"
        size="xs"
        onClick={restartAndInstall}
        icon={<RefreshCw className="h-3 w-3" />}
      >
        Restart now
      </Button>

      <Button
        variant="ghost"
        size="xs"
        onClick={() => setDismissedVersion(version)}
        icon={<X className="h-3 w-3" />}
        aria-label={`Dismiss the v${version} update notice`}
      >
        Later
      </Button>
    </div>
  );
}
