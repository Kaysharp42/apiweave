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
  Lock,
  LockOpen,
  RefreshCw,
  ShieldCheck,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Badge } from "../../components/atoms/Badge";
import { Button } from "../../components/atoms/Button";
import { EmptyState } from "../../components/molecules/EmptyState";
import { ConfirmDialog } from "../../components/molecules/ConfirmDialog";
import { FailedRecordsDialog } from "./FailedRecordsDialog";
import { WorkspaceEncryptionDialog } from "./WorkspaceEncryptionDialog";
import { useCloudSync } from "../../hooks/useCloudSync";
import type { UseCloudSync } from "../../types/UseCloudSync";
import { IpcError } from "../../utils/apiweaveClient";
import type { ContractErrorCode } from "@shared/contract/errors";
import type {
  CloudFailedRecord,
  CloudPendingEncryptionDecision,
  CloudSyncStatus,
  CloudWorkspaceBinding,
  CloudWorkspaceEncryptionState,
} from "../../types/cloud";

// Fallback sentences for the rare IpcError with no server message. Codes must
// never surface raw — every error the user sees is a sentence.
const CODE_MESSAGES: Partial<Record<ContractErrorCode, string>> = {
  denied: "You don't have permission to do that.",
  not_found: "That workspace or record no longer exists.",
  validation: "That request wasn't valid. Try again.",
};

function errorMessage(error: unknown): string {
  if (error instanceof IpcError) {
    return (
      error.message || CODE_MESSAGES[error.code] || "Cloud sync request failed."
    );
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Cloud sync request failed.";
}

function reportError(error: unknown): void {
  toast.error(errorMessage(error));
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

/**
 * Which workspace an encryption dialog is open for, and what it is asking.
 * `decline` is the other permanent answer — no passphrase, its own confirm.
 */
interface PassphraseTarget {
  readonly mode: "setup" | "unlock" | "change" | "decline";
  readonly workspaceId: string;
  readonly workspaceName: string;
}

const ENCRYPTION_SUCCESS: Record<"setup" | "unlock" | "change", string> = {
  setup: "Workspace encrypted — keep that passphrase somewhere safe",
  unlock: "Workspace unlocked — sync resumed",
  change: "Passphrase changed. Send the new one to your team yourself.",
};

const SYNC_STATE_LABELS: Partial<Record<CloudSyncStatus["syncState"], string>> =
  {
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
  // The workspace whose failure details are open, plus the fetch result.
  // `records === null` while loading, so the dialog can show a spinner.
  const [failuresFor, setFailuresFor] = useState<CloudWorkspaceBinding | null>(
    null,
  );
  const [failedRecords, setFailedRecords] = useState<
    readonly CloudFailedRecord[] | null
  >(null);
  const [failedError, setFailedError] = useState<string | null>(null);
  // Opt-in per disconnect, and deliberately reset every time the dialog opens:
  // deleting local workspaces is never something the user drifts into.
  const [purgeLocalData, setPurgeLocalData] = useState(false);
  // Which workspace an encryption dialog is open for, and what it is asking.
  // One slot, because only one of these questions is ever on screen at a time.
  const [encryptionAsk, setEncryptionAsk] = useState<PassphraseTarget | null>(
    null,
  );

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

  const openFailureDetails = (binding: CloudWorkspaceBinding): void => {
    setFailuresFor(binding);
    setFailedRecords(null);
    setFailedError(null);
    void cloud
      .listFailedRecords(binding.workspaceId)
      .then(setFailedRecords)
      .catch((error: unknown) => {
        setFailedError(errorMessage(error));
      });
  };

  const openUnlinkDialog = (): void => {
    setPurgeLocalData(false);
    setConfirmUnlink(true);
  };

  const doUnlink = async (localOnly: boolean): Promise<void> => {
    try {
      await cloud.unlink({ localOnly, purgeLocalData });
      setConfirmUnlink(false);
      setConfirmLocalOnly(false);
      setPurgeLocalData(false);
      toast.success(
        purgeLocalData
          ? "Cloud account disconnected and its local workspaces removed"
          : "Cloud account disconnected",
      );
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
      const binding = status?.bindings.find(
        (b) => b.workspaceId === workspaceId,
      );
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
            Link a cloud account and your workspaces sync automatically.
            Secrets, run history, and local auth never leave this device.
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
            icon={
              <CloudOff
                className="h-12 w-12 text-text-muted"
                strokeWidth={1.5}
              />
            }
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
  const syncStateLabel = status
    ? SYNC_STATE_LABELS[status.syncState]
    : undefined;
  const pendingDecisions = status?.encryptionDecisionPending ?? [];

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
                  Sign in through your browser to connect this device to
                  APIWeave Cloud.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                loading={busy || linkState === "linking"}
                icon={<Link2 className="h-4 w-4" />}
                onClick={() => void wrap(() => cloud.link())()}
              >
                {linkState === "linking"
                  ? "Waiting for browser…"
                  : "Link cloud account"}
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
                    Device: {status.device.label} · v
                    {status.device.clientVersion}
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
                  onClick={openUnlinkDialog}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          )}
        </section>

        {linked ? (
          <PendingDecisions
            pending={pendingDecisions}
            onEncrypt={(pending) =>
              setEncryptionAsk({ mode: "setup", ...pending })
            }
            onDecline={(pending) =>
              setEncryptionAsk({ mode: "decline", ...pending })
            }
          />
        ) : null}

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
                icon={
                  <Cloud
                    className="h-12 w-12 text-text-muted"
                    strokeWidth={1.5}
                  />
                }
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
                    onShowFailureDetails={() => openFailureDetails(binding)}
                    onUnlock={() => setEncryptionAsk(ask("unlock", binding))}
                    onLock={() =>
                      void wrap(
                        () => cloud.lockWorkspace(binding.workspaceId),
                        "Workspace locked — sync is paused until you unlock it",
                      )()
                    }
                    onChangePassphrase={() =>
                      setEncryptionAsk(ask("change", binding))
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
        message="Sync stops and cloud credentials are removed from this device. Workspaces created locally are kept, including their workflows and secrets. Workspaces downloaded from Cloud or a shared Team are removed from this device. The device will be revoked in the cloud."
        confirmLabel={purgeLocalData ? "Disconnect and delete" : "Disconnect"}
        intent="error"
      >
        <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-status-error/5 px-2.5 py-2">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--aw-status-error)]"
            checked={purgeLocalData}
            onChange={(event) => setPurgeLocalData(event.target.checked)}
          />
          <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
            Also delete this account&rsquo;s workspaces from this device,
            including locally created ones.
            <span className="block text-text-muted dark:text-text-muted-dark">
              Removes their workflows, run history and secrets. This cannot be
              undone.
            </span>
          </span>
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmLocalOnly}
        onClose={() => setConfirmLocalOnly(false)}
        onConfirm={() => void doUnlink(true)}
        title="Disconnect locally anyway?"
        message={
          purgeLocalData
            ? "The cloud device could not be revoked (you may be offline). Cloud access may remain active until you revoke this device from another session. Disconnecting now still deletes this account's local workspaces from this device."
            : "The cloud device could not be revoked (you may be offline). Cloud access may remain active until you revoke this device from another session. Disconnect locally now?"
        }
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
      <EncryptionDialogs
        ask={encryptionAsk}
        busy={busy}
        cloud={cloud}
        onClose={() => setEncryptionAsk(null)}
        onRun={wrap}
      />
      <FailedRecordsDialog
        open={failuresFor !== null}
        workspaceName={failuresFor?.workspaceName ?? ""}
        records={failedRecords}
        error={failedError}
        onClose={() => setFailuresFor(null)}
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
  readonly onShowFailureDetails: () => void;
  readonly onUnlock: () => void;
  readonly onLock: () => void;
  readonly onChangePassphrase: () => void;
}

// fallow-ignore-next-line code-duplication -- this parameter list only rhymes with MoveToWorkspaceFields' by coincidence (both are React component destructured-prop lists of similar length); the props themselves belong to unrelated components and there is no shared behavior to extract
function BindingRow({
  binding,
  busy,
  onSync,
  onStopSyncing,
  onResolve,
  onRetryDeadLetters,
  onDiscardDeadLetters,
  onShowFailureDetails,
  onUnlock,
  onLock,
  onChangePassphrase,
}: BindingRowProps) {
  const initializing = binding.initializationState !== "initialized";
  // "locked" and "unknown" both halt sync. They are not the same message: one
  // needs the user, the other needs the cloud to answer.
  const halted =
    binding.encryption === "locked" || binding.encryption === "unknown";
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
          <EncryptionBadge encryption={binding.encryption} />
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
            <button
              type="button"
              onClick={onShowFailureDetails}
              className="cursor-pointer text-status-error underline underline-offset-2 hover:no-underline dark:text-status-error-dark"
            >
              {binding.deadLetterCount} failed
            </button>
          ) : null}
        </div>
        <EncryptionNotice encryption={binding.encryption} />
        {binding.lastError ? (
          <div className="mt-1 flex items-start gap-1.5 text-[11px] text-status-error dark:text-status-error-dark">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-words">{binding.lastError}</span>
            {/* The sentence describes the problem but never names the record.
                Details is the only way to find out which one is stuck. */}
            {binding.deadLetterCount > 0 ? (
              <button
                type="button"
                onClick={onShowFailureDetails}
                className="shrink-0 cursor-pointer underline underline-offset-2 hover:no-underline"
              >
                Details
              </button>
            ) : null}
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
        <EncryptionActions
          encryption={binding.encryption}
          busy={busy}
          onUnlock={onUnlock}
          onLock={onLock}
          onChangePassphrase={onChangePassphrase}
        />
        {halted ? null : (
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={onSync}
          >
            {initializing ? "Resume" : "Sync now"}
          </Button>
        )}
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

interface PendingDecisionsProps {
  readonly pending: readonly CloudPendingEncryptionDecision[];
  readonly onEncrypt: (pending: CloudPendingEncryptionDecision) => void;
  readonly onDecline: (pending: CloudPendingEncryptionDecision) => void;
}

/**
 * Workspaces held back from the cloud until someone chooses. Both answers are
 * permanent, so the warning lives here — before the choice — and not only
 * inside the dialogs the buttons open.
 */
function PendingDecisions({
  pending: pendingDecisions,
  onEncrypt,
  onDecline,
}: PendingDecisionsProps) {
  if (pendingDecisions.length === 0) return null;
  return (
    <section className="rounded-sm border border-status-warning/40 bg-surface-raised dark:border-[var(--aw-status-warning)]/40 dark:bg-surface-dark-raised">
      <div className="border-b border-border px-4 py-3 dark:border-border-dark">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary dark:text-text-primary-dark">
          <ShieldCheck
            className="h-4 w-4 text-status-warning dark:text-[var(--aw-status-warning)]"
            aria-hidden="true"
          />
          Waiting on an encryption choice
        </h2>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          These workspaces are not in the cloud yet. Choose once per workspace.{" "}
          <strong>Both answers are permanent</strong> — an encrypted workspace
          can never be made plain, and a plain one can never be encrypted later.
        </p>
      </div>
      <ul className="divide-y divide-border dark:divide-border-dark">
        {pendingDecisions.map((pending) => (
          <li
            key={pending.workspaceId}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <span className="truncate text-sm font-medium text-text-primary dark:text-text-primary-dark">
              {pending.workspaceName}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<Lock className="h-4 w-4" />}
                onClick={() => onEncrypt(pending)}
              >
                Encrypt this workspace
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDecline(pending)}
              >
                Sync without encryption
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Only an end-to-end encrypted workspace gets a badge; a plain one gets none. */
function EncryptionBadge({
  encryption,
}: {
  readonly encryption: CloudWorkspaceEncryptionState;
}) {
  if (encryption === "unlocked") {
    return (
      <Badge variant="success">
        <Lock className="h-3 w-3" aria-hidden="true" />
        Encrypted
      </Badge>
    );
  }
  if (encryption === "locked") {
    return (
      <Badge variant="warning">
        <Lock className="h-3 w-3" aria-hidden="true" />
        Locked
      </Badge>
    );
  }
  if (encryption === "unknown") {
    return <Badge variant="secondary">Checking…</Badge>;
  }
  return null;
}

/**
 * Why sync stopped, on the same row as the control that restarts it. Locked and
 * unknown both halt sync, but they are not the same message — one needs the
 * user, the other needs the cloud to answer — and neither is an error.
 */
function EncryptionNotice({
  encryption,
}: {
  readonly encryption: CloudWorkspaceEncryptionState;
}) {
  if (encryption === "locked") {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-[11px] text-status-warning dark:text-status-warning-dark">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          Sync is paused: this workspace is end-to-end encrypted and locked on
          this device. Enter its passphrase to resume. Your local data is
          untouched.
        </span>
      </p>
    );
  }
  if (encryption === "unknown") {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-[11px] text-text-secondary dark:text-text-secondary-dark">
        <Loader2
          className="mt-0.5 h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span>
          Checking whether this workspace is encrypted. Sync pauses until the
          cloud answers, then resumes on its own.
        </span>
      </p>
    );
  }
  return null;
}

function EncryptionActions({
  encryption,
  busy,
  onUnlock,
  onLock,
  onChangePassphrase,
}: {
  readonly encryption: CloudWorkspaceEncryptionState;
  readonly busy: boolean;
  readonly onUnlock: () => void;
  readonly onLock: () => void;
  readonly onChangePassphrase: () => void;
}) {
  if (encryption === "locked") {
    return (
      <Button
        variant="primary"
        size="sm"
        icon={<LockOpen className="h-4 w-4" />}
        onClick={onUnlock}
      >
        Unlock
      </Button>
    );
  }
  if (encryption !== "unlocked") return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onChangePassphrase}>
        Change passphrase
      </Button>
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        icon={<Lock className="h-4 w-4" />}
        onClick={onLock}
      >
        Lock
      </Button>
    </>
  );
}


function ask(
  mode: PassphraseTarget["mode"],
  binding: CloudWorkspaceBinding,
): PassphraseTarget {
  return {
    mode,
    workspaceId: binding.workspaceId,
    workspaceName: binding.workspaceName,
  };
}

interface EncryptionDialogsProps {
  readonly ask: PassphraseTarget | null;
  readonly busy: boolean;
  readonly cloud: UseCloudSync;
  readonly onClose: () => void;
  readonly onRun: (
    action: () => Promise<CloudSyncStatus>,
    successMsg?: string,
  ) => () => Promise<void>;
}

/**
 * The two dialogs behind an encryption choice: the passphrase prompt (setup,
 * unlock and change all go through it) and the confirm for the other, equally
 * permanent answer.
 */
function EncryptionDialogs({
  ask: target,
  busy,
  cloud,
  onClose,
  onRun,
}: EncryptionDialogsProps) {
  const passphraseMode = target && target.mode !== "decline" ? target.mode : null;
  return (
    <>
      <WorkspaceEncryptionDialog
        open={passphraseMode !== null}
        mode={passphraseMode ?? "unlock"}
        workspaceName={target?.workspaceName ?? ""}
        busy={busy}
        onClose={onClose}
        onSubmit={async (passphrase) => {
          if (!target || passphraseMode === null) return;
          const next =
            passphraseMode === "unlock"
              ? await cloud.unlockWorkspace(target.workspaceId, passphrase)
              : await cloud.setWorkspaceEncryption(
                  target.workspaceId,
                  passphrase,
                );
          toast.success(ENCRYPTION_SUCCESS[passphraseMode]);
          return next;
        }}
      />
      <ConfirmDialog
        open={target?.mode === "decline"}
        onClose={onClose}
        onConfirm={() => {
          onClose();
          if (target) {
            void onRun(
              () => cloud.declineWorkspaceEncryption(target.workspaceId),
              "Syncing without encryption",
            )();
          }
        }}
        title={`Sync “${target?.workspaceName ?? ""}” without encryption?`}
        message="Its workflows, projects and environments will be stored in the cloud in a form the server can read. This is permanent — this workspace can never be encrypted later. (Secrets, run history and local auth stay on this device either way.)"
        confirmLabel="Sync without encryption"
        intent="warning"
      />
    </>
  );
}
