import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { Modal } from "../molecules/Modal";
import { Button } from "../atoms/Button";
import { useUpdateStatus } from "../../contexts/UpdateStatusContext";
import type { UpdatePolicy, UpdateState } from "@shared/types/UpdateStatus";

interface UpdateSettingsModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

function statusLine(
  state: UpdateState,
  currentVersion: string,
  latestVersion: string | null,
): string {
  switch (state) {
    case "checking":
      return "Checking for updates…";
    case "downloading":
      return `Downloading v${latestVersion}…`;
    case "downloaded":
      return `v${latestVersion} is ready to install.`;
    case "available":
      return `v${latestVersion} is available.`;
    case "not-available":
      return `You're up to date (v${currentVersion}).`;
    case "error":
      return "Couldn't check for updates.";
    default:
      return `Running v${currentVersion}.`;
  }
}

/** Coarse relative time — the point is "the check ran recently", not precision. */
function lastCheckedLabel(at: number | null): string | null {
  if (at === null) return null;
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "Last checked just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return `Last checked ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last checked ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `Last checked ${days} day${days === 1 ? "" : "s"} ago`;
}

interface PolicyOption {
  readonly value: UpdatePolicy;
  readonly label: string;
  readonly description: string;
  /** False on platforms that can't install an update themselves. */
  readonly needsAutoInstall: boolean;
}

const POLICY_OPTIONS: readonly PolicyOption[] = [
  {
    value: "automatic",
    label: "Automatic",
    description:
      "Download new versions in the background and install them when you quit.",
    needsAutoInstall: true,
  },
  {
    value: "notify",
    label: "Notify me",
    description: "Check on launch, but only download when you say so.",
    needsAutoInstall: false,
  },
  {
    value: "manual",
    label: "Manual only",
    description: "Never check on its own. Use the button below.",
    needsAutoInstall: false,
  },
];

export function UpdateSettingsModal({
  isOpen,
  onClose,
}: UpdateSettingsModalProps) {
  const {
    status,
    checking,
    checkNow,
    download,
    setPolicy,
    restartAndInstall,
    openReleasePage,
    openLogFile,
    isAvailable,
  } = useUpdateStatus();

  const state = status?.state ?? "idle";
  const currentVersion = status?.currentVersion ?? "0.0.0";
  const latestVersion = status?.latestVersion ?? null;
  const supportsAutoInstall = status?.supportsAutoInstall ?? false;
  const policy = status?.policy ?? "notify";
  const lastChecked = lastCheckedLabel(status?.lastCheckedAt ?? null);

  // "Automatic" has nothing to automate where the app can't install its own
  // update — on those platforms the real choice is only whether it checks.
  const policyOptions = POLICY_OPTIONS.filter(
    (option) => supportsAutoInstall || !option.needsAutoInstall,
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Updates" size="md">
      <div className="space-y-5 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
            {statusLine(state, currentVersion, latestVersion)}
          </p>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            {supportsAutoInstall
              ? "Updates install on restart."
              : "This platform installs updates from GitHub Releases by hand — the app can only tell you one exists."}
          </p>
          {status?.error && (
            <p className="mt-1 text-xs text-status-error dark:text-[var(--aw-status-error)]">
              {status.error}
            </p>
          )}
        </div>

        {state === "downloading" && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay dark:bg-surface-dark-overlay">
            <div
              className="h-full rounded-full bg-[var(--aw-primary)] transition-[width]"
              style={{ width: `${status?.downloadProgressPercent ?? 0}%` }}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {state === "downloaded" && (
            <Button
              variant="primary"
              onClick={restartAndInstall}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Restart &amp; install
            </Button>
          )}

          {state === "available" && supportsAutoInstall && (
            <Button
              variant="primary"
              onClick={() => void download()}
              icon={<Download className="h-3.5 w-3.5" />}
            >
              Download v{latestVersion}
            </Button>
          )}

          {state !== "downloaded" && (
            <Button
              variant="secondary"
              onClick={() => void checkNow()}
              loading={checking || state === "checking"}
              disabled={!isAvailable}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Check for updates
            </Button>
          )}

          {(state === "available" || state === "error") && (
            <Button
              variant="ghost"
              onClick={() => void openReleasePage()}
              icon={
                supportsAutoInstall ? (
                  <ExternalLink className="h-3.5 w-3.5" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )
              }
            >
              Open release page
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted dark:text-text-muted-dark">
          {lastChecked !== null && <span>{lastChecked}</span>}
          {lastChecked !== null && isAvailable && <span aria-hidden="true">·</span>}
          {/* The one thing that makes "my update is stuck" answerable. Reveals
              the file rather than opening it, because the useful next step is
              attaching it to a bug report. */}
          {isAvailable && (
            <button
              type="button"
              onClick={() => void openLogFile()}
              className="underline decoration-dotted underline-offset-2 hover:text-text-secondary dark:hover:text-text-secondary-dark"
            >
              Show update log
            </button>
          )}
        </div>

        <fieldset className="border-t border-border pt-4 dark:border-border-dark">
          <legend className="sr-only">Update behaviour</legend>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
            When a new version exists
          </p>
          <div className="space-y-1">
            {policyOptions.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded px-2 py-2 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay"
              >
                <input
                  type="radio"
                  name="update-policy"
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-[var(--aw-primary)]"
                  checked={policy === option.value}
                  disabled={!isAvailable}
                  onChange={() => void setPolicy(option.value)}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-text-primary dark:text-text-primary-dark">
                    {option.label}
                  </span>
                  <span className="block text-xs text-text-secondary dark:text-text-secondary-dark">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {supportsAutoInstall && (
            // The user is the verification step until the installer is signed:
            // with no Authenticode publisher in app-update.yml, electron-updater
            // skips its publisher check and trusts a SHA512 that arrives over
            // the same channel as the download it vouches for.
            <p className="mt-2 px-2 text-xs text-text-muted dark:text-text-muted-dark">
              This build isn't code-signed yet, so &ldquo;Notify me&rdquo; is the
              default — approving each version is the only check there is.
            </p>
          )}
        </fieldset>

        {!isAvailable && (
          <p className="text-xs text-status-warning">
            Update checks are only available in the desktop app.
          </p>
        )}
      </div>
    </Modal>
  );
}
