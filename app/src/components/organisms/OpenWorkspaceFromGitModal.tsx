import { useEffect, useState, type FormEvent } from "react";
import { GitBranch } from "lucide-react";
import { toast } from "sonner";
import type { OpenWorkspaceFromGitResult } from "@shared/types/OpenWorkspaceFromGitResult";
import { Modal } from "../molecules/Modal";
import { GitRemotePicker } from "./GitRemotePicker";
import { OpenWorkspaceFromGitFooter } from "./OpenWorkspaceFromGitFooter";
import { RemoteBranchChooser } from "./RemoteBranchChooser";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { git } from "../../utils/apiweaveClient";
import type {
  GitRemoteSelection,
  OpenWorkspaceForm,
  OpenWorkspaceFromGitModalProps,
  OpenWorkspaceOutcome,
} from "../../types";

const FORM_ID = "open-workspace-from-git-form";

/** The clone call: the remote's default branch when none was chosen, else the one that was. */
function openFromGit(
  selection: GitRemoteSelection,
  branch: string,
): Promise<OpenWorkspaceFromGitResult> {
  return branch === ""
    ? git.openFromGit(selection.url, selection.account)
    : git.openFromGit(selection.url, selection.account, branch);
}

/** Why the open failed: the bridge's own words, or a plain line when it gave none. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to open workspace";
}

/**
 * Clone a workspace repository into the app and switch to it. A duplicate links
 * to the copy already here instead of making a second one; one that opened with
 * import warnings is listed before the user decides to switch.
 */
export function OpenWorkspaceFromGitModal({
  isOpen,
  onClose,
}: OpenWorkspaceFromGitModalProps) {
  const { refresh, switchTo } = useWorkspace();
  // Held here, so a sign-in made in the picker lists its account straight away. Asked only while the
  // dialog is open, and again each time it opens: an account signed in since is not missed.
  const accounts = useGitAccounts({ enabled: isOpen });
  const [form, setForm] = useState<OpenWorkspaceForm>({
    selection: null,
    branch: "",
  });
  const [outcome, setOutcome] = useState<OpenWorkspaceOutcome>({ kind: "form" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) return;
    setForm({ selection: null, branch: "" });
    setOutcome({ kind: "form" });
    setIsSubmitting(false);
    setServerError(null);
  }, [isOpen]);

  /** A new remote starts on its default branch: the branch list belongs to it, not to the last one. */
  const chooseRemote = (next: GitRemoteSelection | null): void =>
    setForm({ selection: next, branch: "" });

  const openWorkspace = async (slug: string): Promise<void> => {
    await refresh();
    switchTo(slug);
    onClose();
  };

  const run = async (work: () => Promise<void>): Promise<void> => {
    setIsSubmitting(true);
    setServerError(null);
    try {
      await work();
    } catch (error) {
      setServerError(failureText(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const { selection, branch } = form;
    if (selection === null || isSubmitting) return;

    void run(async () => {
      const result = await openFromGit(selection, branch);
      if (result.kind === "duplicate") {
        setOutcome({ kind: "duplicate", workspace: result });
        return;
      }
      if (result.warnings.length > 0) {
        setOutcome({ kind: "pending", workspace: result });
        // The workspace exists now, whether or not the user switches to it.
        await refresh();
        return;
      }
      await openWorkspace(result.slug);
      toast.success(`Workspace "${result.name}" opened`);
    });
  };

  /** Open what the dialog found: the duplicate already here, or the workspace it just opened. */
  const handleConfirm = (): void => {
    if (outcome.kind === "form" || isSubmitting) return;
    const { workspace } = outcome;
    void run(async () => {
      await openWorkspace(workspace.slug);
      if (outcome.kind === "pending")
        toast.success(`Workspace "${workspace.name}" opened`);
    });
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
      footer={
        <OpenWorkspaceFromGitFooter
          outcome={outcome}
          busy={isSubmitting}
          canSubmit={form.selection !== null && !isSubmitting}
          formId={FORM_ID}
          onBack={() => setOutcome({ kind: "form" })}
          onCancel={onClose}
          onConfirm={handleConfirm}
        />
      }
    >
      <div className="space-y-4 p-5">
        {serverError !== null && (
          <div
            role="alert"
            className="rounded-sm border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20"
          >
            {serverError}
          </div>
        )}

        {outcome.kind === "duplicate" && (
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            This workspace is already in APIWeave:{" "}
            <strong className="font-semibold text-text-primary dark:text-text-primary-dark">
              {outcome.workspace.name}
            </strong>
            .
          </p>
        )}

        {outcome.kind === "pending" && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              The workspace was opened, with a few things to review before you
              switch to it:
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-text-secondary dark:text-text-secondary-dark">
              {outcome.workspace.warnings.map((warning, index) => (
                <li key={`${index}:${warning}`}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {outcome.kind === "form" && (
          <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              The workspace and its API tests are cloned from the repository
              into this app, and sync with it as the account you choose.
            </p>

            {/* Back from a duplicate remounts the picker on what was chosen. */}
            <GitRemotePicker
              mode="open"
              initial={form.selection}
              onChange={chooseRemote}
              accounts={accounts}
              disabled={isSubmitting}
            />
            {form.selection !== null && (
              <RemoteBranchChooser
                selection={form.selection}
                branch={form.branch}
                hint="The workspace is cloned from this branch, and syncs with it from then on."
                disabled={isSubmitting}
                onBranchChange={(branch) =>
                  setForm((previous) => ({ ...previous, branch }))
                }
              />
            )}
          </form>
        )}
      </div>
    </Modal>
  );
}
