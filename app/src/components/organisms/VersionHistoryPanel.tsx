import { useState, type ReactNode } from "react";
import { GitBranch } from "lucide-react";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitCreatedRepository } from "@shared/types/GitCreatedRepository";
import type { GitProvider } from "@shared/types/GitProvider";
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { Button } from "../atoms/Button";
import { Spinner } from "../atoms/Spinner";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { DetailField } from "../molecules/DetailField";
import { GitAccountPicker } from "../molecules/GitAccountPicker";
import { GitAuthorForm } from "./GitAuthorForm";
import { Panel } from "../molecules/Panel";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { CreateRepositoryDialog } from "./CreateRepositoryDialog";
import { GitRemotePicker } from "./GitRemotePicker";
import { GitSignInButtons } from "./GitSignInButtons";
import { GitSyncDialogs } from "./GitSyncDialogs";
import { GitSyncStatusCard } from "./GitSyncStatusCard";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useGitSyncActions } from "../../hooks/useGitSyncActions";
import { useWorkspaceGitStatus } from "../../hooks/useWorkspaceGitStatus";
import { git } from "../../utils/apiweaveClient";
import { GIT_PROVIDERS } from "../../utils/gitAccounts";
import { HTTPS_REMOTE, errorText } from "../../utils/gitRemote";
import { remoteHost } from "../../utils/gitErrorMessages";
import {
  connectFailedMessage,
  remoteForRepository,
} from "../../utils/gitRepositories";
import type {
  GitRemoteSelection,
  GitRepositoryCreation,
  GitRepositoryDraft,
  PanelMessage,
  RemoteAccountProps,
  RemoteSectionProps,
} from "../../types";

interface UntrackedProps {
  readonly busy: boolean;
  readonly onTrack: () => void;
}

function Untracked({ busy, onTrack }: UntrackedProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
        Keep every change to this workspace as a commit in a local git
        repository, browsable with any git tool. Secret values never leave this
        device.
      </p>
      <Button variant="primary" loading={busy} onClick={onTrack}>
        Track this workspace
      </Button>
    </div>
  );
}

/** The remote's host, unless it is the other provider's own — then the provider's default. */
function signInHost(provider: GitProvider, remote: string | null): string {
  const other =
    GIT_PROVIDERS[provider === "github" ? "gitlab" : "github"].defaultHost;
  return remote === null || remote === other
    ? GIT_PROVIDERS[provider].defaultHost
    : remote;
}

/**
 * Which account a connected `https://` remote is reached as, signing in to
 * another, and why gh or glab could not say, when they could not. An SSH
 * remote signs in with the user's SSH key, so it is offered no account. A
 * bound account stays shown even when no tool lists it any more, and one
 * just signed in to is offered, not chosen: the change is the user's.
 */
function RemoteAccount({
  remoteUrl,
  value,
  onChange,
  busy,
  accounts: feed,
}: RemoteAccountProps) {
  const { accounts, clis, problems, reload } = feed;
  if (!HTTPS_REMOTE.test(remoteUrl)) return null;
  return (
    <>
      {(accounts.length > 0 || value !== null) && (
        <GitAccountPicker
          accounts={accounts}
          host={remoteHost(remoteUrl)}
          value={value}
          onChange={onChange}
          disabled={busy}
        />
      )}
      {problems.map((problem) => (
        <p key={problem} className="text-xs text-status-warning">
          {problem}
        </p>
      ))}
      <GitSignInButtons
        clis={clis}
        disabled={busy}
        hostFor={(provider) => signInHost(provider, remoteHost(remoteUrl))}
        onSignedIn={reload}
      />
    </>
  );
}

/**
 * The remote and its branch; for a workspace with none, the connect form —
 * Account, then Repository (its empty repositories, Create repository…
 * first), or Use a URL instead — and for a connected one, its account and
 * Disconnect.
 */
function RemoteSection(props: RemoteSectionProps) {
  const { remoteUrl, branch, account, busy, prefill } = props;
  const [selection, setSelection] = useState<GitRemoteSelection | null>(
    prefill,
  );
  return (
    <div className="space-y-2 border-t border-border pt-4 dark:border-border-dark">
      <DetailField label="Remote" mono={remoteUrl !== null} breakAll>
        {remoteUrl ?? "Not connected"}
      </DetailField>
      <DetailField label="Branch" mono>
        {branch}
      </DetailField>
      {remoteUrl === null ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (selection !== null)
              props.onConnect(selection.url, selection.account);
          }}
        >
          <GitRemotePicker
            mode="connect"
            initial={prefill}
            accounts={props.accounts}
            onChange={setSelection}
            onCreateRepository={props.onCreateRepository}
            disabled={busy}
          />
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={selection === null}
          >
            Connect to remote
          </Button>
        </form>
      ) : (
        <>
          <RemoteAccount
            remoteUrl={remoteUrl}
            value={account}
            onChange={props.onChangeAccount}
            busy={busy}
            accounts={props.accounts}
          />
          <Button variant="ghost" disabled={busy} onClick={props.onDisconnect}>
            Disconnect
          </Button>
        </>
      )}
    </div>
  );
}

interface TrackedProps {
  readonly status: WorkspaceGitStatus;
  readonly busy: boolean;
  readonly apply: (status: WorkspaceGitStatus) => void;
  readonly onToggleMode: () => void;
  readonly onAuthor: (request: WorkspaceGitCommitRequest) => Promise<boolean>;
  /** The remote, its branch and what to do about them: the panel's `RemoteSection`. */
  readonly remote: ReactNode;
  readonly onUntrack: () => void;
}

function Tracked({
  status,
  busy,
  apply,
  onToggleMode,
  onAuthor,
  remote,
  onUntrack,
}: TrackedProps) {
  const actions = useGitSyncActions(status, apply);
  const needsAuthor = status.lastError?.code === "identity_missing";
  return (
    <div className="space-y-4">
      <ToggleSetting
        title="Commit automatically"
        description="Commit about 30 seconds after your last edit. Off: commit only when you choose."
        checked={status.mode === "auto"}
        onToggle={onToggleMode}
        disabled={busy}
      />
      {needsAuthor ? (
        <GitAuthorForm busy={busy} onCommit={onAuthor} />
      ) : (
        <GitSyncStatusCard
          status={status}
          actions={actions}
          alwaysOfferDiscard
        />
      )}
      {remote}
      <div className="border-t border-border pt-4 dark:border-border-dark">
        <Button
          variant="ghost"
          intent="error"
          disabled={busy}
          onClick={onUntrack}
        >
          Stop tracking
        </Button>
      </div>
      <GitSyncDialogs status={status} actions={actions} />
    </div>
  );
}

/**
 * Settings for a workspace's version history (git): track, auto or manual
 * commits, the sync state and what to do about it, the remote and its branch.
 * The state is worded by the same card the header's popover shows.
 */
export function VersionHistoryPanel({
  workspaceId,
  workspaceSlug,
  handedOn = null,
}: {
  readonly workspaceId: string;
  /** What a repository created for the workspace is called unless the user says otherwise. */
  readonly workspaceSlug: string;
  /** The repository Create workspace was going to make before its sync stopped: the dialog starts on it. */
  readonly handedOn?: GitRepositoryDraft | null;
}) {
  const available = git.isAvailable();
  const {
    status,
    error: loadError,
    apply,
  } = useWorkspaceGitStatus(workspaceId);
  // One list of accounts for the page: a sign-in in the dialog is one the picker can use straight away.
  const accounts = useGitAccounts();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [creation, setCreation] = useState<GitRepositoryCreation>(
    handedOn === null
      ? { step: "idle" }
      : { step: "dialog", account: handedOn.account as GitAccount },
  );

  const [confirming, setConfirming] = useState<"untrack" | "disconnect" | null>(
    null,
  );
  const prefill = creation.step === "unconnected" ? creation.remote : null;

  /**
   * Run one call; its status replaces the shown one, its failure is shown —
   * as `describe` words it, when given. Resolves to that status, or null when
   * it threw.
   */
  const run = async (
    action: () => Promise<WorkspaceGitStatus>,
    describe: (error: unknown) => string = errorText,
  ): Promise<WorkspaceGitStatus | null> => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      apply(next);
      return next;
    } catch (err) {
      setMessage({ tone: "error", text: describe(err) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Connect to a repository just created. A failure leaves it where it is —
   * APIWeave never deletes a repository — and fills the connect form in with
   * it, so Connect to remote is the retry.
   */
  const connectCreated = async (
    created: GitCreatedRepository,
    account: GitAccount,
  ): Promise<void> => {
    const remote = remoteForRepository(account, created.repository);
    setCreation({ step: "unconnected", remote });
    const connected = await run(
      () => git.connectRemote(workspaceId, remote.url, remote.account),
      (err) =>
        connectFailedMessage(account, created.repository, errorText(err)),
    );
    if (connected === null) return;
    setCreation({ step: "idle" });
    if (created.problem !== null)
      setMessage({ tone: "notice", text: created.problem });
  };

  const shownError = message?.tone === "error" ? message.text : loadError;

  const body = (() => {
    if (!available) {
      return (
        <p className="text-xs text-status-warning">
          Version history is only available in the desktop app.
        </p>
      );
    }
    if (status === null)
      return shownError === null ? <Spinner size="sm" /> : null;
    if (!status.tracked) {
      return (
        <Untracked
          busy={busy}
          onTrack={() => void run(() => git.track(workspaceId))}
        />
      );
    }
    return (
      <Tracked
        key={status.workspaceId}
        status={status}
        busy={busy}
        apply={apply}
        onToggleMode={() =>
          void run(() =>
            git.setMode(
              workspaceId,
              status.mode === "auto" ? "manual" : "auto",
            ),
          )
        }
        onAuthor={async (request) =>
          (await run(() => git.syncNow(workspaceId, request)))?.lastError ===
          null
        }
        remote={
          <RemoteSection
            // A repository created but not connected to starts the form over, filled in with it.
            key={prefill?.url ?? ""}
            remoteUrl={status.remoteUrl}
            branch={status.branch}
            account={status.account}
            busy={busy}
            prefill={prefill}
            onConnect={(url, account) =>
              void run(() => git.connectRemote(workspaceId, url, account))
            }
            onCreateRepository={(account) =>
              setCreation({ step: "dialog", account })
            }
            onChangeAccount={(account) =>
              void run(() => git.setAccount(workspaceId, account))
            }
            onDisconnect={() => setConfirming("disconnect")}
            accounts={accounts}
          />
        }
        onUntrack={() => setConfirming("untrack")}
      />
    );
  })();

  return (
    <Panel title="Version history (git)" icon={GitBranch}>
      <div className="space-y-4 p-4">
        {body}
        {shownError !== null && (
          <p
            role="alert"
            className="text-xs text-status-error dark:text-[var(--aw-status-error)]"
          >
            {shownError}
          </p>
        )}
        {message?.tone === "notice" && (
          <p role="status" className="text-xs text-status-warning">
            {message.text}
          </p>
        )}
      </div>
      {creation.step === "dialog" && (
        <CreateRepositoryDialog
          onClose={() => setCreation({ step: "idle" })}
          defaultName={workspaceSlug}
          defaultAccount={creation.account}
          accounts={accounts}
          {...(handedOn === null ? {} : { initialDraft: handedOn })}
          onCreated={(created, account) =>
            void connectCreated(created, account)
          }
        />
      )}
      <ConfirmDialog
        open={confirming === "disconnect"}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          void run(() => git.disconnectRemote(workspaceId));
        }}
        title="Disconnect from this remote?"
        message="Every local commit stays; only the connection is removed."
        confirmLabel="Disconnect"
        intent="warning"
      />
      <ConfirmDialog
        open={confirming === "untrack"}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          void run(() => git.untrack(workspaceId));
        }}
        title="Stop tracking this workspace?"
        message="Its local git repository and every commit in it are deleted. The workspace itself is not changed."
        confirmLabel="Stop tracking"
      />
    </Panel>
  );
}
