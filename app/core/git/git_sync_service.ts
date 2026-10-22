import { rm, stat } from "node:fs/promises"
import path from "node:path"
import type { WorkflowChangedEvent } from "@shared/types/WorkflowChangedEvent"
import type { WorkspaceGitCommit } from "@shared/types/WorkspaceGitCommit"
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest"
import type { WorkspaceGitError } from "@shared/types/WorkspaceGitError"
import type { WorkspaceGitMode } from "@shared/types/WorkspaceGitMode"
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus"
import { NotFoundError, ValidationError } from "../ipc/errors"
import { getLogger } from "../logging/logger"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowRepository,
  WorkspaceGitBinding,
  WorkspaceGitRepository,
  WorkspaceRepository,
} from "../repositories"
import { RecordIdSchema, serializeWorkspace, workspaceSnapshot, type WorkspaceRecords } from "../services/workspace_repo_format"
import { GitError, GitIdentityMissingError } from "./git_errors"
import type { GitService } from "./git_service"
import type { GitStatusEntry } from "./git_types"
import { writeWorkspaceTree } from "./workspace_tree"

/** How long auto mode waits after the last edit before it commits: one commit per burst of edits. */
export const AUTO_COMMIT_DELAY_MS = 30_000

const TRACK_MESSAGE = "Start tracking this workspace in APIWeave"
const RECREATE_MESSAGE = "Recreate this workspace's repository from APIWeave"

const log = getLogger("git-sync")

/** The part of {@link GitService} the sync service drives; a test can wrap it. */
export type GitSyncGit = Pick<GitService, "init" | "setIdentity" | "add" | "status" | "commit" | "log">

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
  private readonly locks = new Map<string, Promise<void>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false

  public constructor(private readonly options: GitSyncServiceOptions) {
    this.repositories = options.repositories
    this.git = options.git
    this.delayMs = options.autoCommitDelayMs ?? AUTO_COMMIT_DELAY_MS
  }

  public async status(workspaceId: string): Promise<WorkspaceGitStatus> {
    const binding = this.repositories.workspaceGit.get(workspaceId)
    if (binding === undefined) {
      return { workspaceId, tracked: false, mode: "auto", state: "idle", lastError: null, lastCommit: null }
    }
    return {
      workspaceId,
      tracked: true,
      mode: binding.mode,
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

  /** Delete the workspace's repository and stop tracking it. A remote, once there is one, is never touched. */
  public async untrack(workspaceId: string): Promise<WorkspaceGitStatus> {
    const directory = this.cloneDir(workspaceId)
    this.cancelAutoCommit(workspaceId)
    return this.exclusive(workspaceId, async () => {
      await removeDirectory(directory)
      this.repositories.workspaceGit.delete(workspaceId)
      return this.announce(workspaceId)
    })
  }

  public async setMode(workspaceId: string, mode: WorkspaceGitMode): Promise<WorkspaceGitStatus> {
    if (!this.repositories.workspaceGit.setMode(workspaceId, mode)) throw notTracked(workspaceId)
    // Switching to auto picks up whatever manual mode left uncommitted.
    if (mode === "auto") this.scheduleAutoCommit(workspaceId)
    else this.cancelAutoCommit(workspaceId)
    return this.announce(workspaceId)
  }

  /**
   * Commit what changed; with no remote bound, a local commit is the whole
   * sync cycle. A missing author is not thrown: it is the status's `lastError`,
   * which is how the caller learns to ask for one and pass it back here.
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
   * the only copy of that history, and a later `track` adopts it.
   */
  public async reconcile(): Promise<void> {
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
    while (this.locks.size > 0) await Promise.all(this.locks.values())
  }

  /** Stop auto commits and wait for what is running. What auto mode had pending is committed by the next {@link reconcile}. */
  public async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await this.settled()
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
    }
    if (missing || binding.mode === "auto") {
      await this.commitCycle(binding.workspaceId, directory, missing ? { message: RECREATE_MESSAGE } : {})
    } else if (binding.state === "syncing") {
      // The app quit, or crashed, in the middle of a cycle.
      this.repositories.workspaceGit.setState(binding.workspaceId, "idle")
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
