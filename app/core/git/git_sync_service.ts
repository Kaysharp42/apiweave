import { randomUUID } from "node:crypto"
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { OpenWorkspaceFromGitResult } from "@shared/types/OpenWorkspaceFromGitResult"
import type { WorkflowChangedEvent } from "@shared/types/WorkflowChangedEvent"
import type { WorkspaceGitCommit } from "@shared/types/WorkspaceGitCommit"
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest"
import type { WorkspaceGitError } from "@shared/types/WorkspaceGitError"
import type { WorkspaceGitMode } from "@shared/types/WorkspaceGitMode"
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus"
import { ConflictError, NotFoundError, ValidationError } from "../ipc/errors"
import { getLogger } from "../logging/logger"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowRepository,
  WorkspaceGitBinding,
  WorkspaceGitRepository,
  WorkspaceRepository,
} from "../repositories"
import {
  RecordIdSchema,
  parseWorkspace,
  serializeWorkspace,
  workspaceSnapshot,
  type WorkspaceRecords,
} from "../services/workspace_repo_format"
import { WorkspaceRepoImporter } from "../services/workspace_repo_import"
import { uniqueWorkspaceSlug } from "../services/workspace_service"
import { assertWorkspaceRemoteUrl } from "./git_arguments"
import {
  GitError,
  GitIdentityMissingError,
  GitNotARepositoryError,
  isCheckedOutBranchRefusal,
  isNoSuchRemote,
} from "./git_errors"
import { awaitWithin } from "./git_process"
import type { GitService } from "./git_service"
import type { GitStatusEntry } from "./git_types"
import { moveIntoPlace } from "./move_into_place"
import { readWorkspaceTree, writeWorkspaceTree } from "./workspace_tree"

/** How long auto mode waits after the last edit before it commits: one commit per burst of edits. */
export const AUTO_COMMIT_DELAY_MS = 30_000

/** How long {@link GitSyncService.dispose} waits for an open in progress before letting the app quit; the next startup's reconcile removes what it left behind. */
export const DISPOSE_WAIT_MS = 5_000

const TRACK_MESSAGE = "Start tracking this workspace in APIWeave"
const RECREATE_MESSAGE = "Recreate this workspace's repository from APIWeave"

/** The one remote a workspace's repository has. */
const ORIGIN = "origin"

const TRACK_FIRST_MESSAGE = "Track this workspace's version history before connecting a remote."
const ALREADY_CONNECTED_MESSAGE = "This workspace is already connected to a remote. Disconnect it first."
const UNRELATED_HISTORY_MESSAGE =
  "That repository already has history this workspace did not come from. Open a workspace from git instead."

const NO_COMMIT_MESSAGE = "Commit the workspace once before connecting a remote."
const NOTHING_TO_DISCONNECT_MESSAGE = "This workspace has no version history, so it has no remote to disconnect."
const WORKING_COPY_MESSAGE =
  "That repository is a working copy, not a bare repository, so git cannot push to its checked-out branch. " +
  "Create a bare or empty repository on your host and connect to that."

/**
 * A scratch clone of an open in progress is `<cloneRoot>/.open-<random>`. No
 * workspace id can start with a `.`, so the prefix is the app's alone. Before
 * it moves to `<cloneRoot>/<id>` the clone gets {@link OPEN_MARKER}, which goes
 * once the workspace's rows are committed. So a crash mid-open leaves only
 * directories that {@link GitSyncService.reconcile} can recognise and remove:
 * a scratch clone, or a clone no row claims that carries the marker.
 */
const OPEN_SCRATCH_PREFIX = ".open-"

/** Inside `.git`, where no checkout or commit can put or remove it: `<cloneRoot>/<id>` is an open that has not finished. */
const OPEN_MARKER = "apiweave-open"

const DISPOSING_MESSAGE = "APIWeave is closing, so the workspace was not opened. Open it again after the next start."

const NO_BRANCH_MESSAGE = "The repository has no branch checked out."
const DEFAULT_BRANCH_EMPTY_MESSAGE =
  "That repository has branches, but its default branch has nothing to check out, and only the default branch is opened. " +
  "Set the repository's default branch to the one that holds the workspace."

const log = getLogger("git-sync")

/** The part of {@link GitService} the sync service drives; a test can wrap it. */
export type GitSyncGit = Pick<
  GitService,
  | "init"
  | "clone"
  | "setIdentity"
  | "add"
  | "status"
  | "commit"
  | "log"
  | "fetch"
  | "push"
  | "remoteAdd"
  | "remoteSetUrl"
  | "remoteRemove"
  | "revParse"
  | "mergeBase"
  | "firstRemoteRef"
>

export interface GitSyncRepositories {
  readonly workspaces: WorkspaceRepository
  readonly collections: CollectionRepository
  readonly workflows: WorkflowRepository
  readonly environments: EnvironmentRepository
  readonly workspaceGit: WorkspaceGitRepository
}

export interface GitSyncServiceOptions {
  /** Each tracked workspace's repository is `<cloneRoot>/<workspaceId>`; only this service writes there. */
  readonly cloneRoot: string
  readonly git: GitSyncGit
  readonly repositories: GitSyncRepositories
  /** Defaults to {@link AUTO_COMMIT_DELAY_MS}. */
  readonly autoCommitDelayMs?: number
  /** Defaults to {@link DISPOSE_WAIT_MS}; how long {@link GitSyncService.dispose} waits for an open in progress. */
  readonly disposeWaitMs?: number
  /** Told every status a call or an auto commit leaves behind. Must not throw. */
  readonly onStatusChanged?: (status: WorkspaceGitStatus) => void
}

/**
 * A workspace's history as commits in a git repository the app owns. The
 * database stays the truth: a commit serializes the workspace
 * (`workspaceSnapshot` → `serializeWorkspace`), writes the changed files into
 * the clone, and commits whatever git then sees — so a write that leaves the
 * tree as it was (an import of what is already committed, a run count) makes
 * no commit.
 *
 * Everything that touches one workspace's repository runs behind that
 * workspace's lock, in call order: a commit, a track and an untrack never
 * interleave, and a second call waits for the first rather than racing it.
 *
 * In auto mode, a write the repositories announce (`workspaceChanged`,
 * `workflowChanged`) starts a {@link AUTO_COMMIT_DELAY_MS} timer, and every
 * further write restarts it. The repositories announce only committed writes,
 * so a rolled-back transaction schedules nothing.
 */
export class GitSyncService {
  private readonly repositories: GitSyncRepositories
  private readonly git: GitSyncGit
  private readonly delayMs: number
  private readonly disposeWaitMs: number
  private readonly locks = new Map<string, Promise<void>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Opens run one at a time: the end of the chain, which never rejects. */
  private openQueue: Promise<void> = Promise.resolve()
  private disposed = false

  public constructor(private readonly options: GitSyncServiceOptions) {
    this.repositories = options.repositories
    this.git = options.git
    this.delayMs = options.autoCommitDelayMs ?? AUTO_COMMIT_DELAY_MS
    this.disposeWaitMs = options.disposeWaitMs ?? DISPOSE_WAIT_MS
  }

  public async status(workspaceId: string): Promise<WorkspaceGitStatus> {
    const binding = this.repositories.workspaceGit.get(workspaceId)
    if (binding === undefined) {
      return {
        workspaceId,
        tracked: false,
        mode: "auto",
        remoteUrl: null,
        branch: "main",
        state: "idle",
        lastError: null,
        lastCommit: null,
      }
    }
    return {
      workspaceId,
      tracked: true,
      mode: binding.mode,
      remoteUrl: binding.remoteUrl,
      branch: binding.branch,
      state: binding.state,
      lastError: binding.lastError,
      lastCommit: await this.lastCommit(this.cloneDir(workspaceId)),
    }
  }

  /**
   * Start keeping the workspace's history, holding it as it is now in a
   * commit. Tracking a tracked workspace changes nothing.
   *
   * A clone already in place is adopted, never replaced: it is what a database
   * restored from a backup that predates the `workspace_git` row leaves behind,
   * and it may hold the only copy of that history. A failure undoes only what
   * this call created — except a missing author: the workspace then stays
   * tracked, its status says `identity_missing`, and a commit that names an
   * author (`syncNow`) completes it.
   */
  public async track(workspaceId: string): Promise<WorkspaceGitStatus> {
    const directory = this.cloneDir(workspaceId)
    return this.exclusive(workspaceId, async () => {
      if (this.repositories.workspaceGit.get(workspaceId) !== undefined) return this.announce(workspaceId)
      if (this.repositories.workspaces.getById(workspaceId) === undefined) throw new NotFoundError(`workspace ${workspaceId} not found`)
      const createdDirectory = !(await exists(directory))
      const createdRepository = !(await isRepository(directory))
      // The row goes in first, so an edit made while the first commit is being
      // written schedules a commit of its own instead of going unnoticed.
      this.repositories.workspaceGit.insert(workspaceId, "auto")
      try {
        await this.commitCycle(workspaceId, directory, { message: TRACK_MESSAGE })
      } catch (error) {
        if (error instanceof GitIdentityMissingError) throw error
        this.repositories.workspaceGit.delete(workspaceId)
        if (createdDirectory) await removeDirectory(directory)
        else if (createdRepository) await removeDirectory(path.join(directory, ".git"))
        throw error
      }
      return this.announce(workspaceId)
    })
  }

  /**
   * Delete the workspace's repository and stop tracking it. The remote's own
   * copy is never touched, but this history is gone: tracking again starts a
   * new one, which a remote holding the old one no longer shares.
   */
  public async untrack(workspaceId: string): Promise<WorkspaceGitStatus> {
    const directory = this.cloneDir(workspaceId)
    this.cancelAutoCommit(workspaceId)
    return this.exclusive(workspaceId, async () => {
      await removeDirectory(directory)
      this.repositories.workspaceGit.delete(workspaceId)
      return this.announce(workspaceId)
    })
  }

  /**
   * Bind the workspace to the remote at `url`. A remote with no branch at all
   * receives this workspace's history; one whose history this workspace's
   * shares is joined as it is, and nothing is pushed — that is a later sync's.
   * A remote with other history, on this branch or another, is refused.
   * Re-pointing a connected workspace is a disconnect, then a connect.
   *
   * The clone's `origin` is this service's, and is built fresh: one an adopted
   * clone carries may have a `pushurl`, a fetch refspec or mirror settings
   * that would send the push somewhere other than `url`. Atomic: a failure
   * after that removes `origin` again, so the binding is as it was and the
   * clone has no remote, which is what an unbound workspace's clone has. A
   * rollback that fails cannot mask the error that caused it.
   *
   * `state` and `lastError` are not touched: they are about the last commit,
   * which connecting does not undo.
   */
  public async connectRemote(workspaceId: string, url: string): Promise<WorkspaceGitStatus> {
    const directory = this.cloneDir(workspaceId)
    return this.exclusive(workspaceId, async () => {
      const binding = this.trackedBinding(workspaceId)
      if (binding.remoteUrl !== null) throw new ConflictError(ALREADY_CONNECTED_MESSAGE)
      const remoteUrl = assertWorkspaceRemoteUrl(url)
      // A workspace tracked without an author has no commit yet: nothing to push or compare.
      if ((await this.git.revParse(directory, "HEAD")) === undefined) throw new ConflictError(NO_COMMIT_MESSAGE)
      await this.removeOrigin(directory)
      await this.git.remoteAdd(directory, ORIGIN, remoteUrl)
      try {
        await this.joinRemote(directory, binding.branch)
        this.repositories.workspaceGit.setRemote(workspaceId, remoteUrl, binding.branch)
      } catch (error) {
        await this.git.remoteRemove(directory, ORIGIN).catch((rollbackError: unknown) => {
          log.warn(`could not remove the remote a failed connect added for workspace ${workspaceId}`, rollbackError)
        })
        throw error
      }
      return this.announce(workspaceId)
    })
  }

  /** Remove the connection. Local history is never touched, nor is the remote's. Disconnecting an unconnected workspace changes nothing. */
  public async disconnectRemote(workspaceId: string): Promise<WorkspaceGitStatus> {
    const directory = this.cloneDir(workspaceId)
    return this.exclusive(workspaceId, async () => {
      const binding = this.repositories.workspaceGit.get(workspaceId)
      if (binding === undefined) throw new ConflictError(NOTHING_TO_DISCONNECT_MESSAGE)
      if (binding.remoteUrl === null) return this.status(workspaceId)
      try {
        await this.removeOrigin(directory)
      } catch (error) {
        // The goal is a clone with no `origin`; one that is gone is already there.
        if (!(error instanceof GitNotARepositoryError)) throw error
      }
      this.repositories.workspaceGit.clearRemote(workspaceId)
      return this.announce(workspaceId)
    })
  }

  /**
   * Clone the repository at `url` and open the workspace it holds: validated
   * and parsed in a scratch clone first, then moved to `<cloneRoot>/<id>`,
   * imported, and tracked in auto mode, bound to `url` and the branch the
   * clone is on. A workspace whose id is already here is not opened again:
   * that resolves `duplicate`, which is how the caller links to it. `opened`
   * carries the importer's warnings, for the caller to show before switching.
   *
   * A clone already at the id, or a workspace id that collides with one here
   * only in letter case, is refused before anything is moved: a clone no row
   * claims may hold commits that are not on the remote, and a case-variant id
   * would share one repository folder with the workspace already here. The
   * one clone at the id that is replaced is an earlier open's that never
   * finished, recognised by {@link OPEN_MARKER}: it holds only what was
   * downloaded. A failure leaves nothing behind but what a crash or a failed
   * removal can strand — a scratch clone or a marked one, both of which
   * {@link reconcile} removes; an unmarked clone this call did not create is
   * never removed.
   *
   * One open at a time. It is slow, rare and user-initiated, and the
   * duplicate check is not atomic with the insert, so two opens of one id
   * must not fight over one clone. No status is announced: the workspace is
   * new, and the caller reloads its list. An open that is still cloning when
   * the service is disposed gives up once the clone is done, and creates
   * nothing.
   */
  public openFromGit(url: string): Promise<OpenWorkspaceFromGitResult> {
    return this.inOpenQueue(() => this.openNow(url))
  }

  public async setMode(workspaceId: string, mode: WorkspaceGitMode): Promise<WorkspaceGitStatus> {
    if (!this.repositories.workspaceGit.setMode(workspaceId, mode)) throw notTracked(workspaceId)
    // Switching to auto picks up whatever manual mode left uncommitted.
    if (mode === "auto") this.scheduleAutoCommit(workspaceId)
    else this.cancelAutoCommit(workspaceId)
    return this.announce(workspaceId)
  }

  /**
   * Commit what changed; a local commit is the whole sync cycle. A missing
   * author is not thrown: it is the status's `lastError`, which is how the
   * caller learns to ask for one and pass it back here.
   */
  public async syncNow(workspaceId: string, request: WorkspaceGitCommitRequest = {}): Promise<WorkspaceGitStatus> {
    try {
      await this.commitLocal(workspaceId, request)
    } catch (error) {
      if (!(error instanceof GitIdentityMissingError)) throw error
    }
    return this.status(workspaceId)
  }

  /** The new commit's sha, or undefined when the workspace's tree already matches HEAD. Supersedes a pending auto commit. */
  public async commitLocal(workspaceId: string, request: WorkspaceGitCommitRequest = {}): Promise<string | undefined> {
    const directory = this.cloneDir(workspaceId)
    this.cancelAutoCommit(workspaceId)
    return this.exclusive(workspaceId, () => this.commitCycle(workspaceId, directory, request))
  }

  /** A repository write to the workspace committed. Wire to the Collection, Environment and Workspace repositories' `onChanged`. */
  public workspaceChanged(workspaceId: string): void {
    if (this.disposed) return
    if (this.repositories.workspaces.getById(workspaceId) === undefined) {
      this.forget(workspaceId)
      return
    }
    if (this.repositories.workspaceGit.get(workspaceId)?.mode === "auto") this.scheduleAutoCommit(workspaceId)
  }

  /** {@link workspaceChanged} for `WorkflowRepository`'s event: a move changes the workspace it left as well. */
  public workflowChanged(event: WorkflowChangedEvent): void {
    if (event.kind === "delete") {
      this.workspaceChanged(event.workspaceId)
      return
    }
    this.workspaceChanged(event.workflow.workspaceId)
    if (event.movedFrom !== undefined) this.workspaceChanged(event.movedFrom)
  }

  /**
   * At startup: recreate the repository of every tracked workspace whose clone
   * is gone, clear a lock a crash left in one, and commit what auto mode had
   * not committed when the app last quit. A workspace that fails keeps its
   * error in its status and does not stop the others.
   *
   * A clone no row claims is left exactly where it is. It is what restoring a
   * database from a backup that predates the row leaves behind, it may hold
   * the only copy of that history, and a later `track` adopts it. The one
   * exception is what an open that never finished leaves — a scratch clone,
   * or a clone that still carries {@link OPEN_MARKER} — which is the app's own
   * download and is removed.
   */
  public async reconcile(): Promise<void> {
    await this.inOpenQueue(() => this.sweepOpenScratch())
    const bindings = this.repositories.workspaceGit.listAll()
    const results = await Promise.allSettled(
      bindings.map((binding) => this.exclusive(binding.workspaceId, () => this.reconcileOne(binding))),
    )
    for (const result of results) {
      if (result.status === "rejected") log.warn("could not reconcile a workspace repository", result.reason)
    }
  }

  /** Resolves once no call is running or queued for any workspace. */
  public async settled(): Promise<void> {
    await this.openQueue
    await this.locksSettled()
  }

  /**
   * Stop auto commits and wait for what is running. An open is waited for at
   * most {@link DISPOSE_WAIT_MS}: one still cloning can take minutes, and
   * gives up by itself once the clone is done. What auto mode had pending is
   * committed by the next {@link reconcile}.
   */
  public async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await Promise.all([awaitWithin(this.openQueue, this.disposeWaitMs), this.locksSettled()])
  }

  private async locksSettled(): Promise<void> {
    while (this.locks.size > 0) await Promise.all(this.locks.values())
  }

  private inOpenQueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.openQueue.then(work)
    this.openQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async openNow(url: string): Promise<OpenWorkspaceFromGitResult> {
    const remoteUrl = assertWorkspaceRemoteUrl(url)
    // The scratch clone lives under the clone root so that moving it into place stays on one volume.
    await mkdir(this.options.cloneRoot, { recursive: true })
    const scratch = path.join(this.options.cloneRoot, `${OPEN_SCRATCH_PREFIX}${randomUUID()}`)
    try {
      return await this.openFromScratch(remoteUrl, scratch)
    } finally {
      // Gone already when the clone was moved into place. A scratch clone that
      // will not go is the startup sweep's, and must not hide how the open ended.
      await removeDirectory(scratch).catch((cleanupError: unknown) => {
        log.warn("could not remove the scratch clone of an open", cleanupError)
      })
    }
  }

  private async openFromScratch(remoteUrl: string, scratch: string): Promise<OpenWorkspaceFromGitResult> {
    const { workspaces, collections, workflows, environments, workspaceGit } = this.repositories
    await this.git.clone(remoteUrl, scratch)
    this.assertNotDisposed()
    await this.assertCheckedOut(scratch)
    const snapshot = parseWorkspace(await readWorkspaceTree(scratch))
    const workspaceId = snapshot.workspace.workspaceId
    const existing = workspaces.getById(workspaceId)
    if (existing !== undefined) return { kind: "duplicate", workspaceId, slug: existing.slug, name: existing.name }
    this.assertNoCaseVariantWorkspace(workspaceId)
    // The binding needs a branch to name, and a detached HEAD has none.
    const branch = (await this.git.status(scratch)).branch
    if (branch === undefined) throw new ValidationError(NO_BRANCH_MESSAGE)

    const directory = this.cloneDir(workspaceId)
    if (workspaceGit.get(workspaceId) !== undefined) {
      throw new ConflictError(`The database holds version history for workspace ${workspaceId} but not the workspace itself; refusing to replace its repository.`)
    }
    if (await exists(directory)) {
      // No workspace row claims it, so unless it is marked it is not this
      // open's to replace: it may be a database restored from a backup that
      // predates the row, holding the only copy of that history. Refuse
      // before touching it.
      if (!(await exists(openMarker(directory)))) {
        throw new ConflictError(
          `A repository is already at ${directory} for workspace ${workspaceId}, and no workspace in this app claims it. ` +
            "It may hold commits that are not on the remote, so it was left alone. " +
            "Restore the workspace it belongs to, or move that folder away and try again.",
        )
      }
      // An earlier open of this id that never finished: nothing in it but what was downloaded.
      await removeDirectory(directory)
    }
    // Marked before it moves, so that from the moment it is at the id until its rows are committed it is recognisably an unfinished open.
    await writeFile(openMarker(scratch), "")
    let movedIntoPlace = false
    try {
      await moveIntoPlace(scratch, directory)
      movedIntoPlace = true
      const name = snapshot.workspace.name
      const slug = uniqueWorkspaceSlug(workspaces, name)
      let warnings: readonly string[] = []
      // Checked again with no await before the transaction: once dispose has returned, the database may be closing.
      this.assertNotDisposed()
      workspaces.transaction(() => {
        workspaces.create({ workspaceId, name, description: snapshot.workspace.description, slug, isPersonal: false })
        warnings = new WorkspaceRepoImporter(workspaces, collections, workflows, environments).apply(workspaceId, snapshot)
        workspaceGit.insert(workspaceId, "auto")
        workspaceGit.setRemote(workspaceId, remoteUrl, branch)
      })
      // The rows claim the clone now; a marker that will not go is removed by the next reconcile.
      await rm(openMarker(directory), { force: true }).catch((cleanupError: unknown) => {
        log.warn(`could not remove the open marker from the clone of workspace ${workspaceId}`, cleanupError)
      })
      return { kind: "opened", workspaceId, slug, name, warnings }
    } catch (error) {
      // Only the clone this call moved into place: another writer may have won the id in the meantime.
      if (movedIntoPlace) {
        await removeDirectory(directory).catch((cleanupError: unknown) => {
          log.warn(`could not remove the clone of workspace ${workspaceId} after a failed open`, cleanupError)
        })
      }
      throw error
    }
  }

  /**
   * Refuse a repository whose workspace id equals one that is already here
   * ignoring case. SQLite compares ids exactly, but `cloneDir` does not on
   * Windows and default macOS, so the two would share one repository folder.
   */
  private assertNoCaseVariantWorkspace(workspaceId: string): void {
    const lowered = workspaceId.toLowerCase()
    const twin = this.repositories.workspaces
      .listAll()
      .find((workspace) => workspace.workspaceId !== workspaceId && workspace.workspaceId.toLowerCase() === lowered)
    if (twin === undefined) return
    throw new ConflictError(
      `Workspace ${twin.workspaceId} is already here and differs from ${workspaceId} only in letter case, ` +
        "so the two would share one repository folder on this computer. " +
        "Rename the workspace in the repository, or open it in the workspace that is already here instead.",
    )
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error(DISPOSING_MESSAGE)
  }

  /** A clone of a repository with branches whose default branch is not one of them has no files: say so, rather than that the repository is not a workspace. */
  private async assertCheckedOut(directory: string): Promise<void> {
    if ((await this.git.revParse(directory, "HEAD")) !== undefined) return
    if ((await this.git.firstRemoteRef(directory, ORIGIN)) !== undefined) throw new ValidationError(DEFAULT_BRANCH_EMPTY_MESSAGE)
  }

  /**
   * What an open that crashed left: a scratch clone no open is using, or a
   * marked clone no row claims. Never throws, like the rest of {@link reconcile}.
   */
  private async sweepOpenScratch(): Promise<void> {
    try {
      const names = await readdir(this.options.cloneRoot).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
        throw error
      })
      const unfinished = await Promise.all(names.map(async (name) => ((await this.isUnfinishedOpen(name)) ? [name] : [])))
      await Promise.all(unfinished.flat().map((name) => removeDirectory(path.join(this.options.cloneRoot, name))))
    } catch (error) {
      log.warn("could not remove the clones of unfinished opens", error)
    }
  }

  private async isUnfinishedOpen(name: string): Promise<boolean> {
    if (name.startsWith(OPEN_SCRATCH_PREFIX)) return true
    if (!RecordIdSchema.safeParse(name).success || this.repositories.workspaceGit.get(name) !== undefined) return false
    return exists(openMarker(path.join(this.options.cloneRoot, name)))
  }

  private async reconcileOne(binding: WorkspaceGitBinding): Promise<void> {
    const directory = this.cloneDir(binding.workspaceId)
    const missing = !(await isRepository(directory))
    if (!missing) {
      // Safe here and nowhere else. Every git command on this clone is this
      // service's, run behind this workspace's lock — which this holds — and
      // none has run on it yet in this process; the single-instance lock rules
      // out a second app. So a lock file now was left by a git process that
      // died with the app, and would refuse every later commit until someone
      // found and deleted it by hand.
      await rm(path.join(directory, ".git", "index.lock"), { force: true })
      // The row claims this clone, so a marker an open left on it is stale, and must not later get the clone swept.
      await rm(openMarker(directory), { force: true })
    }
    if (missing || binding.mode === "auto") {
      await this.commitCycle(binding.workspaceId, directory, missing ? { message: RECREATE_MESSAGE } : {})
    } else if (binding.state === "syncing") {
      // The app quit, or crashed, in the middle of a cycle.
      this.repositories.workspaceGit.setState(binding.workspaceId, "idle")
    }
    // The row is the truth about the remote: a clone that was recreated or adopted gets it back. Local git only, no network.
    if (binding.remoteUrl !== null) await this.pointOriginAt(directory, binding.remoteUrl)
  }

  /** The workspace's binding, or the refusal a remote operation on an untracked workspace gets. */
  private trackedBinding(workspaceId: string): WorkspaceGitBinding {
    const binding = this.repositories.workspaceGit.get(workspaceId)
    if (binding === undefined) throw new ConflictError(TRACK_FIRST_MESSAGE)
    return binding
  }

  /**
   * `origin` at `url`, whether or not the clone has an `origin` yet. Only for
   * a URL that is already the row's own (reconcile): a connect starts from no
   * `origin`, because what else an old one carries is not the row's.
   */
  private async pointOriginAt(directory: string, url: string): Promise<void> {
    try {
      await this.git.remoteSetUrl(directory, ORIGIN, url)
    } catch (error) {
      if (!isNoSuchRemote(error)) throw error
      await this.git.remoteAdd(directory, ORIGIN, url)
    }
  }

  /** The clone with no `origin`: one that has none is already there. */
  private async removeOrigin(directory: string): Promise<void> {
    try {
      await this.git.remoteRemove(directory, ORIGIN)
    } catch (error) {
      if (!isNoSuchRemote(error)) throw error
    }
  }

  /**
   * Fetch the remote and settle how this workspace relates to it. A remote
   * with no branch at all is pushed to, shared history is left alone, and
   * anything else throws: a remote with branches but not this one holds
   * someone else's project, which an empty-looking `origin/<branch>` must not
   * hide.
   */
  private async joinRemote(directory: string, branch: string): Promise<void> {
    await this.git.fetch(directory, ORIGIN)
    const remoteBranch = `${ORIGIN}/${branch}`
    if ((await this.git.revParse(directory, remoteBranch)) === undefined) {
      if ((await this.git.firstRemoteRef(directory, ORIGIN)) !== undefined) throw new ConflictError(UNRELATED_HISTORY_MESSAGE)
      await this.pushFirstTime(directory, branch)
    } else if ((await this.git.mergeBase(directory, "HEAD", remoteBranch)) === undefined) {
      throw new ConflictError(UNRELATED_HISTORY_MESSAGE)
    }
  }

  private async pushFirstTime(directory: string, branch: string): Promise<void> {
    try {
      await this.git.push(directory, ORIGIN, branch, { setUpstream: true })
    } catch (error) {
      // An empty non-bare repository looks empty to a fetch and then refuses the push; the original error is git's own wording of it.
      if (isCheckedOutBranchRefusal(error)) throw new ConflictError(WORKING_COPY_MESSAGE)
      throw error
    }
  }

  /** One cycle: (re)create the repository if it is gone, write the tree, commit. Its outcome is the workspace's state. */
  private async commitCycle(
    workspaceId: string,
    directory: string,
    request: WorkspaceGitCommitRequest = {},
  ): Promise<string | undefined> {
    const binding = this.repositories.workspaceGit.get(workspaceId)
    if (binding === undefined) throw notTracked(workspaceId)
    this.repositories.workspaceGit.setState(workspaceId, "syncing")
    await this.announce(workspaceId)
    try {
      if (!(await isRepository(directory))) await this.git.init(directory, { initialBranch: binding.branch })
      if (request.identity !== undefined) await this.git.setIdentity(directory, request.identity)
      const sha = await this.writeAndCommit(workspaceId, directory, request.message)
      this.repositories.workspaceGit.setState(workspaceId, "idle")
      return sha
    } catch (error) {
      this.repositories.workspaceGit.setState(workspaceId, "error", describeError(error))
      throw error
    } finally {
      await this.announce(workspaceId)
    }
  }

  /** Serialize the workspace into its clone and commit what changed; undefined when nothing did. */
  private async writeAndCommit(workspaceId: string, directory: string, message?: string): Promise<string | undefined> {
    // Read and serialized synchronously, so the commit holds one consistent state of the database.
    const files = serializeWorkspace(workspaceSnapshot(this.records(workspaceId)))
    await writeWorkspaceTree(directory, files)
    await this.git.add(directory, ["."])
    const { entries } = await this.git.status(directory)
    if (entries.length === 0) return undefined
    const subject = message?.trim() ?? ""
    return this.git.commit(directory, subject === "" ? describeChanges(entries) : subject)
  }

  private records(workspaceId: string): WorkspaceRecords {
    const { workspaces, collections, workflows, environments } = this.repositories
    const workspace = workspaces.getById(workspaceId)
    if (workspace === undefined) throw new NotFoundError(`workspace ${workspaceId} not found`)
    return {
      workspace,
      projects: collections.listByWorkspace(workspaceId).items,
      workflows: workflows.listByWorkspace(workspaceId, true).items,
      environments: environments.listByWorkspace(workspaceId).items,
    }
  }

  private scheduleAutoCommit(workspaceId: string): void {
    this.cancelAutoCommit(workspaceId)
    this.timers.set(workspaceId, setTimeout(() => {
      this.timers.delete(workspaceId)
      void this.autoCommit(workspaceId)
    }, this.delayMs))
  }

  private cancelAutoCommit(workspaceId: string): void {
    const timer = this.timers.get(workspaceId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.timers.delete(workspaceId)
  }

  /** The timer's commit. Its failure is already the workspace's `lastError`; there is no caller to throw to. */
  private async autoCommit(workspaceId: string): Promise<void> {
    try {
      await this.exclusive(workspaceId, async () => {
        // The mode can have changed, or the workspace been untracked, while this waited for the lock.
        if (this.disposed || this.repositories.workspaceGit.get(workspaceId)?.mode !== "auto") return
        await this.commitCycle(workspaceId, this.cloneDir(workspaceId))
      })
    } catch (error) {
      log.warn(`auto commit failed for workspace ${workspaceId}`, error)
    }
  }

  /** The workspace was deleted: its row went with it (ON DELETE CASCADE), and its clone goes now. */
  private forget(workspaceId: string): void {
    this.cancelAutoCommit(workspaceId)
    if (!RecordIdSchema.safeParse(workspaceId).success) return
    const directory = this.cloneDir(workspaceId)
    void this.exclusive(workspaceId, () => removeDirectory(directory)).catch((error: unknown) => {
      log.warn(`could not delete the repository of deleted workspace ${workspaceId}`, error)
    })
  }

  private async lastCommit(directory: string): Promise<WorkspaceGitCommit | null> {
    try {
      const [head] = await this.git.log(directory, { maxCount: 1 })
      return head === undefined ? null : { sha: head.sha, subject: head.subject, authorDate: head.authorDate }
    } catch (error) {
      // A status is a report, not an operation: a missing clone or git is the next cycle's error to record.
      if (error instanceof GitError) return null
      throw error
    }
  }

  private async announce(workspaceId: string): Promise<WorkspaceGitStatus> {
    const status = await this.status(workspaceId)
    try {
      this.options.onStatusChanged?.(status)
    } catch (error) {
      log.error("status observer failed for workspace", workspaceId, error)
    }
    return status
  }

  /** Run `work` after everything already queued for the workspace, and before anything queued after it. */
  private exclusive<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(workspaceId) ?? Promise.resolve()
    const result = previous.then(work)
    const tail = result.then(() => undefined, () => undefined)
    this.locks.set(workspaceId, tail)
    void tail.then(() => {
      if (this.locks.get(workspaceId) === tail) this.locks.delete(workspaceId)
    })
    return result
  }

  /** The workspace's clone. The id becomes a path, so it must be an id and nothing path-like. */
  private cloneDir(workspaceId: string): string {
    if (!RecordIdSchema.safeParse(workspaceId).success) throw new ValidationError(`'${workspaceId}' is not a workspace id`)
    return path.join(this.options.cloneRoot, workspaceId)
  }
}

function notTracked(workspaceId: string): NotFoundError {
  return new NotFoundError(`workspace ${workspaceId} has no version history; track it first`)
}

function openMarker(directory: string): string {
  return path.join(directory, ".git", OPEN_MARKER)
}

async function isRepository(directory: string): Promise<boolean> {
  try {
    return (await stat(path.join(directory, ".git"))).isDirectory()
  } catch {
    return false
  }
}

/** git marks its objects read-only, and Windows can briefly hold a file git just closed: `rm` handles the first and retries the second. */
function removeDirectory(directory: string): Promise<void> {
  return rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

/** The subject an auto commit gets: the one file it changed, or how many. */
function describeChanges(entries: readonly GitStatusEntry[]): string {
  const [only] = entries
  return entries.length === 1 && only !== undefined ? `Update ${only.path}` : `Update ${entries.length} files`
}

function describeError(error: unknown): WorkspaceGitError {
  return {
    code: error instanceof GitError ? error.code : null,
    message: error instanceof Error ? error.message : String(error),
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}
