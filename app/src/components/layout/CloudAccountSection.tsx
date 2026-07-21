import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Cloud,
  CloudOff,
  FolderSync,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../atoms/Button";
import { useCloudSync } from "../../hooks/useCloudSync";
import { IpcError } from "../../utils/apiweaveClient";
import type { CloudSyncStatus } from "../../types/cloud";

interface CloudAccountSectionProps {
  /** Close the account menu (called before navigating away). */
  readonly onNavigate?: () => void;
  /** Assign focusable controls to the menu's roving-tabindex ref array. */
  readonly registerItem?: (
    index: number,
  ) => (element: HTMLButtonElement | null) => void;
  /** First menu-item index this section may claim. */
  readonly startIndex?: number;
}

function reportError(error: unknown): void {
  const message =
    error instanceof IpcError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Cloud sync request failed";
  toast.error(message);
}

function formatSyncedAt(iso?: string): string {
  if (!iso) return "Not synced yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return `Last synced ${date.toLocaleString()}`;
}

/**
 * State-specific cloud controls rendered inside the account menu. Reads the
 * shared cloud status and shows exactly one primary action per state, always
 * with visible text describing what happens next. Deep management (workspace
 * chooser, diagnostics, unlink) lives on the /cloud/sync route.
 */
export function CloudAccountSection({
  onNavigate,
  registerItem,
  startIndex = 1,
}: CloudAccountSectionProps) {
  const navigate = useNavigate();
  const cloud = useCloudSync();
  const { status, unavailable, busy } = cloud;

  // Not in an Electron runtime (web preview) — cloud sync is desktop-only.
  if (unavailable) return null;

  const goTo = (path: string) => {
    onNavigate?.();
    navigate(path);
  };

  const itemRef = (offset: number) => registerItem?.(startIndex + offset);

  const wrap =
    (action: () => Promise<CloudSyncStatus>) => async (): Promise<void> => {
      try {
        await action();
      } catch (error) {
        reportError(error);
      }
    };

  const syncNow = wrap(async () => {
    const next = await cloud.pull();
    await cloud.push().catch(() => next);
    return cloud.refreshWorkspaceCatalog();
  });

  const heading = (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
        <Cloud className="h-3 w-3 text-primary dark:text-primary-light" />
        Cloud account
      </span>
      {status?.account?.email ? (
        <span className="truncate font-mono text-[11px] text-text-muted dark:text-text-muted-dark">
          {status.account.email}
        </span>
      ) : null}
    </div>
  );

  const body = (): ReactNode => {
    // First load — status not yet resolved.
    if (status === null) {
      return (
        <div
          className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          Checking cloud status…
        </div>
      );
    }

    // Linking — browser handoff in progress.
    if (status.linkState === "linking") {
      return (
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-start gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
            <span>Finish signing in through your browser, then return here.</span>
          </div>
          <Button
            ref={itemRef(0)}
            role="menuitem"
            variant="secondary"
            size="sm"
            fullWidth
            loading={busy}
            onClick={() => void wrap(cloud.cancelLink)()}
          >
            Cancel
          </Button>
        </div>
      );
    }

    // Unlinked — the entry action.
    if (status.linkState === "unlinked") {
      return (
        <div className="space-y-2">
          <p className="text-[11px] text-text-secondary dark:text-text-secondary-dark">
            Sync workflows, projects, and environments across your devices.
            Secrets and run history stay local.
          </p>
          <Button
            ref={itemRef(0)}
            role="menuitem"
            variant="primary"
            size="sm"
            fullWidth
            loading={busy}
            icon={<Cloud className="h-4 w-4" />}
            onClick={() => void wrap(() => cloud.link())()}
          >
            Link cloud account
          </Button>
        </div>
      );
    }

    // Session expired — reauthenticate without touching local data.
    if (status.linkState === "authenticationRequired") {
      return (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg bg-status-warning/10 px-2.5 py-2 text-[11px] text-text-secondary dark:text-text-secondary-dark">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning dark:text-status-warning-dark" />
            <span>Your cloud session expired. Sign in again to resume sync.</span>
          </div>
          <Button
            ref={itemRef(0)}
            role="menuitem"
            variant="primary"
            size="sm"
            fullWidth
            loading={busy}
            onClick={() => void wrap(() => cloud.link())()}
          >
            Relink account
          </Button>
        </div>
      );
    }

    // linkState === "linked" from here on.

    // Linked but nothing bound — needs a workspace choice.
    if (status.bindings.length === 0) {
      return (
        <div className="space-y-2">
          <p className="text-[11px] text-text-secondary dark:text-text-secondary-dark">
            Choose a cloud workspace to start syncing this device.
          </p>
          <Button
            ref={itemRef(0)}
            role="menuitem"
            variant="primary"
            size="sm"
            fullWidth
            icon={<FolderSync className="h-4 w-4" />}
            onClick={() => goTo("/cloud/sync")}
          >
            Choose workspace
          </Button>
        </div>
      );
    }

    // Conflicts take priority over the routine active view.
    if (status.conflictCount > 0) {
      return (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg bg-status-warning/10 px-2.5 py-2 text-[11px] text-text-secondary dark:text-text-secondary-dark">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning dark:text-status-warning-dark" />
            <span>
              {status.conflictCount} sync{" "}
              {status.conflictCount === 1 ? "conflict needs" : "conflicts need"}{" "}
              your review.
            </span>
          </div>
          <Button
            ref={itemRef(0)}
            role="menuitem"
            variant="primary"
            size="sm"
            fullWidth
            onClick={() => goTo("/cloud/conflicts")}
          >
            Resolve conflicts
          </Button>
        </div>
      );
    }

    // Error / dead-letter — send the user to diagnostics.
    if (
      status.syncState === "error" ||
      status.deadLetterCount > 0 ||
      status.lastError
    ) {
      return (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg bg-status-error/10 px-2.5 py-2 text-[11px] text-text-secondary dark:text-text-secondary-dark">
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-status-error dark:text-status-error-dark" />
            <span className="min-w-0 break-words">
              {status.lastError ?? "Sync stopped with an error."}
            </span>
          </div>
          <Button
            ref={itemRef(0)}
            role="menuitem"
            variant="secondary"
            size="sm"
            fullWidth
            onClick={() => goTo("/cloud/sync")}
          >
            Open Cloud Sync
          </Button>
        </div>
      );
    }

    // Initializing / syncing — show progress and lock out duplicate actions.
    if (status.syncState === "initializing" || status.syncState === "syncing") {
      return (
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {status.syncState === "initializing"
              ? "Setting up first sync…"
              : "Syncing…"}
          </div>
          <Button
            ref={itemRef(0)}
            role="menuitem"
            variant="secondary"
            size="sm"
            fullWidth
            onClick={() => goTo("/cloud/sync")}
          >
            View progress
          </Button>
        </div>
      );
    }

    // Offline — synced later; let the user retry.
    const offline = status.syncState === "offline";

    // Active / idle — the steady state.
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[11px] text-text-secondary dark:text-text-secondary-dark">
          {offline ? (
            <CloudOff className="h-3.5 w-3.5 shrink-0 text-text-muted dark:text-text-muted-dark" />
          ) : (
            <Cloud className="h-3.5 w-3.5 shrink-0 text-status-success dark:text-status-success-dark" />
          )}
          <span className="truncate">
            {offline ? "Offline — will sync when reconnected" : formatSyncedAt(status.lastSyncedAt)}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            ref={itemRef(0)}
            role="menuitem"
            variant="primary"
            size="sm"
            fullWidth
            loading={busy}
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void syncNow()}
          >
            Sync now
          </Button>
          <Button
            ref={itemRef(1)}
            role="menuitem"
            variant="secondary"
            size="sm"
            onClick={() => goTo("/cloud/sync")}
          >
            Manage
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border px-3 py-2.5 dark:border-border-dark">
      {heading}
      {body()}
    </div>
  );
}
