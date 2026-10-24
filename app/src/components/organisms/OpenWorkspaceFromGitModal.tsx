import { useEffect, useState, type FormEvent } from "react";
import { GitBranch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../atoms/Button";
import { Modal } from "../molecules/Modal";
import { GitRemotePicker } from "./GitRemotePicker";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { git } from "../../utils/apiweaveClient";
import type {
  ExistingWorkspace,
  GitRemoteSelection,
  OpenWorkspaceFromGitModalProps,
  PendingWorkspaceOpen,
} from "../../types";

export function OpenWorkspaceFromGitModal({
  isOpen,
  onClose,
}: OpenWorkspaceFromGitModalProps) {
  const { refresh, switchTo } = useWorkspace();
  const [selection, setSelection] = useState<GitRemoteSelection | null>(null);
  const [existing, setExisting] = useState<ExistingWorkspace | null>(null);
  const [pending, setPending] = useState<PendingWorkspaceOpen | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSelection(null);
      setExisting(null);
      setPending(null);
      setServerError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const canSubmit = selection !== null && !isSubmitting;

  const goToWorkspace = async (slug: string): Promise<void> => {
    await refresh();
    switchTo(slug);
    onClose();
  };

  const run = async (work: () => Promise<void>, failure: string) => {
    setIsSubmitting(true);
    setServerError(null);
    try {
      await work();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : failure);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selection === null || isSubmitting) return;

    await run(async () => {
      const result = await git.openFromGit(selection.url, selection.account);
      if (result.kind === "duplicate") {
        setExisting({ slug: result.slug, name: result.name });
        return;
      }
      if (result.warnings.length > 0) {
        setPending({
          slug: result.slug,
          name: result.name,
          warnings: result.warnings,
        });
        // The workspace exists now, whether or not the user switches to it.
        await refresh();
        return;
      }
      await goToWorkspace(result.slug);
      toast.success(`Workspace "${result.name}" opened`);
    }, "Failed to open workspace");
  };

  const handleOpenExisting = async () => {
    if (existing === null || isSubmitting) return;
    await run(() => goToWorkspace(existing.slug), "Failed to open workspace");
  };

  const handleOpenPending = async () => {
    if (pending === null || isSubmitting) return;
    await run(async () => {
      await goToWorkspace(pending.slug);
      toast.success(`Workspace "${pending.name}" opened`);
    }, "Failed to open workspace");
  };

  const footer = () => {
    if (existing !== null) {
      return (
        <>
          <Button
            variant="ghost"
            onClick={() => setExisting(null)}
            disabled={isSubmitting}
          >
            Back
          </Button>
          <Button loading={isSubmitting} onClick={handleOpenExisting}>
            Open it
          </Button>
        </>
      );
    }
    if (pending !== null) {
      return (
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Close
          </Button>
          <Button loading={isSubmitting} onClick={handleOpenPending}>
            Open workspace
          </Button>
        </>
      );
    }
    return (
      <>
        <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="open-workspace-from-git-form"
          loading={isSubmitting}
          disabled={!canSubmit}
        >
          Open workspace
        </Button>
      </>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSubmitting ? () => undefined : onClose}
      title="Open workspace from git"
      size="md"
      headerExtra={
        <GitBranch
          className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
      }
      footer={footer}
    >
      <div className="space-y-4 p-5">
        {serverError && (
          <div
            role="alert"
            className="rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20"
          >
            {serverError}
          </div>
        )}

        {existing !== null ? (
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            This workspace is already in APIWeave:{" "}
            <strong className="font-semibold text-text-primary dark:text-text-primary-dark">
              {existing.name}
            </strong>
            .
          </p>
        ) : pending !== null ? (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              The workspace was opened, with a few things to review before you
              switch to it:
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-text-secondary dark:text-text-secondary-dark">
              {pending.warnings.map((warning, index) => (
                <li key={`${index}:${warning}`}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : (
          <form
            id="open-workspace-from-git-form"
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              The workspace and its API tests are cloned from the repository
              into this app, and sync with it as the account you choose.
            </p>

            {/* Back from a duplicate remounts the picker on what was chosen. */}
            <GitRemotePicker mode="open" initial={selection} onChange={setSelection} disabled={isSubmitting} />
          </form>
        )}
      </div>
    </Modal>
  );
}
