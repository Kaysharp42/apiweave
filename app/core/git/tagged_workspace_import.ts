import type { GitAccountRef } from "@shared/types/GitAccountRef"
import type { HostCliService } from "./accounts/host_cli_service"
import { GitSyncDisposedError, type GitSyncService } from "./git_sync_service"

/** A repository the sign-in imported as a workspace here. */
export interface ImportedTaggedWorkspace {
  /** `owner/name` on the account's host. */
  readonly repository: string
  readonly workspaceId: string
  readonly slug: string
  readonly name: string
}

/** What importing one account's tagged repositories came to. `skipped` counts empty ones and ones already here. */
export interface TaggedWorkspaceImportResult {
  readonly opened: readonly ImportedTaggedWorkspace[]
  readonly skipped: number
  /** One line per repository that could not be opened, and the host's own list problems. */
  readonly problems: readonly string[]
}

export interface TaggedWorkspaceImportOptions {
  readonly hostCli: Pick<HostCliService, "listRepositories">
  readonly gitSync: Pick<GitSyncService, "openFromGit">
  /** Told each workspace as it opens, so the renderer can show it without waiting for the rest. */
  readonly onOpened?: (workspace: ImportedTaggedWorkspace) => void
}

/**
 * Open every non-empty repository the signed-in account has tagged
 * `apiweave-workspace` as a workspace here, one at a time.
 *
 * A repository already connected to a workspace is answered `duplicate` by
 * {@link GitSyncService.openFromGit} without cloning it, and counts as skipped.
 * An empty repository is skipped too: it holds no `workspace.json`, so there
 * is no workspace to import — a repository APIWeave created but never pushed
 * to is finished by connecting to it from the workspace that made it.
 *
 * One repository failing does not stop the rest: its reason is a line in
 * `problems`, alongside any owner the host could not list. The app quitting
 * does: the repositories not yet reached are left for the next sign-in.
 */
export async function importTaggedWorkspaces(
  account: GitAccountRef,
  options: TaggedWorkspaceImportOptions,
): Promise<TaggedWorkspaceImportResult> {
  const listed = await options.hostCli.listRepositories(account, { tagged: true, emptyOnly: false })
  const opened: ImportedTaggedWorkspace[] = []
  const problems: string[] = [...listed.problems]
  let skipped = 0

  for (const repository of listed.repositories) {
    if (repository.empty) {
      skipped += 1
      continue
    }
    try {
      const result = await options.gitSync.openFromGit(repository.httpsUrl, account)
      if (result.kind === "duplicate") {
        skipped += 1
        continue
      }
      const workspace: ImportedTaggedWorkspace = {
        repository: repository.fullName,
        workspaceId: result.workspaceId,
        slug: result.slug,
        name: result.name,
      }
      opened.push(workspace)
      options.onOpened?.(workspace)
    } catch (error) {
      // The app is quitting: every open after this one would be refused the same way.
      if (error instanceof GitSyncDisposedError) break
      problems.push(`${repository.fullName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { opened, skipped, problems }
}
