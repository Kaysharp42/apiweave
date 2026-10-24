import { useState } from "react";
import { GitBranch } from "lucide-react";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitCreatedRepository } from "@shared/types/GitCreatedRepository";
import type { GitProvider } from "@shared/types/GitProvider";
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Spinner } from "../atoms/Spinner";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { DetailField } from "../molecules/DetailField";
import { FormField } from "../molecules/FormField";
import { GitAccountPicker } from "../molecules/GitAccountPicker";
import { Panel } from "../molecules/Panel";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { CreateRepositoryDialog } from "./CreateRepositoryDialog";
import { GitRemotePicker } from "./GitRemotePicker";
import { GitSignInDialog } from "./GitSignInDialog";
import { GitSyncDialogs } from "./GitSyncDialogs";
import { GitSyncStatusCard } from "./GitSyncStatusCard";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useGitSyncActions } from "../../hooks/useGitSyncActions";
import { useWorkspaceGitStatus } from "../../hooks/useWorkspaceGitStatus";
import { git } from "../../utils/apiweaveClient";
import { remoteHost } from "../../utils/gitErrorMessages";
import { connectFailedMessage, remoteForRepository } from "../../utils/gitRepositories";
import type { GitAuthorFormProps, GitRemoteSelection } from "../../types";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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

/**
 * Asked for when git reports no author: written into this workspace's own
 * repository only (`git config --local`), then the commit is retried.
 */
function AuthorForm({ busy, onCommit }: GitAuthorFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onCommit({ identity: { name, email } });
      }}
    >
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
        Git doesn&apos;t know who you are on this machine. Commits in this
        workspace&apos;s history will name the author below.
      </p>
      <FormField label="Your name" required>
        <Input
          aria-label="Your name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
        />
      </FormField>
      <FormField label="Your email address" required>
        <Input
          aria-label="Your email address"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </FormField>
      <Button
        type="submit"
        variant="primary"
        loading={busy}
        disabled={name.trim() === "" || email.trim() === ""}
      >
        Save and commit
      </Button>
    </form>
  );
}

const DEFAULT_HOSTS: Readonly<Record<GitProvider, string>> = {
  github: "github.com",
  gitlab: "gitlab.com",
};

/** The remote's host, unless it is the other provider's own — then the provider's default. */
function signInHost(provider: GitProvider, remote: string | null): string {
  const other = provider === "github" ? DEFAULT_HOSTS.gitlab : DEFAULT_HOSTS.github;
  return remote === null || remote === other ? DEFAULT_HOSTS[provider] : remote;
}

const HTTPS_REMOTE = /^https:\/\//i;

interface RemoteAccountProps {
  readonly remoteUrl: string;
  readonly value: GitAccountRef | null;
  readonly onChange: (account: GitAccountRef | null) => void;
  readonly busy: boolean;
}

/**
 * Which account a connected `https://` remote is reached as, signing in to
 * another, and why gh or glab could not say, when they could not. An SSH
 * remote signs in with the user's SSH key, so it is offered no account. A
 * bound account stays shown even when no tool lists it any more, and one
 * just signed in to is offered, not chosen: the change is the user's.
 */
function RemoteAccount({ remoteUrl, value, onChange, busy }: RemoteAccountProps) {
  const { accounts, problems, reload } = useGitAccounts();
  const [signingIn, setSigningIn] = useState<GitProvider | null>(null);
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
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSigningIn("github")}>
          Sign in to GitHub…
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSigningIn("gitlab")}>
          Sign in to GitLab…
        </Button>
      </div>
      {signingIn !== null && (
        <GitSignInDialog
          isOpen
          provider={signingIn}
          defaultHost={signInHost(signingIn, remoteHost(remoteUrl))}
          onClose={() => setSigningIn(null)}
          onSignedIn={reload}
        />
      )}
    </>
  );
}

interface RemoteSectionProps {
  readonly remoteUrl: string | null;
  readonly branch: string;
  readonly account: GitAccountRef | null;
  readonly busy: boolean;
  /** What the connect form starts with: a repository just created that could not be connected to. */
  readonly prefill: GitRemoteSelection | null;
  readonly onConnect: (url: string, account: GitAccountRef | null) => void;
  readonly onCreateRepository: (account: GitAccount) => void;
  readonly onChangeAccount: (account: GitAccountRef | null) => void;
  readonly onDisconnect: () => void;
}

/**
 * The remote and its branch; for a workspace with none, the connect form —
 * Account, then Repository (its empty repositories, Create repository…
 * first), or Use a URL instead — and for a connected one, its account and
 * Disconnect.
 */
function RemoteSection({
  remoteUrl,
  branch,
  account,
  busy,
  prefill,
  onConnect,
  onCreateRepository,
  onChangeAccount,
  onDisconnect,
}: RemoteSectionProps) {
  const [selection, setSelection] = useState<GitRemoteSelection | null>(prefill);
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
            if (selection !== null) onConnect(selection.url, selection.account);
          }}
        >
          <GitRemotePicker
            mode="connect"
            initial={prefill}
            onChange={setSelection}
            onCreateRepository={onCreateRepository}
            disabled={busy}
          />
          <Button type="submit" variant="primary" loading={busy} disabled={selection === null}>
            Connect to remote
          </Button>
        </form>
      ) : (
        <>
          <RemoteAccount remoteUrl={remoteUrl} value={account} onChange={onChangeAccount} busy={busy} />
          <Button variant="ghost" disabled={busy} onClick={onDisconnect}>
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
  readonly prefill: GitRemoteSelection | null;
  readonly onToggleMode: () => void;
  readonly onAuthor: (request: WorkspaceGitCommitRequest) => Promise<boolean>;
  readonly onConnect: (url: string, account: GitAccountRef | null) => void;
  readonly onCreateRepository: (account: GitAccount) => void;
  readonly onChangeAccount: (account: GitAccountRef | null) => void;
  readonly onDisconnect: () => void;
  readonly onUntrack: () => void;
}

function Tracked({
  status,
  busy,
  apply,
  prefill,
  onToggleMode,
  onAuthor,
  onConnect,
  onCreateRepository,
  onChangeAccount,
  onDisconnect,
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
        <AuthorForm busy={busy} onCommit={onAuthor} />
      ) : (
        <GitSyncStatusCard status={status} actions={actions} alwaysOfferDiscard />
      )}
      <RemoteSection
        // A repository created but not connected to starts the form over, filled in with it.
        key={prefill?.url ?? ""}
        remoteUrl={status.remoteUrl}
        branch={status.branch}
        account={status.account}
        busy={busy}
        prefill={prefill}
        onConnect={onConnect}
        onCreateRepository={onCreateRepository}
        onChangeAccount={onChangeAccount}
        onDisconnect={onDisconnect}
      />
      <div className="border-t border-border pt-4 dark:border-border-dark">
        <Button variant="ghost" intent="error" disabled={busy} onClick={onUntrack}>
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
}: {
  readonly workspaceId: string;
  /** What a repository created for the workspace is called unless the user says otherwise. */
  readonly workspaceSlug: string;
}) {
  const available = git.isAvailable();
  const { status, error: loadError, apply } = useWorkspaceGitStatus(workspaceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The account Create repository… was chosen for in the picker; null while the dialog is closed.
  const [creatingAs, setCreatingAs] = useState<GitAccount | null>(null);
  const [prefill, setPrefill] = useState<GitRemoteSelection | null>(null);
  const [confirming, setConfirming] = useState<"untrack" | "disconnect" | null>(
    null,
  );

  /**
   * Connect to a repository just created. A failure leaves it where it is —
   * APIWeave never deletes a repository — and fills the connect form in with
   * it, so Connect to remote is the retry.
   */
  const connectCreated = async (created: GitCreatedRepository, account: GitAccount): Promise<void> => {
    setCreatingAs(null);
    const remote = remoteForRepository(account, created.repository);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      apply(await git.connectRemote(workspaceId, remote.url, remote.account));
      setPrefill(null);
      setNotice(created.problem);
    } catch (err) {
      setPrefill(remote);
      setError(connectFailedMessage(account, created.repository, errorText(err)));
    } finally {
      setBusy(false);
    }
  };

  /** Run one call; its status replaces the shown one, its failure is shown. Resolves to that status, or null when it threw. */
  const run = async (
    action: () => Promise<WorkspaceGitStatus>,
  ): Promise<WorkspaceGitStatus | null> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await action();
      apply(next);
      return next;
    } catch (err) {
      setError(errorText(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const shownError = error ?? loadError;

  const body = (() => {
    if (!available) {
      return (
        <p className="text-xs text-status-warning">
          Version history is only available in the desktop app.
        </p>
      );
    }
    if (status === null) return shownError === null ? <Spinner size="sm" /> : null;
    if (!status.tracked) {
      return (
        <Untracked busy={busy} onTrack={() => void run(() => git.track(workspaceId))} />
      );
    }
    return (
      <Tracked
        key={status.workspaceId}
        status={status}
        busy={busy}
        apply={apply}
        prefill={prefill}
        onCreateRepository={setCreatingAs}
        onToggleMode={() =>
          void run(() =>
            git.setMode(workspaceId, status.mode === "auto" ? "manual" : "auto"),
          )
        }
        onAuthor={async (request) =>
          (await run(() => git.syncNow(workspaceId, request)))?.lastError ===
          null
        }
        onConnect={(url, account) =>
          void run(() => git.connectRemote(workspaceId, url, account))
        }
        onChangeAccount={(account) =>
          void run(() => git.setAccount(workspaceId, account))
        }
        onDisconnect={() => setConfirming("disconnect")}
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
        {notice !== null && (
          <p role="status" className="text-xs text-status-warning">
            {notice}
          </p>
        )}
      </div>
      {creatingAs !== null && (
        <CreateRepositoryDialog
          onClose={() => setCreatingAs(null)}
          defaultName={workspaceSlug}
          defaultAccount={creatingAs}
          onCreated={(created, account) => void connectCreated(created, account)}
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
