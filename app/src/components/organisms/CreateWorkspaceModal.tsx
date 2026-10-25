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
import { GitAuthorForm } from "./GitAuthorForm";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { apiweave, git } from "../../utils/apiweaveClient";
import { gitAccountRef } from "../../utils/gitAccounts";
import {
  connectFailedMessage,
  remoteForRepository,
} from "../../utils/gitRepositories";
import type { GitIdentity } from "@shared/types/GitIdentity";
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type {
  CreateWorkspaceModalProps,
  GitRepositoryDraft,
  UnfinishedWorkspaceSync,
  WorkspaceSyncOutcome,
} from "../../types";

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

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const NO_REPOSITORY: GitRepositoryDraft = {
  account: null,
  owner: "",
  name: "",
  private: true,
};

/**
 * Track a workspace just created, create its repository and connect to it,
 * as `account`. Resolves to what went wrong, or null, and to a note about a
 * repository that works but could not be tagged. Every step after the first
 * leaves the ones before it in place — the workspace tracked, the repository
 * created — because each can be finished from Version history, and
 * APIWeave never deletes a repository.
 *
 * A git that knows no author is the one stop that is not a failure: the
 * commit that is the first thing to push is retried with `identity`, so the
 * sync carries on where it left off rather than sending the user elsewhere.
 *
 * A created repository is empty, so it cannot hold a history of its own; a
 * connect that starts a merge all the same is reported as `mergeWaiting`
 * rather than as a sync that finished.
 */
async function syncNewWorkspace(
  workspaceId: string,
  account: GitAccount,
  draft: GitRepositoryDraft,
  identity?: GitIdentity,
): Promise<WorkspaceSyncOutcome> {
  const stop = (failure: string): WorkspaceSyncOutcome => ({
    failure,
    note: null,
    identityMissing: false,
    mergeWaiting: false,
  });
  let status: WorkspaceGitStatus;
  try {
    status =
      identity === undefined
        ? await git.track(workspaceId)
        : await git.syncNow(workspaceId, { identity });
  } catch (error) {
    return stop(
      `The workspace was created, but it could not be tracked: ${errorText(error)}`,
    );
  }
  if (status.lastError?.code === "identity_missing")
    return { failure: null, note: null, identityMissing: true, mergeWaiting: false };
  // Anything else git reported leaves the first commit unmade: a repository now would have nothing
  // to receive, and connecting to it would be refused.
  if (status.lastError !== null)
    return stop(
      `The workspace was created, but its first commit failed: ${status.lastError.message}`,
    );
  let created;
  try {
    created = await git.createRepository(gitAccountRef(account), {
      owner: draft.owner,
      name: draft.name.trim(),
      private: draft.private,
    });
  } catch (error) {
    return stop(
      `The workspace was created and tracked, but the repository could not be created: ${errorText(error)} Create it from Version history.`,
    );
  }
  const remote = remoteForRepository(account, created.repository);
  let connected: WorkspaceGitStatus;
  try {
    connected = await git.connectRemote(workspaceId, remote.url, remote.account);
  } catch (error) {
    return stop(
      connectFailedMessage(account, created.repository, errorText(error)),
    );
  }
  return {
    failure: null,
    note: created.problem,
    identityMissing: false,
    mergeWaiting: connected.state === "merging",
  };
}

export function CreateWorkspaceModal({
  isOpen,
  onClose,
  onCreated,
}: CreateWorkspaceModalProps) {
  const navigate = useNavigate();
  const { currentOrg } = useWorkspace();
  // One list of accounts for the dialog: the sync section and any sign-in in it share it.
  // Asked only while the dialog is open, and again each time it opens: an account signed in since is not missed.
  const accounts = useGitAccounts({ enabled: isOpen });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sync, setSync] = useState(false);
  const [repository, setRepository] =
    useState<GitRepositoryDraft>(NO_REPOSITORY);
  // The repository is named after the slug until its name is edited.
  const [nameEdited, setNameEdited] = useState(false);
  // A workspace created whose sync did not finish: the form is done, and Version history is where to finish it.
  const [unfinished, setUnfinished] = useState<UnfinishedWorkspaceSync | null>(
    null,
  );
  // A workspace created whose sync waits on the author: its id and slug, while the dialog asks.
  const [awaitingAuthor, setAwaitingAuthor] = useState<{
    readonly workspaceId: string;
    readonly slug: string;
  } | null>(null);

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
      setAwaitingAuthor(null);
    }
  }, [isOpen]);

  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();
  const slugError =
    trimmedSlug && !isValidWorkspaceSlug(trimmedSlug)
      ? "Use lowercase letters, numbers, and hyphens; start and end with a letter or number."
      : null;
  const draft: GitRepositoryDraft = nameEdited
    ? repository
    : { ...repository, name: trimmedSlug };
  const canSubmit =
    Boolean(trimmedName && trimmedSlug && !slugError) &&
    !isSubmitting &&
    unfinished === null &&
    awaitingAuthor === null &&
    (!sync || isRepositoryDraftReady(draft));

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
      const account = draft.account;
      const synced =
        sync && account !== null
          ? await syncNewWorkspace(workspace.workspaceId, account, draft)
          : null;
      // The workspace exists whatever its sync came to: the list knows it, and the app is on it.
      await onCreated(workspace);
      if (synced?.identityMissing === true) {
        // The one stop that can be cleared here: ask who the commit is by, then carry on.
        setAwaitingAuthor({
          workspaceId: workspace.workspaceId,
          slug: workspace.slug,
        });
        setSync(false);
        return;
      }
      if (synced?.mergeWaiting === true) {
        // Its repository turned out to hold a history of its own: the merge is Version history's to resolve.
        setUnfinished({
          slug: workspace.slug,
          message:
            "The workspace is created, tracked and connected, but it and its repository share no history. Resolve the merge from Version history.",
          draft,
        });
        return;
      }
      if (synced !== null && synced.failure !== null) {
        setUnfinished({ slug: workspace.slug, message: synced.failure, draft });
        return;
      }
      toast.success(
        synced === null
          ? `Workspace "${workspace.name}" created`
          : `Workspace "${workspace.name}" created and synced with ${account?.host ?? "its repository"}`,
        synced === null || synced.note === null
          ? undefined
          : { description: synced.note },
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

  /** Ask who the commit is by, then finish the sync with it: create the repository and connect. */
  const commitAsAuthor = async (
    request: WorkspaceGitCommitRequest,
  ): Promise<boolean> => {
    if (awaitingAuthor === null || draft.account === null) return false;
    setIsSubmitting(true);
    setServerError(null);
    try {
      const synced = await syncNewWorkspace(
        awaitingAuthor.workspaceId,
        draft.account,
        draft,
        request.identity,
      );
      if (synced.identityMissing) {
        // Still no author: the form stays, and the plain submit is not re-armed behind it.
        setServerError(
          "Git still doesn't know who you are. Check the name and email, and try again.",
        );
        return false;
      }
      setAwaitingAuthor(null);
      if (synced.mergeWaiting) {
        setUnfinished({
          slug: awaitingAuthor.slug,
          message:
            "The workspace is created, tracked and connected, but it and its repository share no history. Resolve the merge from Version history.",
          draft,
        });
        return false;
      }
      if (synced.failure !== null) {
        setUnfinished({
          slug: awaitingAuthor.slug,
          message: synced.failure,
          draft,
        });
        return false;
      }
      toast.success(
        `Workspace created and synced with ${draft.account.host}`,
        synced.note === null ? undefined : { description: synced.note },
      );
      onClose();
      return true;
    } catch (error) {
      setServerError(errorText(error));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const openVersionHistory = (): void => {
    if (unfinished === null) return;
    // The repository the form was to create goes with it: Version history starts its Create repository from it.
    navigate(
      `/${currentOrg?.slug ?? "personal"}/${unfinished.slug}/settings/version-history`,
      {
        state: { gitRepositoryDraft: unfinished.draft },
      },
    );
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
          <div
            role="alert"
            className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20"
          >
            {serverError}
          </div>
        )}

        {awaitingAuthor !== null && (
          <div className="space-y-2 rounded border border-border px-3 py-2 dark:border-border-dark">
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              The workspace is created and tracked. Tell git who is making its
              commits, and APIWeave creates the repository and connects it
              straight away.
            </p>
            <GitAuthorForm busy={isSubmitting} onCommit={commitAsAuthor} />
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
                accounts={accounts}
                disabled={isSubmitting || unfinished !== null}
              />
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
