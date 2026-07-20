import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Cloud,
  CloudOff,
  GitCompareArrows,
  Link2,
  Loader2,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Badge } from "../../components/atoms/Badge";
import { Button } from "../../components/atoms/Button";
import { EmptyState } from "../../components/molecules/EmptyState";
import { ConfirmDialog } from "../../components/molecules/ConfirmDialog";
import { useCloudSync } from "../../hooks/useCloudSync";
import { IpcError } from "../../utils/apiweaveClient";
import type { ContractErrorCode } from "@shared/contract/errors";
import type { CloudSyncStatus, CloudWorkspaceBinding } from "../../types/cloud";

// Fallback sentences for the rare IpcError with no server message. Codes must
// never surface raw — every error the user sees is a sentence.
const CODE_MESSAGES: Partial<Record<ContractErrorCode, string>> = {
  denied: "You don't have permission to do that.",
  not_found: "That workspace or record no longer exists.",
  validation: "That request wasn't valid. Try again.",
};

function reportError(error: unknown): void {
  let message = "Cloud sync request failed.";
  if (error instanceof IpcError) {
    message = error.message || CODE_MESSAGES[error.code] || message;
  } else if (error instanceof Error && error.message) {
    message = error.message;
  }
  toast.error(message);
}

function isLocalOnlyConfirmation(error: unknown): boolean {
  return (
    error instanceof IpcError &&
    typeof error.details === "object" &&
    error.details !== null &&
    "localOnlyConfirmationRequired" in error.details &&
    (error.details as { localOnlyConfirmationRequired?: unknown })
      .localOnlyConfirmationRequired === true
  );
}

function formatSyncedAt(iso?: string): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
}

const SYNC_STATE_LABELS: Partial<Record<CloudSyncStatus["syncState"], string>> = {
  initializing: "Reconnecting…",
  syncing: "Syncing…",
  offline: "Offline — will resume when you're back online",
};

export function CloudSyncPage() {
  const navigate = useNavigate();
  const cloud = useCloudSync();
  const { status, loading, unavailable, busy } = cloud;

  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [confirmLocalOnly, setConfirmLocalOnly] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const wrap = useCallback(
    (action: () => Promise<CloudSyncStatus>, successMsg?: string) =>
      async (): Promise<void> => {
        try {
          await action();
          if (successMsg) toast.success(successMsg);
        } catch (error) {
          reportError(error);
        }
      },
    [],
  );

  const doUnlink = async (localOnly: boolean): Promise<void> => {
    try {
      await cloud.unlink(localOnly);
      setConfirmUnlink(false);
      setConfirmLocalOnly(false);
      toast.success("Cloud account disconnected");
    } catch (error) {
      if (!localOnly && isLocalOnlyConfirmation(error)) {
        setConfirmUnlink(false);
        setConfirmLocalOnly(true);
        return;
      }
      reportError(error);
    }
  };

  const syncNow = (workspaceId: string) =>
    wrap(async () => {
      const binding = status?.bindings.find((b) => b.workspaceId === workspaceId);
      if (binding && binding.initializationState !== "initialized") {
        return cloud.initializeWorkspace(workspaceId);
      }
      const next = await cloud.pull();
      return cloud.push().catch(() => next);
    }, "Sync started");

  const goBack = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  }, [navigate]);

  const header = (
    <div className="border-b border-border px-6 py-6 dark:border-border-dark">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={goBack}
          aria-label="Back to app"
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <Cloud
          className="h-5 w-5 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary dark:text-text-primary-dark">
            Cloud Sync
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            Link a cloud account and your workspaces sync automatically. Secrets,
            run history, and local auth never leave this device.
          </p>
        </div>
      </div>
    </div>
  );

  if (unavailable) {
    return (
      <div className="flex h-full flex-col bg-surface dark:bg-surface-dark">
        {header}
        <div className="flex-1 p-6">
          <EmptyState
            icon={<CloudOff className="h-12 w-12 text-text-muted" strokeWidth={1.5} />}
            title="Cloud sync is desktop-only"
            description="Open APIWeave Desktop to link a cloud account and sync workspaces."
          />
        </div>
      </div>
    );
  }

  if (loading && status === null) {
    return (
      <div className="flex h-full flex-col bg-surface dark:bg-surface-dark">
        {header}
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-text-secondary dark:text-text-secondary-dark">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
          Loading cloud status…
        </div>
      </div>
    );
  }

  const linked = status?.linked ?? false;
  const linkState = status?.linkState ?? "unlinked";
  const syncStateLabel = status ? SYNC_STATE_LABELS[status.syncState] : undefined;

  return (
    <div className="flex h-full flex-col bg-surface dark:bg-surface-dark">
      {header}
      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {/* Account */}
        <section className="rounded-sm border border-border bg-surface-raised p-4 dark:border-border-dark dark:bg-surface-dark-raised">
          {!linked ? (
            <div className="flex flex-col items-start gap-3">
              <div>
                <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                  Not linked
                </h2>
                <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                  Sign in through your browser to connect this device to APIWeave
                  Cloud.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                loading={busy || linkState === "linking"}
                icon={<Link2 className="h-4 w-4" />}
                onClick={() => void wrap(() => cloud.link())()}
              >
                {linkState === "linking" ? "Waiting for browser…" : "Link cloud account"}
              </Button>
              {linkState === "linking" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void wrap(cloud.cancelLink)()}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                  {status?.account?.displayName ??
                    status?.account?.email ??
                    "Linked account"}
                </h2>
                {status?.account?.email ? (
                  <p className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark">
                    {status.account.email}
                  </p>
                ) : null}
                {status?.device ? (
                  <p className="mt-1 text-[11px] text-text-muted dark:text-text-muted-dark">
                    Device: {status.device.label} · v{status.device.clientVersion}
                  </p>
                ) : null}
                {linkState === "authenticationRequired" ? (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-status-warning dark:text-status-warning-dark">
                    <AlertTriangle className="h-4 w-4" />
                    Session expired — relink to resume sync.
                  </div>
                ) : syncStateLabel ? (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-secondary dark:text-text-secondary-dark">
                    {status?.syncState === "offline" ? null : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    )}
                    {syncStateLabel}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {linkState === "authenticationRequired" ? (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() => void wrap(() => cloud.link())()}
                  >
                    Relink
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  icon={<RefreshCw className="h-4 w-4" />}
                  onClick={() =>
                    void wrap(
                      cloud.refreshWorkspaceCatalog,
                      "Checked for new workspaces",
                    )()
                  }
                >
                  Check for new workspaces
                </Button>
                <Button
                  variant="ghost"
                  intent="error"
                  size="sm"
                  icon={<Unlink className="h-4 w-4" />}
                  onClick={() => setConfirmUnlink(true)}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Synced workspaces */}
        {linked ? (
          <section className="rounded-sm border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised">
            <div className="border-b border-border px-4 py-3 dark:border-border-dark">
              <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                Synced workspaces
              </h2>
            </div>
            {(status?.bindings.length ?? 0) === 0 ? (
              <EmptyState
                icon={<Cloud className="h-12 w-12 text-text-muted" strokeWidth={1.5} />}
                title="Your workspaces sync automatically"
                description="Create one from the workspace switcher, or they'll appear here once linked. Use “Check for new workspaces” to pull in workspaces added elsewhere."
              />
            ) : (
              <ul className="divide-y divide-border dark:divide-border-dark">
                {status?.bindings.map((binding) => (
                  <BindingRow
                    key={binding.workspaceId}
                    binding={binding}
                    busy={busy}
                    onSync={() => void syncNow(binding.workspaceId)()}
                    onStopSyncing={() =>
                      void wrap(
                        () => cloud.unbindWorkspace(binding.workspaceId),
                        "Stopped syncing (local data kept)",
                      )()
                    }
                    onResolve={() => navigate("/cloud/conflicts")}
                    onRetryDeadLetters={() =>
                      void wrap(
                        () => cloud.retryDeadLetters(binding.workspaceId),
                        "Retrying failed changes",
                      )()
                    }
                    onDiscardDeadLetters={() =>
                      setConfirmDiscard(binding.workspaceId)
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        onConfirm={() => void doUnlink(false)}
        title="Disconnect cloud account?"
        message="Sync stops and cloud credentials are removed from this device. Your local workspaces, workflows, and secrets are kept. The device will be revoked in the cloud."
        confirmLabel="Disconnect"
        intent="error"
      />
      <ConfirmDialog
        open={confirmLocalOnly}
        onClose={() => setConfirmLocalOnly(false)}
        onConfirm={() => void doUnlink(true)}
        title="Disconnect locally anyway?"
        message="The cloud device could not be revoked (you may be offline). Cloud access may remain active until you revoke this device from another session. Disconnect locally now?"
        confirmLabel="Disconnect locally"
        intent="warning"
      />
      <ConfirmDialog
        open={confirmDiscard !== null}
        onClose={() => setConfirmDiscard(null)}
        onConfirm={() => {
          const workspaceId = confirmDiscard;
          setConfirmDiscard(null);
          if (workspaceId) {
            void wrap(
              () => cloud.discardDeadLetters(workspaceId),
              "Discarded failed changes",
            )();
          }
        }}
        title="Discard failed changes?"
        message="This drops the queued changes that could not sync. Your local workflows, projects, and environments are kept — they just stop trying to upload. This cannot be undone; edit and save a record again to re-queue it."
        confirmLabel="Discard failed changes"
        intent="error"
      />
    </div>
  );
}

interface BindingRowProps {
  readonly binding: CloudWorkspaceBinding;
  readonly busy: boolean;
  readonly onSync: () => void;
  readonly onStopSyncing: () => void;
  readonly onResolve: () => void;
  readonly onRetryDeadLetters: () => void;
  readonly onDiscardDeadLetters: () => void;
}

function BindingRow({
  binding,
  busy,
  onSync,
  onStopSyncing,
  onResolve,
  onRetryDeadLetters,
  onDiscardDeadLetters,
}: BindingRowProps) {
  const initializing = binding.initializationState !== "initialized";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary dark:text-text-primary-dark">
            {binding.workspaceName}
          </span>
          {binding.teamName ? (
            <span className="truncate text-xs text-text-muted dark:text-text-muted-dark">
              {binding.teamName}
            </span>
          ) : null}
          {initializing ? (
            <Badge variant="warning">
              {binding.initializationState === "pulling"
                ? "Downloading…"
                : "Uploading…"}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted dark:text-text-muted-dark">
          <span>Last synced: {formatSyncedAt(binding.lastSyncedAt)}</span>
          {binding.pendingCount > 0 ? (
            <span>{binding.pendingCount} pending</span>
          ) : null}
          {binding.conflictCount > 0 ? (
            <span className="text-status-warning dark:text-status-warning-dark">
              {binding.conflictCount} conflict
              {binding.conflictCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {binding.deadLetterCount > 0 ? (
            <span className="text-status-error dark:text-status-error-dark">
              {binding.deadLetterCount} failed
            </span>
          ) : null}
        </div>
        {binding.lastError ? (
          <div className="mt-1 flex items-start gap-1.5 text-[11px] text-status-error dark:text-status-error-dark">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-words">{binding.lastError}</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {binding.conflictCount > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<GitCompareArrows className="h-4 w-4" />}
            onClick={onResolve}
          >
            Resolve
          </Button>
        ) : null}
        {binding.deadLetterCount > 0 ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={onRetryDeadLetters}
            >
              Retry failed
            </Button>
            <Button
              variant="ghost"
              intent="error"
              size="sm"
              onClick={onDiscardDeadLetters}
            >
              Discard failed
            </Button>
          </>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          icon={<RefreshCw className="h-4 w-4" />}
          onClick={onSync}
        >
          {initializing ? "Resume" : "Sync now"}
        </Button>
        <Button
          variant="ghost"
          intent="error"
          size="sm"
          icon={<Unlink className="h-4 w-4" />}
          onClick={onStopSyncing}
        >
          Stop syncing
        </Button>
      </div>
    </li>
  );
}
