import { useCallback, type FormEvent } from "react";
import { GitBranch } from "lucide-react";
import { toast } from "sonner";
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import { Button } from "../atoms/Button";
import { Modal } from "../molecules/Modal";
import { ModalFormFooter } from "../molecules/ModalFormFooter";
import { isRepositoryDraftReady } from "./CreateRepositoryFields";
import { CreateRepositorySection } from "./CreateRepositorySection";
import { WorkspaceSyncStops } from "./WorkspaceSyncStops";
import { useAgentCreatedWorkspace } from "../../hooks/useAgentCreatedWorkspace";
import { useBusyStep } from "../../hooks/useBusyStep";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useWorkspaceSync } from "../../hooks/useWorkspaceSync";
import type { WorkspaceSyncResult } from "../../types";

const FORM_ID = "agent-workspace-repository-form";

/**
 * After an agent creates a workspace: ask whether to give it a repository as
 * one of the user's git accounts. An agent cannot do that itself — creating
 * repositories and signing in as an account are the user's — so the app asks,
 * once per workspace, and the user creates it or says Not now. Workspaces
 * created in a row are asked about one at a time. Mounted once, in the app
 * shell, so the question is asked whatever page the user is on.
 */
export function AgentWorkspaceRepositoryPrompt() {
  const { workspace, dismiss } = useAgentCreatedWorkspace();
  const { busy, error, setError, runStep } = useBusyStep();
  const accounts = useGitAccounts({ enabled: workspace !== null });
  const workspaceSync = useWorkspaceSync(workspace?.slug ?? "");
  const { draft, awaitingAuthor, unfinished, reset } = workspaceSync;

  const next = useCallback(() => {
    reset();
    setError(null);
    dismiss();
  }, [dismiss, reset, setError]);

  /** Close on a finished sync, saying so; a stopped one stays open to say why. */
  const finish = (result: WorkspaceSyncResult): boolean => {
    if (!result.finished) return false;
    toast.success(
      `"${workspace?.name ?? "The workspace"}" is synced with ${draft.account?.host ?? "its repository"}`,
      result.note === null ? undefined : { description: result.note },
    );
    next();
    return true;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (workspace === null) return;
    void runStep(async () => finish(await workspaceSync.sync(workspace)), false);
  };

  const commitAsAuthor = (request: WorkspaceGitCommitRequest): Promise<boolean> =>
    runStep(async () => finish(await workspaceSync.commitAsAuthor(request)), false);

  const openVersionHistory = (): void => {
    workspaceSync.openVersionHistory();
    next();
  };

  const stopped = awaitingAuthor !== null || unfinished !== null;

  return (
    <Modal
      isOpen={workspace !== null}
      onClose={busy ? () => undefined : next}
      title="Create a repository?"
      size="md"
      headerExtra={<GitBranch className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark" aria-hidden="true" />}
      footer={() =>
        unfinished === null ? (
          <ModalFormFooter
            formId={FORM_ID}
            submitLabel="Create repository"
            cancelLabel="Not now"
            onCancel={next}
            busy={busy}
            canSubmit={!busy && !stopped && isRepositoryDraftReady(draft)}
          />
        ) : (
          <>
            <Button variant="ghost" onClick={next}>
              Close
            </Button>
            <Button onClick={openVersionHistory}>Open Version history</Button>
          </>
        )
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4 p-5">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          An agent created the workspace <strong className="text-text-primary dark:text-text-primary-dark">{workspace?.name}</strong>.
          Track it in git and create a repository for it as one of your accounts? You can also do this later from Version history.
        </p>

        {error !== null && (
          <div
            role="alert"
            className="rounded-sm border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20"
          >
            {error}
          </div>
        )}

        <WorkspaceSyncStops sync={workspaceSync} busy={busy} onCommitAuthor={commitAsAuthor} />

        {awaitingAuthor === null && (
          <CreateRepositorySection
            value={draft}
            onChange={workspaceSync.changeDraft}
            defaultAccount={null}
            accounts={accounts}
            disabled={busy || unfinished !== null}
          />
        )}
      </form>
    </Modal>
  );
}
