import { useEffect, useState, type FormEvent } from "react";
import { LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Modal } from "../molecules/Modal";
import { ModalFormFooter } from "../molecules/ModalFormFooter";
import { FormField } from "../molecules/FormField";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { isRepositoryDraftReady } from "./CreateRepositoryFields";
import { CreateRepositorySection } from "./CreateRepositorySection";
import { WorkspaceSyncStops } from "./WorkspaceSyncStops";
import { useBusyStep } from "../../hooks/useBusyStep";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useWorkspaceSync } from "../../hooks/useWorkspaceSync";
import { apiweave, git } from "../../utils/apiweaveClient";
import type { CreateWorkspaceModalProps } from "../../types";

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

export function CreateWorkspaceModal({
  isOpen,
  onClose,
  onCreated,
}: CreateWorkspaceModalProps) {
  // One list of accounts for the dialog: the sync section and any sign-in in it share it.
  // Asked only while the dialog is open, and again each time it opens: an account signed in since is not missed.
  const accounts = useGitAccounts({ enabled: isOpen });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const { busy: isSubmitting, error: serverError, setError: setServerError, runStep } = useBusyStep();
  // Null until the user flips it: then sync is on exactly when there is an account to create the repository as.
  const [syncChoice, setSyncChoice] = useState<boolean | null>(null);
  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();
  // The repository is named after the slug until its name is edited.
  const workspaceSync = useWorkspaceSync(trimmedSlug);
  const { draft, awaitingAuthor, unfinished, reset } = workspaceSync;
  const sync =
    git.isAvailable() &&
    (syncChoice ?? (accounts.loaded && accounts.accounts.length > 0));

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setSlug("");
      setDescription("");
      setServerError(null);
      setSyncChoice(null);
      reset();
    }
  }, [isOpen, reset, setServerError]);

  const slugError =
    trimmedSlug && !isValidWorkspaceSlug(trimmedSlug)
      ? "Use lowercase letters, numbers, and hyphens; start and end with a letter or number."
      : null;
  const canSubmit =
    Boolean(trimmedName && trimmedSlug && !slugError) &&
    !isSubmitting &&
    unfinished === null &&
    awaitingAuthor === null &&
    (!sync || isRepositoryDraftReady(draft));

  const handleNameChange = (value: string): void => {
    setName(value);
    setSlug(toWorkspaceSlug(value));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    await runStep(async () => {
      const workspace = await apiweave.workspaces.create({
        name: trimmedName,
        slug: trimmedSlug,
        description: description.trim() || null,
        isPersonal: false,
      });
      const synced = sync ? await workspaceSync.sync(workspace) : null;
      // The workspace exists whatever its sync came to: the list knows it, and the app is on it.
      await onCreated(workspace);
      if (synced !== null && !synced.finished) {
        // Git needs an author, which the dialog asks for, or Version history finishes it.
        setSyncChoice(false);
        return;
      }
      toast.success(
        synced === null
          ? `Workspace "${workspace.name}" created`
          : `Workspace "${workspace.name}" created and synced with ${draft.account?.host ?? "its repository"}`,
        synced === null || synced.note === null
          ? undefined
          : { description: synced.note },
      );
      onClose();
    }, undefined);
  };

  /** Finish the sync with the author given: create the repository and connect. */
  const commitAsAuthor = (request: WorkspaceGitCommitRequest): Promise<boolean> =>
    runStep(async () => {
      const synced = await workspaceSync.commitAsAuthor(request);
      if (!synced.finished) return false;
      toast.success(
        `Workspace created and synced with ${draft.account?.host ?? "its repository"}`,
        synced.note === null ? undefined : { description: synced.note },
      );
      onClose();
      return true;
    }, false);

  const openVersionHistory = (): void => {
    workspaceSync.openVersionHistory();
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
            className="rounded-sm border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20"
          >
            {serverError}
          </div>
        )}

        <WorkspaceSyncStops
          sync={workspaceSync}
          busy={isSubmitting}
          onCommitAuthor={commitAsAuthor}
        />

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
              description="Track the workspace in git, create an empty repository for it and keep the two in step. On when you are signed in to an account; you can also do this later from Version history."
              checked={sync}
              onToggle={() => setSyncChoice(!sync)}
              disabled={isSubmitting || unfinished !== null}
            />
            {sync && (
              <CreateRepositorySection
                value={draft}
                onChange={workspaceSync.changeDraft}
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
