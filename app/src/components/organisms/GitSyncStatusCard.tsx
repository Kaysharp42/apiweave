import { Link } from "react-router-dom";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { Button } from "../atoms/Button";
import { GitSyncKindIcon } from "../molecules/GitSyncKindIcon";
import { describeGitSync } from "../../utils/gitSync";
import type { GitSyncStatusCardProps, SyncButtonsProps } from "../../types";

const INTENT_TEXT = {
  success: "text-status-success dark:text-[var(--aw-status-success)]",
  warning: "text-status-warning dark:text-[var(--aw-status-warning)]",
  info: "text-status-info dark:text-[var(--aw-status-info)]",
  error: "text-status-error dark:text-[var(--aw-status-error)]",
} as const;

/** When the workspace last agreed with its remote, and the commit it is at. */
function lastSyncLines(status: WorkspaceGitStatus): string[] {
  const { lastSyncedAt, lastCommit } = status;
  return [
    lastSyncedAt === null
      ? null
      : `Last synced ${new Date(lastSyncedAt).toLocaleString()}`,
    lastCommit === null
      ? null
      : `Last commit ${lastCommit.sha.slice(0, 7)} ${lastCommit.subject}`,
  ].filter((line): line is string => line !== null);
}

/**
 * What the state offers: Retry when it is stuck, otherwise Sync now (Commit
 * now with no remote) — one action under two names, so a retry in manual mode
 * with edits waiting asks for its commit message too — and Discard local
 * changes where that is the way out. A missing author has neither primary
 * action: only the settings form settles it.
 */
function SyncButtons({ view, connected, offerDiscard, actions }: SyncButtonsProps) {
  const stuck = view.kind === "error" || view.kind === "read-only";
  const running = view.kind === "syncing";
  const primaryLabel = stuck ? "Retry" : connected ? "Sync now" : "Commit now";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!view.needsAuthor && (
        <Button
          variant="primary"
          size="sm"
          loading={actions.busy || running}
          onClick={actions.sync}
        >
          {primaryLabel}
        </Button>
      )}
      {offerDiscard && (
        <Button
          variant="outline"
          intent="error"
          size="sm"
          disabled={actions.busy || running}
          onClick={actions.askToDiscard}
        >
          Discard local changes
        </Button>
      )}
    </div>
  );
}

/**
 * A workspace's sync state in words — what it is, what it means, what to do —
 * and the actions that fit it. Shared by the header's popover and the settings
 * panel, so the two never word a state differently.
 */
export function GitSyncStatusCard({
  status,
  actions,
  alwaysOfferDiscard = false,
  settingsPath,
  onNavigate,
}: GitSyncStatusCardProps) {
  const view = describeGitSync(status);
  const connected = status.remoteUrl !== null;
  const offerDiscard =
    connected &&
    (alwaysOfferDiscard || view.kind === "merging" || view.kind === "diverged" || view.kind === "read-only");

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 text-sm font-semibold ${INTENT_TEXT[view.intent]}`}>
        <GitSyncKindIcon kind={view.kind} local={!connected} />
        <span>{view.label}</span>
      </div>
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
        {view.explanation}
      </p>
      {view.detail !== null && (
        <p className="max-h-20 overflow-y-auto break-words font-mono text-xxs text-text-muted dark:text-text-muted-dark">
          {view.detail}
        </p>
      )}
      <ul className="space-y-0.5 text-xs text-text-muted dark:text-text-muted-dark">
        {lastSyncLines(status).map((line) => (
          <li key={line} className="break-words">
            {line}
          </li>
        ))}
      </ul>
      {actions.error !== null && (
        <p role="alert" className="text-xs text-status-error dark:text-[var(--aw-status-error)]">
          {actions.error}
        </p>
      )}
      <SyncButtons
        view={view}
        connected={connected}
        offerDiscard={offerDiscard}
        actions={actions}
      />
      {settingsPath !== undefined && (
        <Link
          to={settingsPath}
          onClick={onNavigate}
          className="inline-block text-xs text-primary underline-offset-2 hover:underline dark:text-primary-light"
        >
          {view.needsAuthor ? "Set your name and email" : "Version history settings"}
        </Link>
      )}
    </div>
  );
}
