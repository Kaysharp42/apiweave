import { mkdirSync } from "node:fs"
import path from "node:path"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { z } from "zod"
import { isWorkspaceGitMode } from "@shared/types/WorkspaceGitMode"
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest"
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus"
import { GitIdentityMissingError } from "../core/git/git_errors"
import { GitService } from "../core/git/git_service"
import { GitSyncService, type GitSyncRepositories } from "../core/git/git_sync_service"
import { GIT_CHANNELS } from "../core/ipc/channels"

/** `requireTrustedSender` from the composition root: refuses any sender but the app's own document. */
type TrustedSenderGuard = <Args extends unknown[], R>(
  handler: (...args: Args) => R,
) => (event: IpcMainInvokeEvent, ...args: Args) => R | Promise<never>

/**
 * The sync service over the user's own git: clones under `userData/git`, and
 * an empty `userData/git-hooks` as every call's `core.hooksPath`, so no hook —
 * the user's global one included — runs inside a clone.
 */
export function createGitSync(
  userDataPath: string,
  repositories: GitSyncRepositories,
  onStatusChanged: (status: WorkspaceGitStatus) => void,
): GitSyncService {
  const hooksDir = path.join(userDataPath, "git-hooks")
  mkdirSync(hooksDir, { recursive: true })
  return new GitSyncService({
    cloneRoot: path.join(userDataPath, "git"),
    git: new GitService({ hooksDir }),
    repositories,
    onStatusChanged,
  })
}

function workspaceIdOf(value: unknown): string {
  if (typeof value !== "string" || value === "") throw new Error("workspaceId is required")
  return value
}

const CommitRequestSchema = z
  .object({
    message: z.string().optional(),
    identity: z.object({ name: z.string(), email: z.string() }).strict().optional(),
  })
  .strict()

/** The renderer's commit request, checked: `{ message?, identity?: { name, email } }`, or nothing. */
function commitRequestOf(value: unknown): WorkspaceGitCommitRequest {
  return CommitRequestSchema.parse(value ?? {})
}

const RemoteUrlSchema = z.string().min(1, "a remote URL is required").max(2048, "a remote URL is at most 2048 characters")

/** Track, resolving a missing author as the status that asks for one rather than as an error the renderer would have to read. */
async function trackOrAskForAuthor(gitSync: GitSyncService, workspaceId: string): Promise<WorkspaceGitStatus> {
  try {
    return await gitSync.track(workspaceId)
  } catch (error) {
    if (error instanceof GitIdentityMissingError) return gitSync.status(workspaceId)
    throw error
  }
}

/**
 * The `__APIWEAVE_GIT__` handlers. Deliberately off the `core/ipc/handlers/`
 * registry, like `updates:*` and `agents:*`: the registry is also the MCP
 * bridge's handler list, and an agent that could reach git could connect a
 * remote and push a workspace to a repository it controls.
 */
export function registerGitHandlers(ipcMain: IpcMain, guard: TrustedSenderGuard, gitSync: GitSyncService): void {
  ipcMain.handle(GIT_CHANNELS.status, guard((workspaceId: unknown) => gitSync.status(workspaceIdOf(workspaceId))))
  ipcMain.handle(GIT_CHANNELS.track, guard((workspaceId: unknown) => trackOrAskForAuthor(gitSync, workspaceIdOf(workspaceId))))
  ipcMain.handle(GIT_CHANNELS.untrack, guard((workspaceId: unknown) => gitSync.untrack(workspaceIdOf(workspaceId))))
  ipcMain.handle(
    GIT_CHANNELS.setMode,
    guard((workspaceId: unknown, mode: unknown) => {
      if (!isWorkspaceGitMode(mode)) throw new Error(`unknown history mode: ${String(mode)}`)
      return gitSync.setMode(workspaceIdOf(workspaceId), mode)
    }),
  )
  ipcMain.handle(
    GIT_CHANNELS.syncNow,
    guard((workspaceId: unknown, request: unknown) => gitSync.syncNow(workspaceIdOf(workspaceId), commitRequestOf(request))),
  )
  ipcMain.handle(
    GIT_CHANNELS.connectRemote,
    guard((workspaceId: unknown, url: unknown) => gitSync.connectRemote(workspaceIdOf(workspaceId), RemoteUrlSchema.parse(url))),
  )
  ipcMain.handle(
    GIT_CHANNELS.disconnectRemote,
    guard((workspaceId: unknown) => gitSync.disconnectRemote(workspaceIdOf(workspaceId))),
  )
  ipcMain.handle(
    GIT_CHANNELS.discardLocalChanges,
    guard((workspaceId: unknown) => gitSync.discardLocalChanges(workspaceIdOf(workspaceId))),
  )
  ipcMain.handle(GIT_CHANNELS.openFromGit, guard((url: unknown) => gitSync.openFromGit(RemoteUrlSchema.parse(url))))
}
