import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import { useWorkspace } from "../contexts/WorkspaceContext";
import type { GitRepositoryDraft } from "../types/GitRepositoryDraft";
import type { UseWorkspaceSyncResult } from "../types/UseWorkspaceSyncResult";
import type { WorkspaceSyncOutcome } from "../types/WorkspaceSyncOutcome";
import type { WorkspaceSyncResult } from "../types/WorkspaceSyncResult";
import type { WorkspaceSyncStop } from "../types/WorkspaceSyncStop";
import type { WorkspaceSyncTarget } from "../types/WorkspaceSyncTarget";
import { syncNewWorkspace } from "../utils/workspaceSync";

const NO_REPOSITORY: GitRepositoryDraft = { account: null, owner: "", name: "", private: true };
const NO_STOP: WorkspaceSyncStop = { awaitingAuthor: null, unfinished: null, authorError: null };

const MERGE_WAITING =
  "The workspace is created, tracked and connected, but it and its repository share no history. Resolve the merge from Version history.";

const STOPPED: WorkspaceSyncResult = { finished: false };

/**
 * Giving a workspace that exists a new repository, for a dialog: the
 * repository's draft, the sync itself, and the two places it can stop — git
 * knows no author, which the dialog clears by asking for one, or anything
 * else, which Version history finishes. Create workspace uses it for the
 * workspace it just made, and the prompt after an agent creates one for that.
 *
 * `defaultName` names the repository until the user edits the name: the
 * workspace's slug.
 */
export function useWorkspaceSync(defaultName: string): UseWorkspaceSyncResult {
  const navigate = useNavigate();
  const { currentOrg } = useWorkspace();
  // The draft as edited; its name counts only once the user has changed it.
  const [edited, setEdited] = useState<{ readonly draft: GitRepositoryDraft; readonly nameEdited: boolean }>({
    draft: NO_REPOSITORY,
    nameEdited: false,
  });
  const [stop, setStop] = useState<WorkspaceSyncStop>(NO_STOP);

  const draft: GitRepositoryDraft = edited.nameEdited ? edited.draft : { ...edited.draft, name: defaultName };

  const changeDraft = useCallback(
    (next: GitRepositoryDraft) => setEdited((current) => ({ draft: next, nameEdited: current.nameEdited || next.name !== draft.name })),
    [draft.name],
  );

  /** What an outcome comes to, holding why it stopped when it did. */
  const settle = useCallback(
    (target: WorkspaceSyncTarget, outcome: WorkspaceSyncOutcome): WorkspaceSyncResult => {
      if (outcome.identityMissing) {
        setStop({ ...NO_STOP, awaitingAuthor: target });
        return STOPPED;
      }
      // Its repository turned out to hold a history of its own: the merge is Version history's to resolve.
      const message = outcome.mergeWaiting ? MERGE_WAITING : outcome.failure;
      setStop(message === null ? NO_STOP : { ...NO_STOP, unfinished: { slug: target.slug, message, draft } });
      return message === null ? { finished: true, note: outcome.note } : STOPPED;
    },
    [draft],
  );

  const sync = useCallback(
    async (target: WorkspaceSyncTarget): Promise<WorkspaceSyncResult> => {
      if (draft.account === null) return STOPPED;
      return settle(target, await syncNewWorkspace(target.workspaceId, draft.account, draft));
    },
    [draft, settle],
  );

  const commitAsAuthor = useCallback(
    async (request: WorkspaceGitCommitRequest): Promise<WorkspaceSyncResult> => {
      const target = stop.awaitingAuthor;
      if (target === null || draft.account === null) return STOPPED;
      const outcome = await syncNewWorkspace(target.workspaceId, draft.account, draft, request.identity);
      if (outcome.identityMissing) {
        // Still no author: the form stays.
        setStop({ ...NO_STOP, awaitingAuthor: target, authorError: "Git still doesn't know who you are. Check the name and email, and try again." });
        return STOPPED;
      }
      return settle(target, outcome);
    },
    [draft, settle, stop.awaitingAuthor],
  );

  const openVersionHistory = useCallback(() => {
    const unfinished = stop.unfinished;
    if (unfinished === null) return;
    // The repository it was to be given goes with it: Version history starts its Create repository from it.
    navigate(`/${currentOrg?.slug ?? "personal"}/${unfinished.slug}/settings/version-history`, {
      state: { gitRepositoryDraft: unfinished.draft },
    });
  }, [currentOrg?.slug, navigate, stop.unfinished]);

  const reset = useCallback(() => {
    setEdited({ draft: NO_REPOSITORY, nameEdited: false });
    setStop(NO_STOP);
  }, []);

  return { ...stop, draft, changeDraft, sync, commitAsAuthor, openVersionHistory, reset };
}
