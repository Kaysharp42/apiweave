import { useState } from "react";
import { GitBranch } from "lucide-react";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
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
import { GitSignInDialog } from "./GitSignInDialog";
import { GitSyncDialogs } from "./GitSyncDialogs";
import { GitSyncStatusCard } from "./GitSyncStatusCard";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useGitSyncActions } from "../../hooks/useGitSyncActions";
import { useWorkspaceGitStatus } from "../../hooks/useWorkspaceGitStatus";
import { git } from "../../utils/apiweaveClient";
import { remoteHost } from "../../utils/gitErrorMessages";
import type { GitAuthorFormProps } from "../../types";

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
  /** Choose an account just signed in to: the connect form's, not a connected workspace's, which stays the user's to change. */
  readonly chooseSignedIn: boolean;
  readonly busy: boolean;
}

/**
 * Which account an `https://` remote is reached as, signing in to another,
 * and why gh or glab could not say, when they could not. An SSH remote signs
 * in with the user's SSH key, so it is offered no account. A bound account
 * stays shown even when no tool lists it any more.
 */
function RemoteAccount({ remoteUrl, value, onChange, chooseSignedIn, busy }: RemoteAccountProps) {
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
          onSignedIn={(signedIn) => {
            reload();
            if (chooseSignedIn) onChange(signedIn);
          }}
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
  readonly onConnect: (url: string, account: GitAccountRef | null) => void;
  readonly onChangeAccount: (account: GitAccountRef | null) => void;
  readonly onDisconnect: () => void;
}

function RemoteSection({
  remoteUrl,
  branch,
  account,
  busy,
  onConnect,
  onChangeAccount,
  onDisconnect,
}: RemoteSectionProps) {
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<GitAccountRef | null>(null);
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
            onConnect(url.trim(), HTTPS_REMOTE.test(url.trim()) ? chosen : null);
          }}
        >
          <FormField label="Remote URL">
            <Input
              aria-label="Remote URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://host/owner/repo.git or git@host:owner/repo.git"
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          <RemoteAccount remoteUrl={url.trim()} value={chosen} onChange={setChosen} chooseSignedIn busy={busy} />
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={url.trim() === ""}
          >
            Connect to remote
          </Button>
        </form>
      ) : (
        <>
          <RemoteAccount remoteUrl={remoteUrl} value={account} onChange={onChangeAccount} chooseSignedIn={false} busy={busy} />
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
  readonly onToggleMode: () => void;
  readonly onAuthor: (request: WorkspaceGitCommitRequest) => Promise<boolean>;
  readonly onConnect: (url: string, account: GitAccountRef | null) => void;
  readonly onChangeAccount: (account: GitAccountRef | null) => void;
  readonly onDisconnect: () => void;
  readonly onUntrack: () => void;
}

function Tracked({
  status,
  busy,
  apply,
  onToggleMode,
  onAuthor,
  onConnect,
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
        remoteUrl={status.remoteUrl}
        branch={status.branch}
        account={status.account}
        busy={busy}
        onConnect={onConnect}
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
}: {
  readonly workspaceId: string;
}) {
  const available = git.isAvailable();
  const { status, error: loadError, apply } = useWorkspaceGitStatus(workspaceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"untrack" | "disconnect" | null>(
    null,
  );

  /** Run one call; its status replaces the shown one, its failure is shown. Resolves to that status, or null when it threw. */
  const run = async (
    action: () => Promise<WorkspaceGitStatus>,
  ): Promise<WorkspaceGitStatus | null> => {
    setBusy(true);
    setError(null);
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
      </div>
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
