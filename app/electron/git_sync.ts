// fallow-ignore-file code-duplication -- this is a registration table of parallel one-line `handleWorkspace(...)` calls; each channel's handler has its own signature, so a loop would lose the per-channel typing, and `handleWorkspace` already owns the sender guard.
import { mkdirSync } from "node:fs"
import path from "node:path"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { z } from "zod"
import type { AgentWriteEvent } from "@shared/types/AgentWriteEvent"
import { isWorkspaceGitMode } from "@shared/types/WorkspaceGitMode"
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest"
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus"
import type { HostCliService } from "../core/git/accounts/host_cli_service"
import { GitIdentityMissingError } from "../core/git/git_errors"
import { GitService } from "../core/git/git_service"
import { GitSyncService, type GitSyncRepositories } from "../core/git/git_sync_service"
import { GIT_CHANNELS } from "../core/ipc/channels"

/** `requireTrustedSender` from the composition root: refuses any sender but the app's own document. */
type TrustedSenderGuard = <Args extends unknown[], R>(
  handler: (...args: Args) => R,
) => (event: IpcMainInvokeEvent, ...args: Args) => R | Promise<never>

/** What an import from the remote can rewrite: every domain the renderer refetches for an agent's write that the workspace's tree holds. */
const IMPORTED_DOMAINS = ["workspaces", "projects", "workflows", "environments"] as const

/**
 * The sync service over the user's own git: clones under `userData/git`, and
 * an empty `userData/git-hooks` as every call's `core.hooksPath`, so no hook —
 * the user's global one included — runs inside a clone.
 *
 * An import from the remote rewrites records under a renderer that did not
 * ask for it, exactly as an agent's MCP write does, and a form still holding
 * the old values would save them back over it. So it is announced the same
 * way: `publishRefresh` gets the coarse event the renderer already refetches
 * its lists for.
 */
export function createGitSync(
  userDataPath: string,
  repositories: GitSyncRepositories,
  onStatusChanged: (status: WorkspaceGitStatus) => void,
  publishRefresh: (event: AgentWriteEvent) => void,
): GitSyncService {
  const hooksDir = path.join(userDataPath, "git-hooks")
  mkdirSync(hooksDir, { recursive: true })
  return new GitSyncService({
    cloneRoot: path.join(userDataPath, "git"),
    git: new GitService({ hooksDir }),
    repositories,
    onStatusChanged,
    onImported: (workspaceId) => {
      for (const domain of IMPORTED_DOMAINS) publishRefresh({ domain, action: "gitImport", workspaceId })
    },
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

const MergePickSchema = z
  .object({
    // A file conflict names its path, which may run to 4096 characters.
    recordId: z.string().min(1).max(4096),
    path: z.string().max(4096),
    side: z.enum(["ours", "theirs"]),
  })
  .strict()

/** A resolution's picks, checked: each names one record or file (by id or path), one path in it, and which copy settles it. */
const MergePicksSchema = z.array(MergePickSchema).max(10_000)

const MergeRecordIdsSchema = z
  .array(z.string().min(1, "a record id is required").max(4096))
  .max(500, "at most 500 records are asked about at once")

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
 * remote and push a workspace to a repository it controls. The same goes for
 * the user's git accounts: an agent that could pick one could push wherever
 * that account can write.
 */
export function registerGitHandlers(
  ipcMain: IpcMain,
  guard: TrustedSenderGuard,
  gitSync: GitSyncService,
  hostCli: HostCliService,
): void {
  const handleWorkspace = (channel: string, call: (workspaceId: string) => Promise<unknown>): void => {
    ipcMain.handle(channel, guard((workspaceId: unknown) => call(workspaceIdOf(workspaceId))))
  }
  handleWorkspace(GIT_CHANNELS.status, (workspaceId) => gitSync.status(workspaceId))
  handleWorkspace(GIT_CHANNELS.track, (workspaceId) => trackOrAskForAuthor(gitSync, workspaceId))
  handleWorkspace(GIT_CHANNELS.untrack, (workspaceId) => gitSync.untrack(workspaceId))
  handleWorkspace(GIT_CHANNELS.pendingChanges, (workspaceId) => gitSync.pendingChanges(workspaceId))
  handleWorkspace(GIT_CHANNELS.mergeConflicts, (workspaceId) => gitSync.mergeConflicts(workspaceId))
  handleWorkspace(GIT_CHANNELS.mergePicks, (workspaceId) => gitSync.mergePicks(workspaceId))
  ipcMain.handle(
    GIT_CHANNELS.mergeRecordCommits,
    guard((workspaceId: unknown, recordIds: unknown) =>
      gitSync.mergeRecordCommits(workspaceIdOf(workspaceId), MergeRecordIdsSchema.parse(recordIds)),
    ),
  )
  handleWorkspace(GIT_CHANNELS.abandonMerge, (workspaceId) => gitSync.abandonMerge(workspaceId))
  ipcMain.handle(
    GIT_CHANNELS.resolveMerge,
    guard((workspaceId: unknown, picks: unknown, request: unknown) =>
      gitSync.resolveMerge(workspaceIdOf(workspaceId), MergePicksSchema.parse(picks), commitRequestOf(request)),
    ),
  )
  handleWorkspace(GIT_CHANNELS.disconnectRemote, (workspaceId) => gitSync.disconnectRemote(workspaceId))
  handleWorkspace(GIT_CHANNELS.discardLocalChanges, (workspaceId) => gitSync.discardLocalChanges(workspaceId))
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
  ipcMain.handle(GIT_CHANNELS.openFromGit, guard((url: unknown) => gitSync.openFromGit(RemoteUrlSchema.parse(url))))
  ipcMain.handle(GIT_CHANNELS.listAccounts, guard(() => hostCli.listAccounts()))
}
