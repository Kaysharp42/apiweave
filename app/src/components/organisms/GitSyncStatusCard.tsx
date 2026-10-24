import { Link } from "react-router-dom";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { Button } from "../atoms/Button";
import { GitSyncKindIcon } from "../molecules/GitSyncKindIcon";
import { describeGitSync, GIT_SYNC_INTENT_TEXT, gitSyncPrimaryLabel } from "../../utils/gitSync";
import type { GitSyncStatusCardProps, SyncButtonsProps } from "../../types";

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
 * What the state offers: Review merge while a merge waits on conflicts, Retry
 * when it is stuck, otherwise Sync now (Commit now with no remote) — one
 * action under several names, so a retry in manual mode with edits waiting asks
 * for its commit message too — and Discard local changes where that is the way
 * out. A missing author has neither primary action: only the settings form
 * settles it. A local history with nothing uncommitted has nothing to commit,
 * so it offers no primary action either.
 */
function SyncButtons({ status, view, offerDiscard, actions }: SyncButtonsProps) {
  const running = view.kind === "syncing";
  const merging = status.state === "merging";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!view.needsAuthor && view.kind !== "local" && (
        <Button
          variant="primary"
          size="sm"
          loading={actions.busy || running}
          onClick={merging ? actions.askToResolveMerge : actions.sync}
        >
          {gitSyncPrimaryLabel(status)}
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
  const offerDiscard = connected && (alwaysOfferDiscard || view.kind === "attention");

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 text-sm font-semibold ${GIT_SYNC_INTENT_TEXT[view.intent]}`}>
        <GitSyncKindIcon indicator={view} />
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
        status={status}
        view={view}
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
