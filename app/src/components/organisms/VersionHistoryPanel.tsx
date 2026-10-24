import { useState, type ReactNode } from "react";
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
import { GitSignInButtons } from "./GitSignInButtons";
import { GitSyncDialogs } from "./GitSyncDialogs";
import { GitSyncStatusCard } from "./GitSyncStatusCard";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useGitSyncActions } from "../../hooks/useGitSyncActions";
import { useWorkspaceGitStatus } from "../../hooks/useWorkspaceGitStatus";
import { git } from "../../utils/apiweaveClient";
import { GIT_PROVIDERS } from "../../utils/gitAccounts";
import { remoteHost } from "../../utils/gitErrorMessages";
import { connectFailedMessage, remoteForRepository } from "../../utils/gitRepositories";
import type { GitAuthorFormProps, GitRemoteSelection, GitRepositoryCreation, PanelMessage } from "../../types";

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

/** The remote's host, unless it is the other provider's own — then the provider's default. */
function signInHost(provider: GitProvider, remote: string | null): string {
  const other = GIT_PROVIDERS[provider === "github" ? "gitlab" : "github"].defaultHost;
  return remote === null || remote === other ? GIT_PROVIDERS[provider].defaultHost : remote;
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
        disabled={busy}
        hostFor={(provider) => signInHost(provider, remoteHost(remoteUrl))}
        onSignedIn={(signedIn) => {
          reload();
          if (chooseSignedIn) onChange(signedIn);
        }}
      />
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
  readonly onCreateRepository: () => void;
  readonly onChangeAccount: (account: GitAccountRef | null) => void;
  readonly onDisconnect: () => void;
}

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
  const [url, setUrl] = useState(prefill?.url ?? "");
  const [chosen, setChosen] = useState<GitAccountRef | null>(prefill?.account ?? null);
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
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={url.trim() === ""}
            >
              Connect to remote
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onCreateRepository}>
              Create repository…
            </Button>
          </div>
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
  /** The remote, its branch and what to do about them: the panel's `RemoteSection`. */
  readonly remote: ReactNode;
  readonly onUntrack: () => void;
}

function Tracked({ status, busy, apply, onToggleMode, onAuthor, remote, onUntrack }: TrackedProps) {
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
      {remote}
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
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [creation, setCreation] = useState<GitRepositoryCreation>({ step: "idle" });
  const [confirming, setConfirming] = useState<"untrack" | "disconnect" | null>(null);
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
  const connectCreated = async (created: GitCreatedRepository, account: GitAccount): Promise<void> => {
    const remote = remoteForRepository(account, created.repository);
    setCreation({ step: "unconnected", remote });
    const connected = await run(
      () => git.connectRemote(workspaceId, remote.url, remote.account),
      (err) => connectFailedMessage(account, created.repository, errorText(err)),
    );
    if (connected === null) return;
    setCreation({ step: "idle" });
    if (created.problem !== null) setMessage({ tone: "notice", text: created.problem });
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
        remote={
          <RemoteSection
            // A repository created but not connected to starts the form over, filled in with it.
            key={prefill?.url ?? ""}
            remoteUrl={status.remoteUrl}
            branch={status.branch}
            account={status.account}
            busy={busy}
            prefill={prefill}
            onConnect={(url, account) => void run(() => git.connectRemote(workspaceId, url, account))}
            onCreateRepository={() => setCreation({ step: "dialog" })}
            onChangeAccount={(account) => void run(() => git.setAccount(workspaceId, account))}
            onDisconnect={() => setConfirming("disconnect")}
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
      {creation.step === "dialog" && status !== null && (
        <CreateRepositoryDialog
          onClose={() => setCreation({ step: "idle" })}
          defaultName={workspaceSlug}
          defaultAccount={status.account}
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
