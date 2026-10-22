import { useEffect, useState } from "react";
import { GitBranch, GitCommitHorizontal } from "lucide-react";
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Spinner } from "../atoms/Spinner";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { DetailField } from "../molecules/DetailField";
import { FormField } from "../molecules/FormField";
import { Panel } from "../molecules/Panel";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { git } from "../../utils/apiweaveClient";

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

interface CommitFormProps {
  readonly busy: boolean;
  /** Resolves whether the commit went through. */
  readonly onCommit: (request: WorkspaceGitCommitRequest) => Promise<boolean>;
}

/**
 * Asked for when git reports no author: written into this workspace's own
 * repository only (`git config --local`), then the commit is retried.
 */
function AuthorForm({ busy, onCommit }: CommitFormProps) {
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

function CommitForm({ busy, onCommit }: CommitFormProps) {
  const [message, setMessage] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onCommit({ message }).then((committed) => {
          if (committed) setMessage("");
        });
      }}
    >
      <FormField
        label="Commit message"
        hint="Optional — left empty, the commit names the files it changed."
      >
        <Input
          aria-label="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Describe this change"
        />
      </FormField>
      <Button
        type="submit"
        variant="primary"
        loading={busy}
        icon={<GitCommitHorizontal className="h-3.5 w-3.5" />}
      >
        Commit now
      </Button>
    </form>
  );
}

interface TrackedProps {
  readonly status: WorkspaceGitStatus;
  readonly busy: boolean;
  readonly onToggleMode: () => void;
  readonly onCommit: (request: WorkspaceGitCommitRequest) => Promise<boolean>;
  readonly onUntrack: () => void;
}

function Tracked({
  status,
  busy,
  onToggleMode,
  onCommit,
  onUntrack,
}: TrackedProps) {
  const { lastCommit, lastError } = status;
  const needsAuthor = lastError?.code === "identity_missing";
  return (
    <div className="space-y-4">
      <ToggleSetting
        title="Commit automatically"
        description="Commit about 30 seconds after your last edit. Off: commit only when you choose."
        checked={status.mode === "auto"}
        onToggle={onToggleMode}
        disabled={busy}
      />
      <DetailField label="Last commit" mono={lastCommit !== null}>
        {lastCommit === null
          ? "None yet"
          : `${lastCommit.sha.slice(0, 7)} ${lastCommit.subject}`}
      </DetailField>
      {lastError !== null && !needsAuthor && (
        <p className="text-xs text-status-error dark:text-[var(--aw-status-error)]">
          {lastError.message}
        </p>
      )}
      {needsAuthor && <AuthorForm busy={busy} onCommit={onCommit} />}
      {status.mode === "manual" && !needsAuthor && (
        <CommitForm busy={busy} onCommit={onCommit} />
      )}
      <div className="border-t border-border pt-4 dark:border-border-dark">
        <Button variant="ghost" intent="error" disabled={busy} onClick={onUntrack}>
          Stop tracking
        </Button>
      </div>
    </div>
  );
}

/** Settings for a workspace's version history (git): track, auto or manual commits, the last commit. */
export function VersionHistoryPanel({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const available = git.isAvailable();
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUntrack, setConfirmingUntrack] = useState(false);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    git
      .status(workspaceId)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    const unsubscribe = git.onStatusChanged((next) => {
      if (next.workspaceId === workspaceId) setStatus(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [available, workspaceId]);

  /** Run one call; its status replaces the shown one, its failure is shown. Resolves to that status, or null when it threw. */
  const run = async (
    action: () => Promise<WorkspaceGitStatus>,
  ): Promise<WorkspaceGitStatus | null> => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setStatus(next);
      return next;
    } catch (err) {
      setError(errorText(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const body = (() => {
    if (!available) {
      return (
        <p className="text-xs text-status-warning">
          Version history is only available in the desktop app.
        </p>
      );
    }
    if (status === null) return error === null ? <Spinner size="sm" /> : null;
    if (!status.tracked) {
      return (
        <Untracked busy={busy} onTrack={() => void run(() => git.track(workspaceId))} />
      );
    }
    return (
      <Tracked
        status={status}
        busy={busy}
        onToggleMode={() =>
          void run(() =>
            git.setMode(workspaceId, status.mode === "auto" ? "manual" : "auto"),
          )
        }
        onCommit={async (request) =>
          (await run(() => git.syncNow(workspaceId, request)))?.lastError ===
          null
        }
        onUntrack={() => setConfirmingUntrack(true)}
      />
    );
  })();

  return (
    <Panel title="Version history (git)" icon={GitBranch}>
      <div className="space-y-4 p-4">
        {body}
        {error !== null && (
          <p
            role="alert"
            className="text-xs text-status-error dark:text-[var(--aw-status-error)]"
          >
            {error}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirmingUntrack}
        onClose={() => setConfirmingUntrack(false)}
        onConfirm={() => {
          setConfirmingUntrack(false);
          void run(() => git.untrack(workspaceId));
        }}
        title="Stop tracking this workspace?"
        message="Its local git repository and every commit in it are deleted. The workspace itself is not changed."
        confirmLabel="Stop tracking"
      />
    </Panel>
  );
}
