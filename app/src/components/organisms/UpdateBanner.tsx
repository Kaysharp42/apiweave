import { useState } from "react";
import { Download, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "../atoms/Button";
import { useUpdateStatus } from "../../contexts/UpdateStatusContext";

/**
 * Surfaces the update moments worth interrupting for. There are two, and the
 * default `notify` policy means most users only ever see the first:
 *
 * - `available` — a release exists and nothing has been downloaded yet. Under
 *   `notify` the download never starts on its own, so without this the release
 *   waits behind a dot on the Settings icon that nobody goes looking for.
 * - `downloaded` — a version is on disk, a restart away. The dot is enough for
 *   "an update exists"; it is not enough for "the fix you're waiting on is
 *   already here", which the user would act on immediately if they knew.
 *
 * `downloading` only shows once the user asked for it from here — a background
 * download under the `automatic` policy is not news, but a progress line
 * vanishing the instant you click Download reads as the click having failed.
 *
 * Dismissal is per version *and* per state, in memory: "Later" gets out of the
 * way for this session, and both a newer release and the same release becoming
 * installable re-earn the interruption. Nothing is lost by dismissing —
 * `autoInstallOnAppQuit` still applies a staged update when the app closes, and
 * Settings > Updates keeps every control this banner shortcuts to.
 */
export function UpdateBanner() {
  const { status, download, restartAndInstall, openReleasePage } =
    useUpdateStatus();
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Set when the download starts from this banner, so the progress line only
  // interrupts the user who asked for it.
  const [engaged, setEngaged] = useState(false);

  const version = status?.latestVersion ?? null;
  const state = status?.state ?? null;
  if (version === null) return null;

  const showing =
    state === "available" ||
    state === "downloaded" ||
    (state === "downloading" && engaged);
  if (!showing) return null;

  // Per state as well as per version: dismissing "available" must not swallow
  // the "ready to restart" notice that the same version turns into later.
  const signature = `${state}:${version}`;
  if (signature === dismissed) return null;

  const canSelfInstall = status?.supportsAutoInstall === true;
  const percent = status?.downloadProgressPercent;

  const { Icon, headline, detail, action } = (() => {
    if (state === "downloaded") {
      return {
        Icon: RefreshCw,
        headline: `APIWeave v${version} is ready.`,
        detail: "Restart to install it.",
        action: {
          label: "Restart now",
          icon: <RefreshCw className="h-3 w-3" />,
          onClick: () => void restartAndInstall(),
        },
      };
    }
    if (state === "downloading") {
      return {
        Icon: Loader2,
        headline: `Downloading APIWeave v${version}…`,
        detail:
          typeof percent === "number"
            ? `${Math.round(percent)}% — it installs on your next restart.`
            : "It installs on your next restart.",
        action: null,
      };
    }
    // "available" — the split is what this platform can actually do about it.
    return canSelfInstall
      ? {
          Icon: Download,
          headline: `APIWeave v${version} is available.`,
          detail: "Download it now — it installs on your next restart.",
          action: {
            label: "Download update",
            icon: <Download className="h-3 w-3" />,
            onClick: () => {
              setEngaged(true);
              void download();
            },
          },
        }
      : {
          Icon: ExternalLink,
          headline: `APIWeave v${version} is available.`,
          detail:
            "This build can't update itself — open the release page to download it.",
          action: {
            label: "View release",
            icon: <ExternalLink className="h-3 w-3" />,
            onClick: () => void openReleasePage(),
          },
        };
  })();

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-primary/30 bg-primary/5 px-4 py-2 dark:border-primary-light/30 dark:bg-primary-light/10"
    >
      <Icon
        className={`h-4 w-4 shrink-0 text-primary dark:text-primary-light ${
          state === "downloading"
            ? "animate-spin motion-reduce:animate-none"
            : ""
        }`}
        aria-hidden="true"
      />

      <span className="min-w-0 flex-1 text-xs text-text-primary dark:text-text-primary-dark">
        <span className="font-medium">{headline}</span>{" "}
        <span className="text-text-secondary dark:text-text-secondary-dark">
          {detail}
        </span>
      </span>

      {/* Release notes are the answer to "what's in it?", which is the question
          standing between the user and the primary action. */}
      {state !== "downloaded" && status?.releaseUrl && canSelfInstall && (
        <button
          type="button"
          onClick={() => void openReleasePage()}
          className="shrink-0 cursor-pointer text-xs text-text-secondary underline underline-offset-2 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:text-text-secondary-dark dark:hover:text-text-primary-dark dark:focus-visible:outline-primary-light"
        >
          What's new
        </button>
      )}

      {action && (
        <Button
          variant="primary"
          size="xs"
          onClick={action.onClick}
          icon={action.icon}
        >
          {action.label}
        </Button>
      )}

      <Button
        variant="ghost"
        size="xs"
        onClick={() => setDismissed(signature)}
        icon={<X className="h-3 w-3" />}
        aria-label={`Dismiss the v${version} update notice`}
      >
        Later
      </Button>
    </div>
  );
}
