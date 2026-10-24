import { useCallback, useState, type FormEvent } from "react";
import { GitBranchPlus } from "lucide-react";
import type { GitProvider } from "@shared/types/GitProvider";
import { Button } from "../atoms/Button";
import { Spinner } from "../atoms/Spinner";
import { Modal } from "../molecules/Modal";
import { CreateRepositoryFields, isRepositoryDraftReady } from "./CreateRepositoryFields";
import { GitSignInDialog } from "./GitSignInDialog";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { git } from "../../utils/apiweaveClient";
import { GIT_PROVIDERS, gitAccountRef, sameGitAccount } from "../../utils/gitAccounts";
import type { CreateRepositoryDialogProps, GitRepositoryDraft } from "../../types";

/**
 * Create a repository on GitHub or GitLab for this workspace: empty, private
 * unless chosen otherwise, and tagged `apiweave-workspace`. A name that is
 * already taken is refused by name; nothing existing is ever adopted. Mount
 * it per use: it starts from the workspace's slug and its account.
 */
export function CreateRepositoryDialog({ onClose, defaultName, defaultAccount, onCreated }: CreateRepositoryDialogProps) {
  const { accounts, problems, loaded, reload } = useGitAccounts();
  const [draft, setDraft] = useState<GitRepositoryDraft>({ account: null, owner: "", name: defaultName, private: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<GitProvider | null>(null);
  // Until the user picks one: the workspace's own account, or the only one there is.
  const shown: GitRepositoryDraft =
    draft.account === null
      ? { ...draft, account: accounts.find((account) => sameGitAccount(account, defaultAccount)) ?? (accounts.length === 1 ? (accounts[0] ?? null) : null) }
      : draft;
  const change = useCallback((next: GitRepositoryDraft) => setDraft(next), []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const { account } = shown;
    if (account === null || !isRepositoryDraftReady(shown) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await git.createRepository(gitAccountRef(account), {
        owner: shown.owner,
        name: shown.name.trim(),
        private: shown.private,
      });
      onCreated(created, account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={busy ? () => undefined : onClose}
      title="Create repository"
      size="md"
      headerExtra={<GitBranchPlus className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark" aria-hidden="true" />}
      footer={() => (
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="create-repository-form" loading={busy} disabled={!isRepositoryDraftReady(shown)}>
            Create and connect
          </Button>
        </>
      )}
    >
      <form id="create-repository-form" onSubmit={(event) => void submit(event)} className="space-y-4 p-5">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          APIWeave creates an empty repository, tagged apiweave-workspace, and connects this workspace to it. A name
          that is already taken is refused, never reused.
        </p>
        <div aria-live="polite" className="space-y-2">
          {!loaded && (
            <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-text-secondary-dark">
              <Spinner size="sm" />
              Asking gh and glab…
            </div>
          )}
          {loaded && accounts.length === 0 && (
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              Sign in to GitHub or GitLab first: APIWeave creates the repository as one of your accounts.
            </p>
          )}
          {problems.map((problem) => (
            <p key={problem} className="text-xs text-status-warning">
              {problem}
            </p>
          ))}
          {error !== null && (
            <div
              role="alert"
              className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20"
            >
              {error}
            </div>
          )}
        </div>
        {loaded && accounts.length > 0 && <CreateRepositoryFields value={shown} onChange={change} accounts={accounts} disabled={busy} />}
        {loaded && (
          <div className="flex flex-wrap gap-2">
            {(["github", "gitlab"] as const).map((provider) => (
              <Button key={provider} variant="ghost" size="sm" disabled={busy} onClick={() => setSigningIn(provider)}>
                Sign in to {GIT_PROVIDERS[provider].name}…
              </Button>
            ))}
          </div>
        )}
      </form>
      {signingIn !== null && (
        <GitSignInDialog
          isOpen
          provider={signingIn}
          defaultHost={GIT_PROVIDERS[signingIn].defaultHost}
          onClose={() => setSigningIn(null)}
          onSignedIn={reload}
        />
      )}
    </Modal>
  );
}
