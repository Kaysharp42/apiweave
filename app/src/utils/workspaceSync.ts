import type { GitAccount } from "@shared/types/GitAccount";
import type { GitIdentity } from "@shared/types/GitIdentity";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { GitRepositoryDraft } from "../types/GitRepositoryDraft";
import type { WorkspaceSyncOutcome } from "../types/WorkspaceSyncOutcome";
import { git } from "./apiweaveClient";
import { gitAccountRef } from "./gitAccounts";
import { connectFailedMessage, remoteForRepository } from "./gitRepositories";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
 * rather than as a sync that finished. A connect that came back `error` bound
 * the remote but could not prepare the merge, so its reason is the failure.
 */
export async function syncNewWorkspace(
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
  if (connected.state === "error") {
    return stop(
      connected.lastError?.message ??
        `${account.host}/${created.repository.fullName} was created and connected, but the workspace could not be prepared for it. Open Version history to retry.`,
    );
  }
  return {
    failure: null,
    note: created.problem,
    identityMissing: false,
    mergeWaiting: connected.state === "merging",
  };
}
