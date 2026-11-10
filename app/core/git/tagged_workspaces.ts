import type { GitAccountRef } from "@shared/types/GitAccountRef"
import type { GitRepositoryList } from "@shared/types/GitRepositoryList"
import type { HostCliService } from "./accounts/host_cli_service"
import type { GitSyncService } from "./git_sync_service"

export interface TaggedWorkspaceListOptions {
  readonly hostCli: Pick<HostCliService, "listRepositories">
  readonly gitSync: Pick<GitSyncService, "workspaceOnRemote">
}

/**
 * The repositories `account` has tagged `apiweave-workspace` that could be
 * opened here: what a sign-in offers to open, so a new machine gets the
 * account's workspaces without the user naming each repository.
 *
 * Nothing is cloned. An empty repository holds no `workspace.json`, so there
 * is no workspace to open — one APIWeave created but never pushed to is
 * finished by connecting to it from the workspace that made it. A repository
 * a workspace here is already connected to is left out too. The host's own
 * list problems (an owner it could not list, a list cut at its cap) pass
 * through unchanged.
 */
export async function listTaggedWorkspaces(account: GitAccountRef, options: TaggedWorkspaceListOptions): Promise<GitRepositoryList> {
  const listed = await options.hostCli.listRepositories(account, { tagged: true, emptyOnly: false })
  return {
    repositories: listed.repositories.filter(
      (repository) => !repository.empty && options.gitSync.workspaceOnRemote(repository.httpsUrl) === undefined,
    ),
    problems: listed.problems,
  }
}
