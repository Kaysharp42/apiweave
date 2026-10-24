import { useState, type FormEvent } from "react";
import { GitBranchPlus } from "lucide-react";
import { Modal } from "../molecules/Modal";
import { ModalFormFooter } from "../molecules/ModalFormFooter";
import { isRepositoryDraftReady } from "./CreateRepositoryFields";
import { CreateRepositorySection } from "./CreateRepositorySection";
import { git } from "../../utils/apiweaveClient";
import { gitAccountRef } from "../../utils/gitAccounts";
import type { CreateRepositoryDialogProps, GitRepositoryDraft } from "../../types";

/**
 * Create a repository on GitHub or GitLab for this workspace: empty, private
 * unless chosen otherwise, and tagged `apiweave-workspace`. A name that is
 * already taken is refused by name; nothing existing is ever adopted. Mount
 * it per use: it starts from the workspace's slug and the account given.
 */
export function CreateRepositoryDialog({ onClose, defaultName, defaultAccount, accounts, initialDraft, onCreated }: CreateRepositoryDialogProps) {
  const [draft, setDraft] = useState<GitRepositoryDraft>(initialDraft ?? { account: null, owner: "", name: defaultName, private: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const { account } = draft;
    if (account === null || !isRepositoryDraftReady(draft) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await git.createRepository(gitAccountRef(account), {
        owner: draft.owner,
        name: draft.name.trim(),
        private: draft.private,
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
        <ModalFormFooter
          formId="create-repository-form"
          submitLabel="Create and connect"
          onCancel={onClose}
          busy={busy}
          canSubmit={isRepositoryDraftReady(draft)}
        />
      )}
    >
      <form id="create-repository-form" onSubmit={(event) => void submit(event)} className="space-y-4 p-5">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          APIWeave creates an empty repository and connects this workspace to it. APIWeave marks it with the topic
          apiweave-workspace so it can find it later. A name that is already taken is refused, never reused.
        </p>
        {error !== null && (
          <div
            role="alert"
            className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20"
          >
            {error}
          </div>
        )}
        <CreateRepositorySection value={draft} onChange={setDraft} defaultAccount={defaultAccount} accounts={accounts} disabled={busy} />
      </form>
    </Modal>
  );
}
