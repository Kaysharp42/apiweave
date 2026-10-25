// fallow-ignore-file code-duplication -- this is a registration table of parallel one-line `handleWorkspace(...)` calls; each channel's handler has its own signature, so a loop would lose the per-channel typing, and `handleWorkspace` already owns the sender guard.
import { mkdirSync } from "node:fs"
import path from "node:path"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { z } from "zod"
import type { AgentWriteEvent } from "@shared/types/AgentWriteEvent"
import type { GitAccountRef } from "@shared/types/GitAccountRef"
import type { GitCreateRepositoryRequest } from "@shared/types/GitCreateRepositoryRequest"
import type { GitMergePick } from "@shared/types/GitMergePick"
import type { GitProvider } from "@shared/types/GitProvider"
import type { GitRepositoryListRequest } from "@shared/types/GitRepositoryListRequest"
import type { GitSignInPrompt } from "@shared/types/GitSignInPrompt"
import { GitAccountRefSchema, GitHostSchema } from "@shared/zod-schemas/GitAccountRefSchema"
import { GitCreateRepositoryRequestSchema, GitRepositoryListRequestSchema } from "@shared/zod-schemas/GitCreateRepositoryRequestSchema"
import { JsonValueSchema } from "@shared/zod-schemas/JsonValueSchema"
import { isWorkspaceGitMode } from "@shared/types/WorkspaceGitMode"
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest"
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus"
import type { HostCliService } from "../core/git/accounts/host_cli_service"
import { GitIdentityMissingError } from "../core/git/git_errors"
import { GitService } from "../core/git/git_service"
import { GitSyncService, type GitSyncRepositories } from "../core/git/git_sync_service"
import { GIT_CHANNELS } from "../core/ipc/channels"
import { getLogger } from "../core/logging/logger"

const log = getLogger("git-sign-in")

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
 *
 * A workspace bound to an account gets that account's token from `hostCli`,
 * one git call at a time.
 */
export function createGitSync(
  userDataPath: string,
  repositories: GitSyncRepositories,
  hostCli: HostCliService,
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
    credentials: (account) => hostCli.token(account),
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

/** The account a remote is reached as, or null (or nothing) for the user's own credentials. */
const AccountSchema = GitAccountRefSchema.nullable()

function accountOf(value: unknown): GitAccountRef | null {
  return AccountSchema.parse(value ?? null)
}

/** The account a host's API is called as, checked: one of `listAccounts`', naming nothing more. */
function requiredAccountOf(value: unknown): GitAccountRef {
  const checked = GitAccountRefSchema.safeParse(value)
  if (!checked.success) throw new Error("That is not an account APIWeave can sign in as.")
  return checked.data
}

/** Which repositories to list, checked: two true-or-false values, said plainly when they are not. */
function listRequestOf(value: unknown): GitRepositoryListRequest {
  const checked = GitRepositoryListRequestSchema.safeParse(value)
  if (!checked.success) throw new Error("That is not a repository list APIWeave can read: `tagged` and `emptyOnly` are two true-or-false values.")
  return checked.data
}

/** A repository to create, checked; a plain sentence for the dialog when it is not one, never a zod error's JSON. */
function createRepositoryRequestOf(value: unknown): GitCreateRepositoryRequest {
  const checked = GitCreateRepositoryRequestSchema.safeParse(value)
  if (!checked.success) throw new Error(`That is not a repository APIWeave can create: ${checked.error.issues[0]?.message ?? "invalid"}.`)
  return checked.data
}


const MergePickPlace = {
  // A file conflict names its path, which may run to 4096 characters.
  recordId: z.string().min(1).max(4096),
  path: z.string().max(4096),
}

const MergePickSchema = z.union([
  z.object({ ...MergePickPlace, side: z.enum(["ours", "theirs"]) }).strict(),
  z.object({ ...MergePickPlace, value: JsonValueSchema }).strict(),
])

/** A resolution's picks, checked: each names one record or file (by id or path), one path in it, and either the copy that settles it or a value of the user's own. */
const MergePicksSchema = z.array(MergePickSchema).max(10_000)

/** The renderer's picks, checked, or a plain sentence: never a zod error's JSON. */
function mergePicksOf(value: unknown): readonly GitMergePick[] {
  const checked = MergePicksSchema.safeParse(value)
  if (!checked.success) {
    throw new Error(
      "That is not a merge decision APIWeave can read: each decision names a record, a path in it, and either the copy to keep or a value of your own.",
    )
  }
  return checked.data
}

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
 * that account can write, and one that could create repositories could
 * publish a workspace.
 */
export function registerGitHandlers(
  ipcMain: IpcMain,
  guard: TrustedSenderGuard,
  gitSync: GitSyncService,
  hostCli: HostCliService,
  signInPorts: GitSignInPorts,
): GitSignIns {
  const handleWorkspace = (channel: string, call: (workspaceId: string) => Promise<unknown>): void => {
    ipcMain.handle(channel, guard((workspaceId: unknown) => call(workspaceIdOf(workspaceId))))
  }
  handleWorkspace(GIT_CHANNELS.status, (workspaceId) => gitSync.status(workspaceId))
  ipcMain.handle(GIT_CHANNELS.statusAll, guard(() => gitSync.statusAll()))
  handleWorkspace(GIT_CHANNELS.track, (workspaceId) => trackOrAskForAuthor(gitSync, workspaceId))
  handleWorkspace(GIT_CHANNELS.untrack, (workspaceId) => gitSync.untrack(workspaceId))
  handleWorkspace(GIT_CHANNELS.pendingChanges, (workspaceId) => gitSync.pendingChanges(workspaceId))
  handleWorkspace(GIT_CHANNELS.mergeConflicts, (workspaceId) => gitSync.mergeConflicts(workspaceId))
  handleWorkspace(GIT_CHANNELS.mergePicks, (workspaceId) => gitSync.mergePicks(workspaceId))
  handleWorkspace(GIT_CHANNELS.mergeNotes, (workspaceId) => gitSync.mergeNotes(workspaceId))
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
      gitSync.resolveMerge(workspaceIdOf(workspaceId), mergePicksOf(picks), commitRequestOf(request)),
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
    guard((workspaceId: unknown, url: unknown, account: unknown) =>
      gitSync.connectRemote(workspaceIdOf(workspaceId), RemoteUrlSchema.parse(url), accountOf(account)),
    ),
  )
  ipcMain.handle(
    GIT_CHANNELS.setAccount,
    guard((workspaceId: unknown, account: unknown) => gitSync.setAccount(workspaceIdOf(workspaceId), accountOf(account))),
  )
  ipcMain.handle(
    GIT_CHANNELS.openFromGit,
    guard((url: unknown, account: unknown) => gitSync.openFromGit(RemoteUrlSchema.parse(url), accountOf(account))),
  )
  ipcMain.handle(GIT_CHANNELS.listAccounts, guard(() => hostCli.listAccounts()))
  const signIns = new GitSignIns(hostCli, signInPorts)
  ipcMain.handle(
    GIT_CHANNELS.signIn,
    guard((provider: unknown, host: unknown) => {
      const checkedProvider = GitAccountRefSchema.shape.provider.safeParse(provider)
      if (!checkedProvider.success) throw new Error("APIWeave signs in to GitHub or GitLab only.")
      const checkedHost = GitHostSchema.safeParse(host)
      if (!checkedHost.success) throw new Error("That is not a host name APIWeave can sign in to, such as github.com or gitlab.example.com.")
      return signIns.signIn(checkedProvider.data, checkedHost.data)
    }),
  )
  ipcMain.handle(GIT_CHANNELS.cancelSignIn, guard(() => signIns.cancel()))
  ipcMain.handle(GIT_CHANNELS.openSignInPage, guard(() => signIns.openPage()))
  ipcMain.handle(GIT_CHANNELS.listOwners, guard((account: unknown) => hostCli.listOwners(requiredAccountOf(account))))
  ipcMain.handle(
    GIT_CHANNELS.createRepository,
    guard((account: unknown, request: unknown) =>
      hostCli.createRepository(requiredAccountOf(account), createRepositoryRequestOf(request)),
    ),
  )
  ipcMain.handle(
    GIT_CHANNELS.listRepositories,
    guard((account: unknown, request: unknown) => hostCli.listRepositories(requiredAccountOf(account), listRequestOf(request))),
  )
  return signIns
}

/**
 * A sign-in's dialog lives in the window's document. Once the document goes
 * — a reload, a crash — nothing can show its code or cancel it, so `cancel`
 * is called and its gh or glab stopped rather than left waiting for a code
 * nobody sees. A navigation within the document (a hash or history change)
 * or in a sub-frame leaves the dialog where it is, and the sign-in running.
 */
export function cancelSignInWhenDocumentGoes(contents: Pick<WebContents, "on">, cancel: () => void): void {
  contents.on("render-process-gone", () => cancel())
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) cancel()
  })
}

/** What a sign-in needs from the composition root. */
export interface GitSignInPorts {
  /** Opens a page in the user's browser (`shell.openExternal`). */
  readonly openExternal: (url: string) => Promise<void>
  /** Shows the code to the renderer (`GIT_SIGN_IN_PROMPT_CHANNEL`). */
  readonly showPrompt: (prompt: GitSignInPrompt) => void
  /** Brings the app back to the front once the browser part is done. */
  readonly focus: () => void
}

/** One sign-in's tool: how to stop it, the page it printed, and when it has ended. */
interface SignInSession {
  readonly controller: AbortController
  url: string | null
  settled: Promise<void>
}

/**
 * The one sign-in that may run at a time. Main opens the page the tool
 * printed, and is the only one that can: "Open browser again" asks main to
 * reopen the page it holds, so no URL from the renderer ever reaches
 * `openExternal`. {@link cancel} kills the tool's process tree, as do a new
 * sign-in, the window reloading or its renderer dying, and quitting the app.
 */
export class GitSignIns {
  private current: SignInSession | undefined

  public constructor(
    private readonly hostCli: HostCliService,
    private readonly ports: GitSignInPorts,
  ) {}

  /**
   * A new sign-in replaces one still waiting: only the app's own window can
   * ask, so the one waiting belongs to a dialog that is gone — a reload, a
   * crash — and would otherwise hold the tool, and lock out every new
   * attempt, until its code expired.
   */
  public signIn(provider: GitProvider, host: string): Promise<GitAccountRef> {
    // Current at once, before the one it replaces has gone: a Cancel pressed
    // while that tool is still exiting is for this sign-in, and must stop it
    // before its own tool ever starts.
    const previous = this.current
    const session: SignInSession = { controller: new AbortController(), url: null, settled: Promise.resolve() }
    this.current = session
    const running = this.replaceAndRun(session, previous, provider, host)
    session.settled = running.then(
      () => undefined,
      () => undefined,
    )
    return running.finally(() => {
      if (this.current === session) this.current = undefined
    })
  }

  private async replaceAndRun(session: SignInSession, previous: SignInSession | undefined, provider: GitProvider, host: string): Promise<GitAccountRef> {
    if (previous !== undefined) {
      previous.controller.abort()
      await previous.settled
    }
    if (session.controller.signal.aborted) throw new Error("Sign-in was cancelled.")
    const account = await this.hostCli.signIn(provider, host, {
      signal: session.controller.signal,
      onPrompt: ({ code, url }) => {
        session.url = url
        this.ports.showPrompt({ provider, host, code, url })
        this.openQuietly(url)
      },
    })
    this.ports.focus()
    return account
  }

  /** Stop the sign-in in progress, if any — its `signIn` rejects as cancelled — and resolve once its tool has gone. */
  public async cancel(): Promise<void> {
    const session = this.current
    if (session === undefined) return
    session.controller.abort()
    await session.settled
  }

  /** Open the page of the sign-in in progress again, once the tool has printed one. */
  public openPage(): void {
    const url = this.current?.url ?? null
    if (url !== null) this.openQuietly(url)
  }

  /** A browser that does not open is not a failed sign-in: the dialog shows the page to open by hand. */
  private openQuietly(url: string): void {
    void this.ports.openExternal(url).catch((error: unknown) => log.warn("could not open the sign-in page in the browser", error))
  }
}
