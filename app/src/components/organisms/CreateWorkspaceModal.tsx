import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import type { GitAccount } from "@shared/types/GitAccount";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Modal } from "../molecules/Modal";
import { ModalFormFooter } from "../molecules/ModalFormFooter";
import { FormField } from "../molecules/FormField";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { isRepositoryDraftReady } from "./CreateRepositoryFields";
import { CreateRepositorySection } from "./CreateRepositorySection";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { apiweave, git } from "../../utils/apiweaveClient";
import { gitAccountRef } from "../../utils/gitAccounts";
import { connectFailedMessage, remoteForRepository } from "../../utils/gitRepositories";
import type { CreateWorkspaceModalProps, GitRepositoryDraft } from "../../types";

// Workspace slugs use lowercase letters, numbers, and hyphens.
function toWorkspaceSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

function isValidWorkspaceSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const NO_REPOSITORY: GitRepositoryDraft = { account: null, owner: "", name: "", private: true };

/**
 * Track a workspace just created, create its repository and connect to it,
 * as `account`. Resolves to what went wrong, or null, and to a note about a
 * repository that works but could not be tagged. Every step after the first
 * leaves the ones before it in place — the workspace tracked, the repository
 * created — because each can be finished from Version history, and
 * APIWeave never deletes a repository.
 */
async function syncNewWorkspace(
  workspaceId: string,
  account: GitAccount,
  draft: GitRepositoryDraft,
): Promise<{ readonly failure: string | null; readonly note: string | null }> {
  let commitless: boolean;
  try {
    commitless = (await git.track(workspaceId)).lastCommit === null;
  } catch (error) {
    return { failure: `The workspace was created, but it could not be tracked: ${errorText(error)}`, note: null };
  }
  // A missing git author leaves no commit to push: creating the repository now would only strand it.
  if (commitless) {
    return {
      failure:
        "The workspace was created and tracked, but git doesn't know who you are on this computer, so it has nothing to push yet. Enter your name and email in Version history, then create the repository there.",
      note: null,
    };
  }
  let created;
  try {
    created = await git.createRepository(gitAccountRef(account), { owner: draft.owner, name: draft.name.trim(), private: draft.private });
  } catch (error) {
    return {
      failure: `The workspace was created and tracked, but the repository could not be created: ${errorText(error)} Create it from Version history.`,
      note: null,
    };
  }
  const remote = remoteForRepository(account, created.repository);
  try {
    await git.connectRemote(workspaceId, remote.url, remote.account);
  } catch (error) {
    return { failure: connectFailedMessage(account, created.repository, errorText(error)), note: null };
  }
  return { failure: null, note: created.problem };
}

export function CreateWorkspaceModal({
  isOpen,
  onClose,
  onCreated,
}: CreateWorkspaceModalProps) {
  const navigate = useNavigate();
  const { currentOrg } = useWorkspace();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sync, setSync] = useState(false);
  const [repository, setRepository] = useState<GitRepositoryDraft>(NO_REPOSITORY);
  // The repository is named after the slug until its name is edited.
  const [nameEdited, setNameEdited] = useState(false);
  // A workspace created whose sync did not finish: the form is done, and Version history is where to finish it.
  const [unfinished, setUnfinished] = useState<{ readonly slug: string; readonly message: string } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setSlug("");
      setDescription("");
      setServerError(null);
      setIsSubmitting(false);
      setSync(false);
      setRepository(NO_REPOSITORY);
      setNameEdited(false);
      setUnfinished(null);
    }
  }, [isOpen]);

  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();
  const slugError =
    trimmedSlug && !isValidWorkspaceSlug(trimmedSlug)
      ? "Use lowercase letters, numbers, and hyphens; start and end with a letter or number."
      : null;
  const draft: GitRepositoryDraft = nameEdited ? repository : { ...repository, name: trimmedSlug };
  const canSubmit =
    Boolean(trimmedName && trimmedSlug && !slugError) && !isSubmitting && unfinished === null && (!sync || isRepositoryDraftReady(draft));

  const changeRepository = useCallback(
    (next: GitRepositoryDraft) => {
      if (next.name !== draft.name) setNameEdited(true);
      setRepository(next);
    },
    [draft.name],
  );

  const handleNameChange = (value: string): void => {
    setName(value);
    setSlug(toWorkspaceSlug(value));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setServerError(null);

    try {
      const workspace = await apiweave.workspaces.create({
        name: trimmedName,
        slug: trimmedSlug,
        description: description.trim() || null,
        isPersonal: false,
      });
      const synced = sync && draft.account !== null ? await syncNewWorkspace(workspace.workspaceId, draft.account, draft) : null;
      // The workspace exists whatever its sync came to: the list knows it, and the app is on it.
      await onCreated(workspace);
      if (synced !== null && synced.failure !== null) {
        setUnfinished({ slug: workspace.slug, message: synced.failure });
        return;
      }
      toast.success(
        synced === null ? `Workspace "${workspace.name}" created` : `Workspace "${workspace.name}" created and synced with ${draft.account?.host ?? "its repository"}`,
        synced === null || synced.note === null ? undefined : { description: synced.note },
      );
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create workspace";
      setServerError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openVersionHistory = (): void => {
    if (unfinished === null) return;
    navigate(`/${currentOrg?.slug ?? "personal"}/${unfinished.slug}/settings/version-history`);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSubmitting ? () => undefined : onClose}
      title="Create workspace"
      size="md"
      headerExtra={
        <LayoutGrid
          className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
      }
      footer={() =>
        unfinished === null ? (
          <ModalFormFooter
            formId="create-workspace-form"
            submitLabel="Create workspace"
            onCancel={onClose}
            busy={isSubmitting}
            canSubmit={canSubmit}
          />
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={openVersionHistory}>Open Version history</Button>
          </>
        )
      }
    >
      <form
        id="create-workspace-form"
        onSubmit={handleSubmit}
        className="space-y-4 p-5"
      >
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          A workspace groups its own workflows, projects, environments and
          secrets. Everything stays on this device.
        </p>

        {serverError && (
          <div className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20">
            {serverError}
          </div>
        )}

        {unfinished !== null && (
          <div
            role="alert"
            className="rounded border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-sm text-text-primary dark:bg-status-warning/20 dark:text-text-primary-dark"
          >
            {unfinished.message}
          </div>
        )}

        <FormField label="Workspace name" required>
          <Input
            value={name}
            onChange={(event) => handleNameChange(event.target.value)}
            placeholder="QA Workspace"
            disabled={isSubmitting || unfinished !== null}
            autoFocus
          />
        </FormField>

        <FormField
          label="Slug"
          hint="Used in workspace URLs. Lowercase letters, numbers, and hyphens only."
          {...(slugError ? { error: slugError } : {})}
          required
        >
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="qa-workspace"
            disabled={isSubmitting || unfinished !== null}
            {...(slugError ? { error: slugError } : {})}
          />
        </FormField>

        <FormField
          label="Description"
          hint="Optional, shown in workspace settings."
        >
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Workspace for the QA team's API tests"
            disabled={isSubmitting || unfinished !== null}
          />
        </FormField>

        {git.isAvailable() && (
          <div className="space-y-3 border-t border-border pt-4 dark:border-border-dark">
            <ToggleSetting
              title="Sync with GitHub or GitLab"
              description="Track the workspace in git, create an empty repository for it and keep the two in step. You can also do this later from Version history."
              checked={sync}
              onToggle={() => setSync(!sync)}
              disabled={isSubmitting || unfinished !== null}
            />
            {sync && (
              <CreateRepositorySection
                value={draft}
                onChange={changeRepository}
                defaultAccount={null}
                disabled={isSubmitting || unfinished !== null}
              />
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
