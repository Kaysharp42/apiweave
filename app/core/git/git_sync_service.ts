import { randomUUID } from "node:crypto"
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { GitErrorCode } from "@shared/types/GitErrorCode"
import type { GitIdentity } from "@shared/types/GitIdentity"
import type { GitMergeConflict } from "@shared/types/GitMergeConflict"
import type { GitMergeNote } from "@shared/types/GitMergeNote"
import type { GitMergePick } from "@shared/types/GitMergePick"
import type { MergeRecordCommits } from "@shared/types/MergeRecordCommits"
import type { MergeSideCommit } from "@shared/types/MergeSideCommit"
import type { OpenWorkspaceFromGitResult } from "@shared/types/OpenWorkspaceFromGitResult"
import type { WorkflowChangedEvent } from "@shared/types/WorkflowChangedEvent"
import type { WorkspaceGitCommit } from "@shared/types/WorkspaceGitCommit"
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest"
import type { WorkspaceGitError } from "@shared/types/WorkspaceGitError"
import type { WorkspaceGitMode } from "@shared/types/WorkspaceGitMode"
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus"
import type { WorkspacePendingChange } from "@shared/types/WorkspacePendingChange"
import { describeMergeNote } from "@shared/git-merge/notes"
import { GitMergeInputError, mergeTree, type GitMergeTreeResult } from "@shared/git-merge/tree"
import { RecordIdSchema } from "@shared/workspace-repo/format"
import { AppError, ConflictError, NotFoundError, ValidationError } from "../ipc/errors"
import { getLogger } from "../logging/logger"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowRepository,
  WorkspaceGitBinding,
  WorkspaceGitRepository,
  WorkspaceMerge,
  WorkspaceRepository,
} from "../repositories"
import {
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
  GitNonFastForwardError,
  GitNotARepositoryError,
  GitPermissionDeniedError,
  isCheckedOutBranchRefusal,
  isNoSuchRemote,
} from "./git_errors"
import { awaitWithin } from "./git_process"
import type { GitService } from "./git_service"
import type { GitAheadBehind, GitStatusEntry, GitTreeEntry } from "./git_types"
import { moveIntoPlace } from "./move_into_place"
import { describePendingChanges, diffTrees } from "./pending_changes"
import { settleTreeEntries, withoutPaths } from "./tree_entries"
import { FORMAT_PATHS, readWorkspaceTree, readWorkspaceTreeAt, removeCheckedOutEntry, treeTarget, writeWorkspaceTree } from "./workspace_tree"

/** How long auto mode waits after the last edit before it commits: one commit per burst of edits. */
export const AUTO_COMMIT_DELAY_MS = 30_000

/** How often the app looks at the remote by itself: a full cycle in auto mode, a fetch in manual mode. */
export const SYNC_INTERVAL_MS = 5 * 60_000

/**
 * How long {@link GitSyncService.dispose} waits for a running cycle or open
 * before letting the app quit; the next startup's reconcile repairs or
 * removes what it left behind.
 */
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
const NOT_CONNECTED_MESSAGE = "This workspace is not connected to a remote, so there is no remote state to restore."
const NO_REMOTE_BRANCH_MESSAGE = "The remote does not have this workspace's branch yet, so there is no remote state to restore."

/**
 * Both sides hold commits since they last agreed and a merge the user gave up
 * on is not going to be retried by a pass: only Sync now combines them again.
 * Nothing was pushed, and every local commit stays. `diverged` means exactly
 * this, and nothing else reaches it.
 */
const DIVERGED_MESSAGE =
  "This workspace and its remote have each changed since they last agreed, and the merge was abandoned. " +
  "Nothing was pushed; this device's changes are safe. Sync now to combine the two again, or discard the local changes to match the remote."

/**
 * A remote branch that shares no commit with this workspace's history — it was
 * replaced, or this device's history folder was recreated — has no ancestor to
 * merge from. It is {@link UNRELATED_HISTORY_MESSAGE} met by a sync rather than
 * a connect, so what to do differs.
 */
const UNRELATED_REMOTE_MESSAGE =
  "The remote's branch holds history this workspace did not come from, so the two cannot be merged, and nothing was pushed. " +
  "Discard local changes to load the remote's version, or disconnect the remote to keep this device's."

/** A merge that would not stop seeing new local edits: another Resolve finishes it. */
const MERGE_RETRY_MESSAGE = "This workspace changed again while the merge was being committed. Resolve the merge again to finish it."

const NOT_MERGING_MESSAGE = "This workspace has no merge in progress."
const COMMIT_WHILE_MERGING_MESSAGE = "This workspace is merging the remote's changes. Resolve or abandon the merge before committing."

/** How many times a resolve commits the edits that landed under it and redoes the merge before leaving it for another try. */
const MAX_MERGE_ATTEMPTS = 3

/** How many records one {@link GitSyncService.mergeRecordCommits} call reads commits for: a picker asks for what it lists. */
const MAX_MERGE_RECORD_COMMITS = 500
/** How many records' commits one {@link GitSyncService.mergeRecordCommits} call reads at once: read-only `log`s, but not 500 processes at a time. */
const MAX_MERGE_COMMITS_IN_FLIGHT = 8

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
  | "lsTree"
  | "readBlobs"
  | "clean"
  | "fetch"
  | "push"
  | "remoteAdd"
  | "remoteSetUrl"
  | "remoteRemove"
  | "revParse"
  | "mergeBase"
  | "mergeFastForward"
  | "mergeNoCommit"
  | "mergeAbort"
  | "readTreeFiles"
  | "resetHard"
  | "countAheadBehind"
  | "countCommits"
  | "firstRemoteRef"
>

export interface GitSyncRepositories {
  readonly workspaces: WorkspaceRepository
  readonly collections: CollectionRepository
  readonly workflows: WorkflowRepository
  readonly environments: EnvironmentRepository
  readonly workspaceGit: WorkspaceGitRepository
}

/** A merge's three trees, read, and what the merge made of them. */
interface MergeComputation {
  readonly result: GitMergeTreeResult
  /** The ancestor, our copy and the remote copy, in that order: what the merge deletes is in them and not in `files`. */
  readonly copies: readonly ReadonlyMap<string, string>[]
  /** Links and submodules the remote copy removed, which the merge removes too; every other one stays as our commit holds it. */
  readonly entryRemovals: readonly string[]
}

export interface GitSyncServiceOptions {
  /** Each tracked workspace's repository is `<cloneRoot>/<workspaceId>`; only this service writes there. */
  readonly cloneRoot: string
  readonly git: GitSyncGit
  readonly repositories: GitSyncRepositories
  /** Defaults to {@link AUTO_COMMIT_DELAY_MS}. */
  readonly autoCommitDelayMs?: number
  /** Defaults to {@link SYNC_INTERVAL_MS}; {@link GitSyncService.start} polls at this rate. */
  readonly syncIntervalMs?: number
  /** Defaults to {@link DISPOSE_WAIT_MS}; how long {@link GitSyncService.dispose} waits for a running cycle or open. */
  readonly disposeWaitMs?: number
  /** Told every status a call or an auto commit leaves behind. Must not throw. */
  readonly onStatusChanged?: (status: WorkspaceGitStatus) => void
  /**
   * Told when the remote's tree was imported into the workspace — by a
   * fast-forward or a discard — and committed: its records changed underneath
   * whatever the renderer holds. Not told for an import that rolled back.
   */
  readonly onImported?: (workspaceId: string) => void
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
 *
 * With a remote, every cycle continues past the commit: fetch, fast-forward
 * and import, push (§3.1 steps 3–5). {@link start} also runs a pass at startup
 * and every {@link SYNC_INTERVAL_MS}: auto workspaces cycle, manual ones only
 * fetch, so their status can report incoming changes. A workspace whose call
 * is queued or running is skipped; the pass is a poll, not a second caller.
 *
 * Moving the clone to the remote's tip and importing that tree cannot be one
 * atomic step, and a clone left ahead of its database would commit the
 * inverse of the remote's change and push it. So the commit the clone is
 * leaving is recorded on the row before it moves (`integratingFrom`) and
 * cleared in the import's own transaction; every call that serializes or
 * pushes the workspace first moves a clone that still carries it back there,
 * and stops with `error` when it cannot.
 */
export class GitSyncService {
  private readonly repositories: GitSyncRepositories
  private readonly git: GitSyncGit
  private readonly delayMs: number
  private readonly intervalMs: number
  private readonly disposeWaitMs: number
  private readonly locks = new Map<string, Promise<void>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * How many committed writes each workspace's repositories have announced,
   * and the count the last commit saw. A cycle that finds them apart has an
   * edit the database holds but the clone does not, and must commit it before
   * anything — an import included — can replace it (§3.1 step 1).
   */
  private readonly writes = new Map<string, number>()
  private readonly committedWrites = new Map<string, number>()
  /** The tail of each workspace's chain of status announces; see {@link announce}. */
  private readonly announceChains = new Map<string, Promise<void>>()
  /** The status reports an edit started, still running; they never reject. */
  private readonly announcements = new Set<Promise<unknown>>()
  /** Opens run one at a time: the end of the chain, which never rejects. */
  private openQueue: Promise<void> = Promise.resolve()
  private passTimer: ReturnType<typeof setInterval> | undefined
  private started = false
  private disposed = false

  public constructor(private readonly options: GitSyncServiceOptions) {
    this.repositories = options.repositories
    this.git = options.git
    this.delayMs = options.autoCommitDelayMs ?? AUTO_COMMIT_DELAY_MS
    this.intervalMs = options.syncIntervalMs ?? SYNC_INTERVAL_MS
    this.disposeWaitMs = options.disposeWaitMs ?? DISPOSE_WAIT_MS
  }

  /**
   * The git facts (what the remote holds, the last commit) are asked first,
   * and the row and the write counters are read after them: an operation that
   * finished while git was answering is then in the status, not overwritten by
   * the state it started from.
   */
  public async status(workspaceId: string): Promise<WorkspaceGitStatus> {
    const asked = this.repositories.workspaceGit.get(workspaceId)
    if (asked === undefined) return untrackedStatus(workspaceId)
    const directory = this.cloneDir(workspaceId)
    const [{ ahead, behind }, lastCommit] = await Promise.all([this.divergence(directory, asked), this.lastCommit(directory)])
    const binding = this.repositories.workspaceGit.get(workspaceId)
    if (binding === undefined) return untrackedStatus(workspaceId)
    return {
      workspaceId,
      tracked: true,
      mode: binding.mode,
      remoteUrl: binding.remoteUrl,
      branch: binding.branch,
      state: binding.state,
      lastError: binding.lastError,
      readOnly: binding.readOnly,
      incoming: behind,
      outgoing: ahead,
      uncommitted: this.uncommittedWrites(workspaceId),
      lastSyncedAt: binding.remoteUrl === null ? null : binding.lastSyncedAt,
      lastCommit,
    }
  }

  /**
   * Every tracked workspace's status, for the switcher's icon on each row: the
   * same report `status` gives one workspace, with no entry for an untracked
   * one. Read-only: it runs no cycle and commits nothing.
   *
   * One workspace at a time: a status runs two or three git processes, and the
   * list only decorates rows, so it must not start them all at once.
   */
  public async statusAll(): Promise<readonly WorkspaceGitStatus[]> {
    const statuses: WorkspaceGitStatus[] = []
    for (const { workspaceId } of this.repositories.workspaceGit.listAll()) {
      const status = await this.status(workspaceId)
      // Untracked while the list was being read: there is nothing to report.
      if (status.tracked) statuses.push(status)
    }
    return statuses
  }

  /**
   * How this workspace stands against the remote branch. `countAheadBehind`
   * treats a branch the remote has not got yet as empty, which would report
   * 0/0 with unpushed commits: with no remote branch every local commit is
   * outgoing. An unborn HEAD is nothing either way.
   */
  private async divergence(directory: string, binding: WorkspaceGitBinding): Promise<GitAheadBehind> {
    if (binding.remoteUrl === null) return { ahead: 0, behind: 0 }
    try {
      const remoteRef = `${ORIGIN}/${binding.branch}`
      if ((await this.git.revParse(directory, remoteRef)) === undefined) {
        if ((await this.git.revParse(directory, "HEAD")) === undefined) return { ahead: 0, behind: 0 }
        return { ahead: await this.git.countCommits(directory, "HEAD"), behind: 0 }
      }
      return await this.git.countAheadBehind(directory, "HEAD", remoteRef)
    } catch (error) {
      // A status is a report, not an operation: a missing clone or git is the next cycle's error to record.
      if (error instanceof GitError) return { ahead: 0, behind: 0 }
      throw error
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

  // fallow-ignore-next-line code-duplication -- this block is method chrome (`directory`, `exclusive`) aligned with `discardLocalChanges`'s opening; the two methods share no behaviour to extract.
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
      this.writes.delete(workspaceId)
      this.committedWrites.delete(workspaceId)
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
      // A clone an earlier remote's fast-forward left moved holds commits the database does not: never push those.
      await this.returnToDatabase(workspaceId, directory)
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

  /**
   * Remove the connection. Local history is never touched, nor is the
   * remote's. Disconnecting an unconnected workspace changes nothing. A merge
   * waiting on the remote's commit goes with the remote, in the same
   * transaction: the workspace is idle again, every local commit and edit
   * stays, and auto mode commits the edits the merge held back.
   */
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
      this.resumeAutoCommit(workspaceId)
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
   * Run one full sync cycle, now: commit what changed and, for a connected
   * workspace, fetch, integrate and push (§3.1 steps 1–5). An unconnected
   * workspace stops after the commit.
   *
   * Resolves with the status the cycle left behind. A missing author, a
   * divergence, a refused push, every other git failure and a remote tree that
   * does not import are that status's `state` and `lastError`, not a
   * rejection: the cycle recorded its outcome, and the caller reads it here.
   * It rejects for an id that is not a workspace id, an untracked workspace,
   * and an unexpected failure — a bug, which the status records as well.
   *
   * This is the one cycle that pushes a workspace the host refused (read-only):
   * an automatic pass leaves its commits local, and a push that sends commits
   * and succeeds clears the flag. With nothing to send nothing is pushed, so
   * nothing is proved and the flag stays.
   */
  public async syncNow(workspaceId: string, request: WorkspaceGitCommitRequest = {}): Promise<WorkspaceGitStatus> {
    this.cancelAutoCommit(workspaceId)
    // The status this cycle left, read under its lock: a cycle queued behind it must not answer for it.
    return this.exclusive(workspaceId, async () => {
      // A waiting merge owns the clone until it is resolved or abandoned; Sync
      // now neither commits over it nor starts a second merge. It only takes
      // the author it names, which a resolve that stopped for one needs next.
      const binding = this.repositories.workspaceGit.get(workspaceId)
      if (binding?.state === "merging") {
        if (request.identity !== undefined) await this.nameMergeAuthor(binding, request.identity)
        return this.announce(workspaceId)
      }
      await this.syncCycle(workspaceId, this.cloneDir(workspaceId), request, true)
      return this.status(workspaceId)
    })
  }

  /** The clone's author, set while a merge waits; the missing-author error a resolve left is then over, and any other stays. */
  private async nameMergeAuthor(binding: WorkspaceGitBinding, identity: GitIdentity): Promise<void> {
    const { workspaceId } = binding
    try {
      await this.git.setIdentity(this.cloneDir(workspaceId), identity)
    } catch (error) {
      if (!(error instanceof GitError)) throw error
      this.repositories.workspaceGit.setState(workspaceId, "merging", describeError(error))
      return
    }
    if (binding.lastError?.code === "identity_missing") this.repositories.workspaceGit.setState(workspaceId, "merging", null)
  }

  /**
   * Throw away everything this workspace has that the remote does not: every
   * local commit and uncommitted change, then re-import the remote's tree.
   * The offer read-only mode makes, and the recovery from a divergence.
   *
   * The clone is fetched first, so "the remote" is the remote as it is now,
   * and the branch is reset to `origin/<branch>` — not to a configured
   * upstream, which a joined remote may not have. The read-only flag stays:
   * discarding proves nothing about whether the host now accepts a push.
   * Rejects when the fetch fails or the remote's tree does not import; the
   * workspace is then as it was.
   */
  public async discardLocalChanges(workspaceId: string): Promise<WorkspaceGitStatus> {
    const directory = this.cloneDir(workspaceId)
    this.cancelAutoCommit(workspaceId)
    return this.exclusive(workspaceId, async () => {
      const binding = this.trackedBinding(workspaceId)
      if (binding.remoteUrl === null) throw new ConflictError(NOT_CONNECTED_MESSAGE)
      // An earlier move that never imported: `head` below must be where the database is.
      // A waiting merge is cleared by the import below, in its own transaction: a discard
      // that fails before importing leaves the workspace exactly as the merge left it.
      await this.returnToDatabase(workspaceId, directory)
      await this.git.fetch(directory, ORIGIN)
      const remoteRef = `${ORIGIN}/${binding.branch}`
      const remoteSha = await this.git.revParse(directory, remoteRef)
      if (remoteSha === undefined) throw new ConflictError(NO_REMOTE_BRANCH_MESSAGE)
      const head = await this.git.revParse(directory, "HEAD")
      if (head !== undefined) this.repositories.workspaceGit.setIntegratingFrom(workspaceId, head)
      try {
        await this.git.resetHard(directory, remoteRef)
        // `reset --hard` keeps files git does not track: a record file a cycle
        // wrote and never staged (a crash between the two) would be imported
        // back as if the remote held it, and a file a merge wrote would be
        // committed later as this device's.
        await this.git.clean(directory, ["."])
        await this.importRemoteTree(workspaceId, directory)
      } catch (error) {
        // The reset moved the clone but the import did not take; left there, a
        // later cycle would push the local tree over the remote's. Put it back
        // where it was and report the import's failure.
        await this.rollBackTo(workspaceId, directory, head)
        throw error
      }
      // The import's own writes announced themselves; this cycle already holds what they would commit.
      this.cancelAutoCommit(workspaceId)
      this.recordSynced(workspaceId, remoteSha)
      this.settleIdle(workspaceId)
      return this.announce(workspaceId)
    })
  }

  /** The new commit's sha, or undefined when the workspace's tree already matches HEAD. Supersedes a pending auto commit. */
  public async commitLocal(workspaceId: string, request: WorkspaceGitCommitRequest = {}): Promise<string | undefined> {
    const directory = this.cloneDir(workspaceId)
    this.cancelAutoCommit(workspaceId)
    return this.exclusive(workspaceId, async () => {
      this.assertNotMerging(workspaceId)
      return this.commitCycle(workspaceId, directory, request)
    })
  }

  // fallow-ignore-next-line code-duplication -- this block is method chrome (`directory`, `exclusive`, the binding lookup) that happens to align with another method's; the two share no behaviour.
  /**
   * What the next commit would do, as records the user knows by name. The
   * workspace is serialized in memory and compared with the files HEAD holds:
   * nothing is written, staged or committed, so the clone and the write
   * counters stay as they were. Reading HEAD takes two git calls however many
   * records there are — `ls-tree`, and one `cat-file --batch` for the deleted
   * records' names.
   *
   * Rejects for an untracked workspace, and when the clone cannot be moved
   * back to the database after an import that never finished.
   */
  public async pendingChanges(workspaceId: string): Promise<WorkspacePendingChange[]> {
    const directory = this.cloneDir(workspaceId)
    return this.exclusive(workspaceId, async () => {
      const binding = this.repositories.workspaceGit.get(workspaceId)
      if (binding === undefined) throw notTracked(workspaceId)
      const { tree, head } = await this.treeAgainstHead(workspaceId, directory, binding.branch)
      return describePendingChanges(tree, head, (oids) => this.git.readBlobs(directory, oids))
    })
  }

  /**
   * Every place the two copies changed differently, recomputed from the
   * merge's three commits and the picks stored so far. Empty when no merge is
   * waiting. Reads the trees; it never moves the clone, so a caller may ask as
   * often as it likes, and the same commits and picks always give the same
   * list.
   */
  // fallow-ignore-next-line code-duplication -- this block is method chrome (`directory`, `exclusive`, the binding lookup) that happens to align with another method's; the two share no behaviour.
  public async mergeConflicts(workspaceId: string): Promise<readonly GitMergeConflict[]> {
    const directory = this.cloneDir(workspaceId)
    return this.exclusive(workspaceId, async () => {
      this.trackedBinding(workspaceId)
      const merge = this.repositories.workspaceGit.getMerge(workspaceId)
      if (merge === undefined) return []
      return (await this.computeMerge(merge, directory)).result.conflicts
    })
  }

  /**
   * The decisions already stored for the waiting merge, so a picker reopened
   * after a partial resolve starts where it left off: {@link mergeConflicts}
   * lists only what those decisions leave unsettled. Empty when no merge is
   * waiting. Rejects for an untracked workspace.
   *
   * Read-only, and a read of the database alone: the picks are what
   * {@link resolveMerge} last stored, and nothing about them needs the clone.
   */
  public async mergePicks(workspaceId: string): Promise<readonly GitMergePick[]> {
    this.trackedBinding(workspaceId)
    return this.repositories.workspaceGit.getMerge(workspaceId)?.picks ?? []
  }

  /**
   * The last commit each side made to each of `recordIds`, read from the
   * merge's two commits: who wrote each copy, for the picker to show beside
   * it. The ids are the conflicts' `recordId`s — a `file` conflict names its
   * path — and a side that does not hold a record has no commit there, `null`.
   *
   * Read-only: no tree is written and the clone does not move, so asking
   * again always gives the same answers. One `ls-tree` per side names the
   * record files both trees hold; each commit is then one `log -1 -- <path>`,
   * run a few at a time so a big conflict list cannot start a process per
   * record. Rejects for an untracked workspace and one that is not merging.
   */
  public async mergeRecordCommits(workspaceId: string, recordIds: readonly string[]): Promise<readonly MergeRecordCommits[]> {
    const directory = this.cloneDir(workspaceId)
    return this.exclusive(workspaceId, async () => {
      this.mergingBinding(workspaceId)
      const merge = this.repositories.workspaceGit.getMerge(workspaceId)
      if (merge === undefined) throw new ConflictError(NOT_MERGING_MESSAGE)
      const wanted = [...new Set(recordIds)].slice(0, MAX_MERGE_RECORD_COMMITS)
      const [ours, theirs] = await Promise.all([
        this.recordCommitsAt(directory, merge.ourCommit),
        this.recordCommitsAt(directory, merge.theirCommit),
      ])
      // A worker takes the next record when its two reads settle, so at most
      // `MAX_MERGE_COMMITS_IN_FLIGHT` records are being read at once. Each
      // result is written at its index, keeping the list in the order asked.
      const commits = new Array<MergeRecordCommits>(wanted.length)
      let next = 0
      const readNext = async (): Promise<void> => {
        while (next < wanted.length) {
          const index = next
          next += 1
          const recordId = wanted[index]
          if (recordId === undefined) return
          const [ourCommit, theirCommit] = await Promise.all([ours(recordId), theirs(recordId)])
          commits[index] = { recordId, ours: ourCommit, theirs: theirCommit }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(MAX_MERGE_COMMITS_IN_FLIGHT, wanted.length) }, readNext),
      )
      return commits
    })
  }

  /**
   * A reader of one commit's history per record: the tree says which path holds
   * each record id (`<folder>/<slug>--<id>.json`), and a path the tree does not
   * list is used as given — a `file` conflict names its own path. A record
   * neither form finds has no commit on this side.
   */
  private async recordCommitsAt(directory: string, rev: string): Promise<(recordId: string) => Promise<MergeSideCommit | null>> {
    const byId = new Map<string, string>()
    for (const entry of await this.git.lsTree(directory, rev, FORMAT_PATHS)) {
      const id = recordIdOfFile(entry.path)
      if (id !== undefined) byId.set(id, entry.path)
    }
    return async (recordId) => {
      const [entry] = await this.git.log(directory, { rev, maxCount: 1, path: byId.get(recordId) ?? recordId })
      if (entry === undefined) return null
      return { sha: entry.sha, authorName: entry.authorName, authorDate: entry.authorDate, subject: entry.subject }
    }
  }

  /**
   * Settle a waiting merge with `picks` — the complete set of decisions, each
   * naming one conflicted field and which copy wins it — and finish it: commit
   * the merge with the remote's commit as its second parent, import it, and
   * push. Edits made while the merge waited are committed first and the merge
   * is redone on top of them, so an import never overwrites them.
   * `request.message` is the merge commit's subject; the commit of those edits
   * gets the usual one, which names what it changed.
   *
   * Until the merge commit is imported the workspace stays `merging`, so no
   * timer, pass or Sync now moves the commit it is merging from; the push that
   * follows is an ordinary cycle's step 5 and shows as `syncing`. Once the
   * merge is over, auto mode commits whatever was edited meanwhile.
   *
   * With conflicts still unpicked the workspace stays `merging` and the status
   * says so; that is an outcome, not an error. A classified failure — a
   * missing author above all — is recorded on the status and resolves, leaving
   * the merge waiting; the picks are kept, so a retry costs nothing. Rejects
   * only for an untracked workspace, one that is not merging, and a bug.
   */
  public async resolveMerge(
    workspaceId: string,
    picks: readonly GitMergePick[],
    request: WorkspaceGitCommitRequest = {},
  ): Promise<WorkspaceGitStatus> {
    const directory = this.cloneDir(workspaceId)
    this.cancelAutoCommit(workspaceId)
    return this.exclusive(workspaceId, () => this.resolveMergeInClone(workspaceId, directory, picks, request))
  }

  /** {@link resolveMerge} past the lock: settle the picks and finish, or record why it could not. */
  private async resolveMergeInClone(
    workspaceId: string,
    directory: string,
    picks: readonly GitMergePick[],
    request: WorkspaceGitCommitRequest,
  ): Promise<WorkspaceGitStatus> {
    const binding = this.mergingBinding(workspaceId)
    const merge = this.repositories.workspaceGit.getMerge(workspaceId)
    if (merge === undefined) throw new ConflictError(NOT_MERGING_MESSAGE)
    try {
      await this.finishMerge(workspaceId, directory, binding, merge, picks, request)
    } catch (error) {
      this.noteMergeFailure(workspaceId, error)
    }
    this.resumeAutoCommit(workspaceId)
    return this.announce(workspaceId)
  }

  /** Prepare the clone, store the picks, commit the merge when they leave none, and push it. */
  private async finishMerge(
    workspaceId: string,
    directory: string,
    binding: WorkspaceGitBinding,
    merge: WorkspaceMerge,
    picks: readonly GitMergePick[],
    request: WorkspaceGitCommitRequest,
  ): Promise<void> {
    await this.prepareClone(workspaceId, directory, binding.branch, request)
    if (!this.repositories.workspaceGit.setMergePicks(workspaceId, merge.baseCommit, picks)) {
      throw new ConflictError("The merge changed while it was being resolved. Open the merge again.")
    }
    if (await this.settleMerge(workspaceId, directory, request)) return
    // The merge is in the database and the clone now, so nothing is left for
    // `merging` to guard: the push is the cycle's step 5, and a remote that
    // moved again may start another merge.
    this.markSyncing(workspaceId)
    await this.announce(workspaceId)
    if (await this.pushToRemote(workspaceId, directory, binding.branch)) this.settleIdle(workspaceId)
  }

  /**
   * Up to the import the merge is still waiting, so a failure — a missing
   * author above all — must leave it resolvable, not drop it.
   */
  private noteMergeFailure(workspaceId: string, error: unknown): void {
    if (this.repositories.workspaceGit.getMerge(workspaceId) !== undefined) {
      this.repositories.workspaceGit.setState(workspaceId, "merging", describeError(error))
    } else {
      this.recordCycleFailure(workspaceId, error, false)
    }
    if (!(error instanceof GitError || error instanceof AppError || error instanceof PushRefusedError)) throw error
    log.warn(`resolving the merge of workspace ${workspaceId} failed`, error)
  }

  /** The row of a workspace that is merging, which the resolve and the abandon both need first. */
  private mergingBinding(workspaceId: string): WorkspaceGitBinding {
    const binding = this.trackedBinding(workspaceId)
    if (binding.state !== "merging") throw new ConflictError(NOT_MERGING_MESSAGE)
    return binding
  }

  /**
   * Give up on the merge: put the clone back on this device's own commit,
   * leave the remote's changes alone, and mark the workspace `diverged` so a
   * periodic pass does not immediately offer the same conflicts again. Every
   * local commit is kept — HEAD is this device's latest, a merge commit never
   * outlives a crash on this path — and Sync now asks for the merge again.
   * Discard is the way to match the remote instead. Auto mode goes on
   * committing edits locally, the ones made while the merge waited first.
   */
  public async abandonMerge(workspaceId: string): Promise<WorkspaceGitStatus> {
    const directory = this.cloneDir(workspaceId)
    this.cancelAutoCommit(workspaceId)
    return this.exclusive(workspaceId, async () => {
      this.mergingBinding(workspaceId)
      // A finalize that never imported is undone here: the marker names the last
      // commit this device made, which is the one to keep.
      await this.returnToDatabase(workspaceId, directory)
      if (await isRepository(directory)) {
        const head = await this.git.revParse(directory, "HEAD")
        if (head !== undefined) await this.git.resetHard(directory, head)
        else await this.abortGitMerge(directory)
      }
      this.repositories.workspaceGit.endMerge(workspaceId, "diverged", { code: null, message: DIVERGED_MESSAGE })
      this.resumeAutoCommit(workspaceId)
      return this.announce(workspaceId)
    })
  }

  /** A repository write to the workspace committed. Wire to the Collection, Environment and Workspace repositories' `onChanged`. */
  public workspaceChanged(workspaceId: string): void {
    if (this.disposed) return
    const wasCommitted = !this.uncommittedWrites(workspaceId)
    // Counted whatever the mode: a manual workspace's edit is exactly what a
    // cycle already running must commit before it may import anything.
    this.writes.set(workspaceId, (this.writes.get(workspaceId) ?? 0) + 1)
    if (this.repositories.workspaces.getById(workspaceId) === undefined) {
      this.forget(workspaceId)
      return
    }
    const binding = this.repositories.workspaceGit.get(workspaceId)
    // A waiting merge pauses auto-commit: resolving commits these edits itself,
    // on top of them, so a timer must not move the commit it is merging from.
    if (binding?.mode === "auto" && binding.state !== "merging") this.scheduleAutoCommit(workspaceId)
    // The first edit after a commit is what turns a workspace's status to
    // `uncommitted`; the ones after it change nothing a status says.
    if (binding !== undefined && wasCommitted) this.announceEdit(workspaceId)
  }

  /** Tell the observer a workspace now has an edit waiting. Tracked, so {@link settled} and {@link dispose} wait for the git it runs. */
  private announceEdit(workspaceId: string): void {
    const announcing = this.announce(workspaceId)
      .catch((error: unknown) => log.warn(`could not report the edit to workspace ${workspaceId}`, error))
      .finally(() => this.announcements.delete(announcing))
    this.announcements.add(announcing)
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
   * download and is removed. That sweep waits its turn behind any open in
   * progress, which it must not race, so it is queued rather than awaited: an
   * open still cloning does not hold up the rest of startup. {@link settled}
   * waits for it.
   */
  public async reconcile(): Promise<void> {
    void this.inOpenQueue(() => this.sweepOpenScratch())
    const bindings = this.repositories.workspaceGit.listAll()
    const results = await Promise.allSettled(
      bindings.map((binding) => this.exclusive(binding.workspaceId, () => this.reconcileOne(binding))),
    )
    for (const result of results) {
      if (result.status === "rejected") log.warn("could not reconcile a workspace repository", result.reason)
    }
  }

  /** Resolves once no call is running or queued for any workspace, and no edit's status report is still running. */
  public async settled(): Promise<void> {
    await this.openQueue
    while (this.locks.size > 0 || this.announcements.size > 0) await Promise.all([...this.locks.values(), ...this.announcements])
  }

  /**
   * Begin syncing by itself: {@link reconcile} (repair, and commit what auto
   * mode left pending), one pass now, then one every
   * {@link SYNC_INTERVAL_MS}. In auto mode a pass is a full cycle; in manual
   * mode it only fetches, so the status can report incoming changes.
   */
  public async start(): Promise<void> {
    await this.reconcile()
    if (this.disposed || this.started) return
    this.started = true
    await this.pass()
    // A dispose during the pass must not leave a timer behind that nothing
    // will clear: the app is quitting.
    if (this.disposed) return
    this.passTimer = setInterval(() => void this.pass(), this.intervalMs)
  }

  /** One pass over every tracked workspace, at startup and on the interval. Its failures are logged, never thrown. */
  private async pass(): Promise<void> {
    const bindings = this.repositories.workspaceGit.listAll()
    await Promise.allSettled(bindings.map((binding) => this.passOne(binding.workspaceId)))
  }

  /**
   * A workspace's share of a pass. One with a call queued or running is left
   * to it: the pass is a poll, and a cycle already under way is fresher than
   * this one would be. A workspace with no remote has nothing to fetch.
   */
  private async passOne(workspaceId: string): Promise<void> {
    if (this.disposed || this.locks.has(workspaceId)) return
    try {
      await this.exclusive(workspaceId, async () => {
        // The mode, the remote or the row itself can change while this waits for the lock.
        const binding = this.repositories.workspaceGit.get(workspaceId)
        if (binding === undefined || binding.remoteUrl === null) return
        // A merge waits for the user, and an abandoned one waits for Sync now:
        // a pass must not start either again behind their back. The timer
        // still commits an abandoned merge's edits locally (see autoSync).
        if (binding.state === "merging" || (binding.mode === "auto" && binding.state === "diverged")) return
        if (binding.mode === "manual") await this.fetchOnly(workspaceId)
        else await this.syncCycle(workspaceId, this.cloneDir(workspaceId), {}, !binding.readOnly)
      })
    } catch (error) {
      log.warn(`the periodic sync of workspace ${workspaceId} failed`, error)
    }
  }

  /**
   * Manual mode's share of a pass: fetch, so the status's incoming count is
   * current, and integrate nothing — that is Sync now's job. A failed fetch is
   * the state, except that `diverged` is about where the histories stand,
   * which fetching does not change: a failed fetch keeps it, with the fetch's
   * message. A good fetch settles only a failure to reach the remote; any
   * other — a missing author, a push the remote turned away, a tree that did
   * not import — is about something a fetch does not retry, and stays.
   */
  private async fetchOnly(workspaceId: string): Promise<void> {
    try {
      await this.git.fetch(this.cloneDir(workspaceId), ORIGIN)
      const binding = this.repositories.workspaceGit.get(workspaceId)
      if (binding !== undefined) this.settleAfterFetch(workspaceId, binding)
    } catch (error) {
      this.recordFetchFailure(workspaceId, error)
      throw error
    } finally {
      await this.announce(workspaceId)
    }
  }

  /**
   * A good fetch's outcome, as the workspace's state: it settles a failure to
   * reach the remote, keeps a waiting merge and `diverged` (which is about
   * where the histories stand, not how reachable the remote is), and leaves
   * every other failure — a missing author, a refused push, a tree that did
   * not import — because a fetch does not retry those.
   */
  private settleAfterFetch(workspaceId: string, binding: WorkspaceGitBinding): void {
    const reachSettled = binding.lastError === null || isReachFailure(binding.lastError)
    if (binding.state === "merging") {
      if (reachSettled) this.repositories.workspaceGit.setState(workspaceId, "merging", null)
    } else if (reachSettled && binding.state !== "diverged") {
      this.settleIdle(workspaceId)
    }
  }

  /** A failed fetch's outcome: `diverged` and `merging` keep their state, since a fetch cannot change either; anything else becomes `error`. */
  private recordFetchFailure(workspaceId: string, error: unknown): void {
    const state = this.repositories.workspaceGit.get(workspaceId)?.state
    this.repositories.workspaceGit.setState(workspaceId, state === "diverged" || state === "merging" ? state : "error", describeError(error))
  }

  /**
   * Stop auto commits and wait for what is running, but at most
   * {@link DISPOSE_WAIT_MS}: a cycle blocked on a network timeout, or an open
   * still cloning, must not hold the app open. Giving up leaves it running —
   * an open gives up by itself once its clone is done — and the next
   * startup's reconcile repairs or removes what it left behind. What auto
   * mode had pending is committed by that reconcile.
   */
  public async dispose(): Promise<void> {
    this.disposed = true
    if (this.passTimer !== undefined) {
      clearInterval(this.passTimer)
      this.passTimer = undefined
    }
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    let settled = false
    await awaitWithin(this.settled().then(() => {
      settled = true
    }), this.disposeWaitMs)
    if (!settled) {
      log.warn(`gave up waiting ${this.disposeWaitMs} ms for running sync calls to settle; they carry on in the background`)
    }
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
    const head = await this.git.revParse(scratch, "HEAD")

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
        // The database and the clone hold exactly the remote's tip.
        if (head !== undefined) workspaceGit.recordSynced(workspaceId, head, new Date().toISOString())
      })
      // The import announced its writes; the clone already holds what they wrote.
      this.committedWrites.set(workspaceId, this.writes.get(workspaceId) ?? 0)
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
    // A merge the app quit under is repaired rather than committed: its
    // conflicts are recomputed, and the edits made meanwhile stay uncommitted
    // for the resolve that redoes it.
    const merging = binding.state === "merging" && (await this.reconcileMerge(binding, directory))
    if (!merging) {
      if (missing || binding.mode === "auto") {
        try {
          // Moves a clone an import never caught up with back to the database first.
          await this.commitCycle(binding.workspaceId, directory, missing ? { message: RECREATE_MESSAGE } : {})
        } catch (error) {
          // The edits are still waiting, and the status must say so.
          await this.seedUncommitted(binding.workspaceId, directory, binding.branch)
          await this.announce(binding.workspaceId).catch(() => undefined)
          throw error
        }
      } else {
        await this.reconcileManual(binding, directory)
      }
    }
    // The row is the truth about the remote: a clone that was recreated or adopted gets it back. Local git only, no network.
    if (binding.remoteUrl !== null) await this.pointOriginAt(directory, binding.remoteUrl)
  }

  /**
   * A merge the app quit under. The clone goes back to this device's own
   * commit (a finalize that never imported is undone), and the three commits
   * must still be readable, or the merge is dropped and the workspace is idle.
   * A clone whose commits are merely gone still shares the remote's history,
   * so the next cycle merges again. A clone that is gone altogether is
   * recreated from the database as a history of its own, which shares no
   * commit with the remote: the next cycle cannot merge it, and stops with
   * {@link UNRELATED_REMOTE_MESSAGE}. The conflicts themselves are never
   * stored — the row's trees and picks recompute them — so nothing else needs
   * repairing. Returns false when the workspace is no longer merging and the
   * ordinary startup applies.
   */
  private async reconcileMerge(binding: WorkspaceGitBinding, directory: string): Promise<boolean> {
    const workspaceId = binding.workspaceId
    try {
      await this.returnToDatabase(workspaceId, directory)
      // A merge git itself was holding — the crash came between `merge --no-commit`
      // and the abort — is cancelled before the merge is recomputed.
      if (await isRepository(directory)) await this.abortGitMerge(directory)
      const merge = this.repositories.workspaceGit.getMerge(workspaceId)
      if (merge === undefined || !(await isRepository(directory)) || !(await this.holdsCommits(directory, merge))) {
        log.warn(`workspace ${workspaceId} was merging, but the commits of the merge are gone; the merge is dropped`)
        this.repositories.workspaceGit.endMerge(workspaceId, "idle", null)
        return false
      }
      // The clone may be on a commit the merge row has not caught up with: a
      // resolve that committed local edits and then quit. Ours is HEAD.
      const current = await this.moveMergeToHead(workspaceId, merge, directory)
      await this.computeMerge(current, directory)
      // Edits made while the merge waited are not committed — that is the
      // resolve's job, which redoes the merge on top of them.
      await this.seedUncommitted(workspaceId, directory, binding.branch)
      this.repositories.workspaceGit.setState(workspaceId, "merging", null)
      return true
    } catch (error) {
      this.repositories.workspaceGit.setState(workspaceId, "merging", describeError(error))
      throw error
    }
  }

  /** A manual workspace's startup: nothing is committed for it, but the clone is made right and its waiting edits are counted. */
  private async reconcileManual(binding: WorkspaceGitBinding, directory: string): Promise<void> {
    try {
      await this.returnToDatabase(binding.workspaceId, directory)
    } catch (error) {
      this.repositories.workspaceGit.setState(binding.workspaceId, "error", describeError(error))
      await this.announce(binding.workspaceId)
      throw error
    }
    // The app quit, or crashed, in the middle of a cycle.
    if (binding.state === "syncing") this.settleIdle(binding.workspaceId)
    // Not committed, as an auto workspace's were just now: still waiting, and the status must say so.
    await this.seedUncommitted(binding.workspaceId, directory, binding.branch)
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

  /**
   * A cycle's clone, ready to commit in: back where the database is, a
   * repository again if it was gone, and with the author the caller named.
   * A failure here is the cycle's `error` whatever the histories did — above
   * all a clone that cannot be moved back.
   */
  private async prepareClone(workspaceId: string, directory: string, branch: string, request: WorkspaceGitCommitRequest): Promise<void> {
    await this.returnToDatabase(workspaceId, directory)
    if (!(await isRepository(directory))) await this.git.init(directory, { initialBranch: branch })
    if (request.identity !== undefined) await this.git.setIdentity(directory, request.identity)
  }

  /**
   * One cycle: (re)create the repository if it is gone, write the tree,
   * commit. Its outcome is the workspace's state — except that a local commit
   * does not change where the histories stand, so a diverged workspace stays
   * diverged, with a failure's message when there is one.
   */
  private async commitCycle(
    workspaceId: string,
    directory: string,
    request: WorkspaceGitCommitRequest = {},
  ): Promise<string | undefined> {
    const binding = this.repositories.workspaceGit.get(workspaceId)
    if (binding === undefined) throw notTracked(workspaceId)
    this.assertNotMerging(workspaceId)
    let diverged = false
    this.markSyncing(workspaceId)
    await this.announce(workspaceId)
    try {
      await this.prepareClone(workspaceId, directory, binding.branch, request)
      diverged = binding.state === "diverged"
      const sha = await this.writeAndCommit(workspaceId, directory, request.message)
      if (diverged) this.repositories.workspaceGit.setState(workspaceId, "diverged", binding.lastError)
      else this.settleIdle(workspaceId)
      return sha
    } catch (error) {
      this.repositories.workspaceGit.setState(workspaceId, diverged ? "diverged" : "error", describeError(error))
      throw error
    } finally {
      await this.announce(workspaceId)
    }
  }

  /**
   * One full cycle under the workspace's lock: (re)create the repository if it
   * is gone, write the tree, commit, then sync with the remote — steps 1–5 of
   * §3.1. Its outcome is recorded as the workspace's state. Thrown to the
   * caller: an untracked workspace, and a failure that is neither git's nor
   * the app's own classified error — a bug.
   *
   * `push` says whether this cycle may push: an automatic pass leaves the
   * commits of a read-only workspace local, while a caller-initiated cycle
   * still tries, because that is how the flag is cleared.
   *
   * A diverged workspace whose cycle fails before integrating — offline, say —
   * stays diverged: where the histories stand is unchanged, so only the
   * message is the failure's, as in {@link fetchOnly}.
   */
  private async syncCycle(
    workspaceId: string,
    directory: string,
    request: WorkspaceGitCommitRequest,
    push: boolean,
  ): Promise<void> {
    const binding = this.repositories.workspaceGit.get(workspaceId)
    if (binding === undefined) throw notTracked(workspaceId)
    // A waiting merge is the user's to settle; no pass commits under it.
    if (binding.state === "merging") return
    let stillDiverged = false
    this.markSyncing(workspaceId)
    await this.announce(workspaceId)
    try {
      await this.prepareClone(workspaceId, directory, binding.branch, request)
      stillDiverged = binding.state === "diverged"
      await this.writeAndCommit(workspaceId, directory, request.message)
      if (binding.remoteUrl !== null) {
        const integrated = await this.integrate(workspaceId, directory, binding.branch)
        // A merge the user has to settle stops the cycle before the push; the
        // workspace stays `merging` and Sync now waits for the resolve.
        if (!integrated) return
        stillDiverged = false
        if (push && !(await this.pushToRemote(workspaceId, directory, binding.branch))) return
      }
      this.settleIdle(workspaceId)
    } catch (error) {
      this.recordCycleFailure(workspaceId, error, stillDiverged)
    } finally {
      await this.announce(workspaceId)
    }
  }

  /**
   * A cycle's failure, as the workspace's state. A classified one — git's, or
   * the app's own, such as a remote file that does not validate — is the
   * cycle's outcome, which callers read from the status. Anything else is a
   * bug: recorded too, and thrown.
   */
  private recordCycleFailure(workspaceId: string, error: unknown, stillDiverged: boolean): void {
    if (error instanceof PushRefusedError) {
      // The host refuses this user's pushes: local commits keep working, and
      // pulling continues, so the workspace is not in error — it is read-only.
      this.repositories.workspaceGit.setReadOnly(workspaceId, true)
      this.repositories.workspaceGit.setState(workspaceId, "idle", describeError(error.refusal))
      log.warn(`the host refused the push of workspace ${workspaceId}`, error.refusal)
      return
    }
    this.repositories.workspaceGit.setState(workspaceId, stillDiverged ? "diverged" : "error", describeError(error))
    if (!(error instanceof GitError || error instanceof AppError)) throw error
    log.warn(`the sync cycle of workspace ${workspaceId} failed`, error)
  }

  /**
   * Step 5, past {@link integrate}: push what is local, and retry once when
   * the remote moved during the cycle. A remote branch that does not exist yet
   * is the push's to create; a HEAD the remote already holds is not pushed at
   * all, since `git push` with nothing to send succeeds without asking the
   * host anything. False when the retry found a divergence the merge stops on:
   * the workspace is `merging` and the push must not run. Throws
   * {@link PushRefusedError} when the host refuses this user, and the push's
   * own classified error for anything else — a second non-fast-forward
   * included: the remote moved again under the retry, which is a race the next
   * cycle settles by fetching and merging once more, so it ends as `error`,
   * never as the `diverged` only an abandoned merge leaves.
   */
  private async pushToRemote(workspaceId: string, directory: string, branch: string): Promise<boolean> {
    const rejection = await this.pushUnlessHeld(workspaceId, directory, branch)
    if (rejection === undefined) return true
    // The remote moved while this cycle was running: fetch it again, take what
    // is new, and push once more. Integrating may itself find a divergence.
    const integrated = await this.integrate(workspaceId, directory, branch)
    if (!integrated) return false
    const second = await this.pushUnlessHeld(workspaceId, directory, branch)
    if (second === undefined) return true
    throw second
  }

  /**
   * One attempt at step 5: push unless the remote already holds HEAD, and
   * record a push that went through. Undefined means the remote holds HEAD or
   * took the push; a non-fast-forward rejection is returned for the caller to
   * settle and retry.
   */
  private async pushUnlessHeld(workspaceId: string, directory: string, branch: string): Promise<GitNonFastForwardError | undefined> {
    if (await this.remoteHoldsHead(directory, branch)) return undefined
    const rejection = await this.pushOnce(directory, branch)
    if (rejection === undefined) await this.recordPushed(workspaceId, directory)
    return rejection
  }

  /**
   * Fetch the tracked branch and bring it in (§3.1 step 4). A remote that is
   * ahead is fast-forwarded over and its tree imported as one transaction; a
   * remote that is behind is left for the push; one that has diverged is
   * merged by node and field ({@link mergeFetched}). False when that merge has
   * conflicts: they are recorded, the workspace is `merging`, and the caller
   * must not push. Importing announces the writes it made, which would
   * schedule a commit that has nothing to write: the cycle cancels it.
   */
  private async integrate(workspaceId: string, directory: string, branch: string): Promise<boolean> {
    await this.git.fetch(directory, ORIGIN)
    return this.integrateFetched(workspaceId, directory, branch)
  }

  /**
   * {@link integrate} past its fetch. A write that landed while the fetch was
   * in flight is in the database but not in the clone: it is committed first,
   * before the remote is read, so a remote that moved is no longer a
   * fast-forward and the merge reads the edit as ours. A write that lands
   * later, while the clone is moving, is caught just before the import: the
   * clone goes back and the decision is taken again with that write committed.
   */
  private async integrateFetched(workspaceId: string, directory: string, branch: string): Promise<boolean> {
    if (this.uncommittedWrites(workspaceId)) await this.writeAndCommit(workspaceId, directory)
    const remoteRef = `${ORIGIN}/${branch}`
    const remoteSha = await this.git.revParse(directory, remoteRef)
    // No branch on the remote yet: the push creates it.
    if (remoteSha === undefined) return true
    const head = await this.git.revParse(directory, "HEAD")
    if (head === remoteSha) {
      this.recordSynced(workspaceId, remoteSha)
      return true
    }
    // An unborn HEAD or a remote descendant is a fast-forward; a sibling is ours to merge.
    const base = head === undefined ? undefined : await this.git.mergeBase(directory, "HEAD", remoteRef)
    if (base === head) {
      if (await this.fastForward(workspaceId, directory, remoteRef, head)) this.recordSynced(workspaceId, remoteSha)
      else return this.integrateFetched(workspaceId, directory, branch)
      return true
    }
    // Ours already contains theirs: the push carries it.
    if (base === remoteSha) return true
    return this.mergeFetched(workspaceId, directory, branch, base, head, remoteSha)
  }

  /**
   * Both sides hold commits since the ancestor: merge them by record, node and
   * field. A clean result is committed as a real two-parent merge (with the
   * notes of what the merge settled in its message), imported, and pushed by
   * the caller. Conflicts record the three commits on the row and leave the
   * workspace `merging`; nothing is written over either side, and false tells
   * the caller to stop before the push.
   *
   * A write that lands under the commit makes the import refuse; the merge
   * commit is then dropped and the decision is taken again, so the edit is
   * committed as part of ours and never imported over. Histories that share
   * no ancestor have nothing to merge from: that is an `error` with
   * {@link UNRELATED_REMOTE_MESSAGE}, which says what to do instead.
   */
  private async mergeFetched(
    workspaceId: string,
    directory: string,
    branch: string,
    base: string | undefined,
    head: string | undefined,
    theirs: string,
  ): Promise<boolean> {
    if (base === undefined || head === undefined) throw new ConflictError(UNRELATED_REMOTE_MESSAGE)
    const merge = { workspaceId, baseCommit: base, ourCommit: head, theirCommit: theirs, picks: [] }
    const outcome = await this.computeMerge(merge, directory)
    if (outcome.result.conflicts.length > 0) {
      this.repositories.workspaceGit.startMerge(workspaceId, base, head, theirs, [])
      // Waiting for picks is not a failure, so no `lastError`: that is for what stopped a resolve.
      this.repositories.workspaceGit.setState(workspaceId, "merging", null)
      return false
    }
    const imported = await this.commitMerge(workspaceId, directory, merge, outcome)
    // A write landed under the commit: the merge was dropped and the edit is
    // ours now, so decide again rather than import over it.
    if (!imported) return this.integrateFetched(workspaceId, directory, branch)
    return true
  }

  /**
   * Move the clone from `head` to the remote's tip and import that tree. False
   * when a write landed while the clone was moving: the clone is back on
   * `head`, nothing was imported, and the caller decides again.
   */
  private async fastForward(workspaceId: string, directory: string, remoteRef: string, head: string | undefined): Promise<boolean> {
    // Durable before the clone moves: a crash, a kill or a quit from here until
    // the import commits leaves the commit to go back to on the row.
    if (head !== undefined) this.repositories.workspaceGit.setIntegratingFrom(workspaceId, head)
    let imported: boolean
    try {
      await this.git.mergeFastForward(directory, remoteRef)
      imported = await this.importRemoteTree(workspaceId, directory, head !== undefined)
    } catch (error) {
      // The clone moved to the remote's tip but the database kept its own
      // tree. Left there, a later cycle would serialize that tree and push a
      // revert of the remote's change, so put the clone back where it was and
      // report the import's own failure.
      await this.rollBackTo(workspaceId, directory, head)
      throw error
    }
    if (!imported && head !== undefined) {
      // Not best effort: the caller commits next, which must never happen over a moved clone.
      await this.returnTo(workspaceId, directory, head)
      return false
    }
    this.cancelAutoCommit(workspaceId)
    return true
  }

  /**
   * One merge's three trees and what the merge makes of them. Links and
   * submodules are settled as tree entries by {@link settleTreeEntries} and
   * kept out of the file merge, so it neither writes nor deletes one.
   */
  private async computeMerge(merge: WorkspaceMerge, directory: string): Promise<MergeComputation> {
    const [baseTree, ourTree, theirTree] = await Promise.all([
      readWorkspaceTreeAt(this.git, directory, merge.baseCommit),
      readWorkspaceTreeAt(this.git, directory, merge.ourCommit),
      readWorkspaceTreeAt(this.git, directory, merge.theirCommit),
    ])
    const entries = settleTreeEntries({ base: baseTree, ours: ourTree, theirs: theirTree }, merge)
    const base = withoutPaths(baseTree.files, entries.paths)
    const ours = withoutPaths(ourTree.files, entries.paths)
    const theirs = withoutPaths(theirTree.files, entries.paths)
    try {
      // A tree APIWeave cannot read is never merged over: report which copy and
      // which file, rather than committing a guess.
      return { result: mergeTree(base, ours, theirs, merge.picks), copies: [base, ours, theirs], entryRemovals: entries.removals }
    } catch (error) {
      if (error instanceof GitMergeInputError) throw new ValidationError(error.message)
      throw error
    }
  }

  /**
   * The merge a resolve is about to finish, with `ourCommit` moved to HEAD
   * when the clone is on a commit the row has not caught up with — a resolve
   * that committed local edits and quit before writing them down. A merge is
   * between the two commits' trees, so the row has to name the one the clone
   * holds or the redo would merge from a stale "ours".
   */
  private async moveMergeToHead(workspaceId: string, merge: WorkspaceMerge, directory: string): Promise<WorkspaceMerge> {
    const head = await this.git.revParse(directory, "HEAD")
    if (head === undefined || head === merge.ourCommit) return merge
    const moved: WorkspaceMerge = { ...merge, ourCommit: head }
    this.repositories.workspaceGit.startMerge(workspaceId, moved.baseCommit, moved.ourCommit, moved.theirCommit, moved.picks)
    return moved
  }

  /**
   * Finish a waiting merge: commit the edits made since it began, recompute it
   * from the row's three commits and the stored picks, and commit the result
   * as a two-parent merge. True while conflicts are still unpicked — the merge
   * stays recorded with the picks, and the workspace is `merging`.
   *
   * The loop is what keeps an import from overwriting an edit: a write that
   * lands while the merge commit is being made makes the import refuse, the
   * commit is dropped, and the next turn commits the edit and redoes the merge
   * on top of it. Its bound leaves the merge for another Resolve rather than
   * spinning on a workspace someone is typing into.
   */
  private async settleMerge(workspaceId: string, directory: string, request: WorkspaceGitCommitRequest): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
      const stored = this.repositories.workspaceGit.getMerge(workspaceId)
      if (stored === undefined) throw new ConflictError(NOT_MERGING_MESSAGE)
      if (this.uncommittedWrites(workspaceId)) await this.writeAndCommit(workspaceId, directory)
      const merge = await this.moveMergeToHead(workspaceId, stored, directory)
      const computation = await this.computeMerge(merge, directory)
      if (computation.result.conflicts.length > 0) {
        this.repositories.workspaceGit.startMerge(workspaceId, merge.baseCommit, merge.ourCommit, merge.theirCommit, merge.picks)
        this.repositories.workspaceGit.setState(workspaceId, "merging", null)
        return true
      }
      if (await this.commitMerge(workspaceId, directory, merge, computation, request.message)) return false
    }
    this.repositories.workspaceGit.setState(workspaceId, "merging", { code: null, message: MERGE_RETRY_MESSAGE })
    return true
  }

  /**
   * Commit `computation` as the merge of `merge.theirCommit` into HEAD, write
   * its tree, and import it. False when an edit landed while the commit was
   * being made: the clone is back on `head`, the merge is not imported, and
   * the caller has to decide again with that edit committed. `subject` names
   * the commit instead of the default; the notes follow it either way.
   *
   * `integratingFrom` is written before the clone moves, so a crash here is
   * repaired at the next start; the import clears it in its own transaction.
   */
  private async commitMerge(
    workspaceId: string,
    directory: string,
    merge: WorkspaceMerge,
    computation: MergeComputation,
    subject?: string,
  ): Promise<boolean> {
    const head = await this.git.revParse(directory, "HEAD")
    if (head === undefined) throw new ConflictError(NO_COMMIT_MESSAGE)
    this.repositories.workspaceGit.setIntegratingFrom(workspaceId, head)
    try {
      // A real two-parent commit: `-s ours` leaves the checkout to us, and
      // git records MERGE_HEAD, so `git merge --abort` is still the cancel.
      await this.git.mergeNoCommit(directory, merge.theirCommit)
      await this.writeMergedTree(directory, computation)
      await this.git.add(directory, ["."])
      await this.git.commit(directory, mergeCommitMessage(computation.result.notes, subject))
      const imported = await this.importRemoteTree(workspaceId, directory, true)
      if (!imported) await this.returnTo(workspaceId, directory, head)
      return imported
    } catch (error) {
      await this.abortGitMerge(directory)
      await this.rollBackTo(workspaceId, directory, head)
      throw error
    }
  }

  /**
   * The merged tree over the checkout: every file the merge keeps is written
   * where the serializer would put it, and every path any of the three copies
   * held that the merge does not — a deleted record, a README one side
   * removed — goes. Files outside all three trees (`.git`, a stray download)
   * are not the merge's to touch.
   *
   * The trees come from another device, so this does not lean on the merge
   * having refused a bad path: every path written or deleted is checked with
   * {@link treeTarget} — inside the clone, and never git's own `.git` folder in
   * any spelling — before anything on disk changes, and one that fails stops
   * the merge with nothing written.
   *
   * A link or submodule the remote copy removed goes first, so a folder the
   * remote put in its place can be written. Every other one is in no copy's
   * files, so nothing here touches it: the checkout keeps the plain file git
   * wrote it as, and `git add` — under `core.symlinks=false` — keeps the
   * entry's mode and blob as our commit has them.
   */
  private async writeMergedTree(directory: string, computation: MergeComputation): Promise<void> {
    const { files } = computation.result
    const gone = new Set<string>()
    for (const copy of computation.copies) {
      for (const relative of copy.keys()) if (!files.has(relative)) gone.add(relative)
    }
    const removals = [...gone].map((relative) => treeTarget(directory, relative))
    const entryRemovals = computation.entryRemovals.map((relative) => treeTarget(directory, relative))
    for (const target of entryRemovals) await removeCheckedOutEntry(target)
    await writeWorkspaceTree(directory, files)
    for (const target of removals) await rm(target, { force: true })
  }

  /** `git merge --abort`, for a merge git still knows about; the reset that follows is what clears anything else. */
  private async abortGitMerge(directory: string): Promise<void> {
    try {
      await this.git.mergeAbort(directory)
    } catch (error) {
      if (!(error instanceof GitError)) throw error
      // "There is no merge to abort": the commit never started one.
    }
  }

  /** Whether the clone still holds all three commits the merge is between. */
  private async holdsCommits(directory: string, merge: WorkspaceMerge): Promise<boolean> {
    const revs = await Promise.all([merge.baseCommit, merge.ourCommit, merge.theirCommit].map((rev) => this.git.revParse(directory, rev)))
    return revs.every((rev) => rev !== undefined)
  }

  /** A commit or a merge that would move HEAD while the user's merge is waiting: refuse, and keep the merge. */
  private assertNotMerging(workspaceId: string): void {
    if (this.repositories.workspaceGit.get(workspaceId)?.state === "merging") throw new ConflictError(COMMIT_WHILE_MERGING_MESSAGE)
  }

  /** Whether the workspace's repositories announced a write its last commit did not include. */
  private uncommittedWrites(workspaceId: string): boolean {
    return (this.writes.get(workspaceId) ?? 0) !== (this.committedWrites.get(workspaceId) ?? 0)
  }

  /**
   * Put a clone that was moved past its database back where the database
   * still is, without masking the error that called for it. A rollback that
   * fails leaves `integratingFrom` set, so the next call that would serialize
   * the workspace retries it first. An unborn local history has nothing to go
   * back to.
   */
  private async rollBackTo(workspaceId: string, directory: string, rev: string | undefined): Promise<void> {
    if (rev === undefined) {
      log.warn(`workspace ${workspaceId} has no commit to move its clone back to after a failed import`)
      return
    }
    try {
      await this.returnTo(workspaceId, directory, rev)
    } catch (error) {
      log.warn(`could not move the clone of workspace ${workspaceId} back to ${rev} after a failed import; the next cycle retries`, error)
    }
  }

  /**
   * A clone an integration moved and whose import never committed — the app
   * crashed or quit in between, or a rollback failed — goes back to the commit
   * the database holds before anything is serialized over it. Throws when
   * that fails: the caller must stop, and the next attempt retries. A clone
   * that is gone has nothing to go back; the next commit recreates it from
   * the database.
   */
  private async returnToDatabase(workspaceId: string, directory: string): Promise<void> {
    const from = this.repositories.workspaceGit.get(workspaceId)?.integratingFrom ?? null
    if (from === null) return
    if (!(await isRepository(directory))) {
      this.repositories.workspaceGit.setIntegratingFrom(workspaceId, null)
      return
    }
    log.warn(`the clone of workspace ${workspaceId} moved without its import; moving it back to ${from}`)
    await this.returnTo(workspaceId, directory, from)
  }

  /**
   * The clone back on `rev`, where the database is; the mark goes only once it
   * is there. `reset --hard` keeps what git does not track, and a merge that
   * stopped between writing its tree and staging it leaves the remote's files
   * untracked — a README the next `add` would commit as this device's change.
   * So every untracked file goes too. That loses nothing: the clone is the
   * app's own, `.git` is never touched, and the only other files ever written
   * there are the database's records, which every commit writes afresh from
   * the database before it stages anything.
   */
  private async returnTo(workspaceId: string, directory: string, rev: string): Promise<void> {
    await this.git.resetHard(directory, rev)
    await this.git.clean(directory, ["."])
    this.repositories.workspaceGit.setIntegratingFrom(workspaceId, null)
  }

  /** Whether HEAD is already the remote branch's tip (or there is no HEAD): then there is nothing to push. */
  private async remoteHoldsHead(directory: string, branch: string): Promise<boolean> {
    const head = await this.git.revParse(directory, "HEAD")
    return head === undefined || head === (await this.git.revParse(directory, `${ORIGIN}/${branch}`))
  }

  /**
   * Push, coming back with the error only for a non-fast-forward: that
   * rejection is the one a retry can settle. A permission refusal comes out as
   * {@link PushRefusedError}, the one failure that makes a workspace read-only.
   */
  private async pushOnce(directory: string, branch: string): Promise<GitNonFastForwardError | undefined> {
    try {
      await this.git.push(directory, ORIGIN, branch)
      return undefined
    } catch (error) {
      if (error instanceof GitNonFastForwardError) return error
      if (error instanceof GitPermissionDeniedError) throw new PushRefusedError(error)
      throw error
    }
  }

  /** The remote now holds our HEAD, so the push is what made the two agree; having sent commits, it also proves the host accepts this user again. */
  private async recordPushed(workspaceId: string, directory: string): Promise<void> {
    const head = await this.git.revParse(directory, "HEAD")
    if (head === undefined) return
    this.repositories.workspaceGit.setReadOnly(workspaceId, false)
    this.recordSynced(workspaceId, head)
  }

  /** Where the two last agreed: the remote commit this cycle integrated or pushed, and when. */
  private recordSynced(workspaceId: string, commit: string): void {
    this.repositories.workspaceGit.recordSynced(workspaceId, commit, new Date().toISOString())
  }

  /**
   * Apply the tree the clone holds now to the database, in one transaction —
   * what a fast-forward or a discard left there. Warnings are the importer's
   * withheld-credential notes, which only an open surfaces to the user.
   *
   * With `unlessWritten`, a write the last commit does not hold makes it apply
   * nothing and resolve false. Reading the tree is the last await, so nothing
   * can land between that check and the transaction; the writes the import
   * announces are then the clone's tree, and count as committed.
   *
   * The transaction also clears `integratingFrom`: the database and the clone
   * agree again at the same instant the import commits.
   */
  private async importRemoteTree(workspaceId: string, directory: string, unlessWritten = false): Promise<boolean> {
    const snapshot = parseWorkspace(await readWorkspaceTree(directory))
    if (unlessWritten && this.uncommittedWrites(workspaceId)) return false
    const { workspaces, collections, workflows, environments, workspaceGit } = this.repositories
    const warnings = workspaces.transaction(() => {
      const applied = new WorkspaceRepoImporter(workspaces, collections, workflows, environments).apply(workspaceId, snapshot)
      workspaceGit.setIntegratingFrom(workspaceId, null)
      // Any import lands the tree the merge was waiting on (or a discard's):
      // whatever a merge row said about conflicts no longer has a subject.
      workspaceGit.clearMerge(workspaceId)
      return applied
    })
    this.committedWrites.set(workspaceId, this.writes.get(workspaceId) ?? 0)
    for (const warning of warnings) log.warn(`import of workspace ${workspaceId}: ${warning}`)
    try {
      this.options.onImported?.(workspaceId)
    } catch (error) {
      log.error("import observer failed for workspace", workspaceId, error)
    }
    return true
  }

  /**
   * Serialize the workspace into its clone and commit what changed; undefined
   * when nothing did. Either way, the write count it serialized is recorded:
   * what arrives after that read is what {@link uncommittedWrites} reports.
   */
  private async writeAndCommit(workspaceId: string, directory: string, message?: string): Promise<string | undefined> {
    // Read and serialized synchronously, so the commit holds one consistent state of the database.
    const seen = this.writes.get(workspaceId) ?? 0
    await writeWorkspaceTree(directory, serializeWorkspace(workspaceSnapshot(this.records(workspaceId))))
    await this.git.add(directory, ["."])
    const { entries } = await this.git.status(directory)
    const subject = message?.trim() ?? ""
    const sha = entries.length === 0 ? undefined : await this.git.commit(directory, subject === "" ? describeChanges(entries) : subject)
    this.committedWrites.set(workspaceId, seen)
    return sha
  }

  /**
   * What a commit would hold, set against what HEAD holds, with nothing
   * written: the clone moved back to the database first, as every cycle does
   * before it serializes, then the database serialized exactly as a commit
   * would and the files of HEAD listed. The clone, its index and the write
   * counters are not touched. An unborn HEAD holds no files.
   */
  private async treeAgainstHead(
    workspaceId: string,
    directory: string,
    branch: string,
  ): Promise<{ readonly tree: ReadonlyMap<string, string>; readonly head: readonly GitTreeEntry[] }> {
    await this.prepareClone(workspaceId, directory, branch, {})
    const tree = serializeWorkspace(workspaceSnapshot(this.records(workspaceId)))
    const head = (await this.git.revParse(directory, "HEAD")) === undefined ? [] : await this.git.lsTree(directory, "HEAD", FORMAT_PATHS)
    return { tree, head }
  }

  /**
   * After a restart the write counters say nothing about edits made before the
   * quit — a manual workspace's wait for a commit, and so do an automatic
   * one's when its startup commit failed — so ask whether the database holds
   * any the last commit does not, and count them as writes the last commit
   * lacks. Compared in memory, writing nothing. A report, never a failure of
   * the startup.
   */
  private async seedUncommitted(workspaceId: string, directory: string, branch: string): Promise<void> {
    try {
      if (this.uncommittedWrites(workspaceId)) return
      const { tree, head } = await this.treeAgainstHead(workspaceId, directory, branch)
      if (diffTrees(tree, head).length > 0) this.writes.set(workspaceId, (this.writes.get(workspaceId) ?? 0) + 1)
    } catch (error) {
      log.warn(`could not tell whether workspace ${workspaceId} has uncommitted edits`, error)
    }
  }

  /** A cycle is starting: `syncing`, keeping a read-only workspace's refusal — the cycle's outcome may replace it, starting does not. */
  private markSyncing(workspaceId: string): void {
    this.repositories.workspaceGit.setState(workspaceId, "syncing", this.keptRefusal(workspaceId))
  }

  /** The workspace came to rest: `idle`, with `lastError` cleared but for a read-only workspace's refusal. */
  private settleIdle(workspaceId: string): void {
    if (this.repositories.workspaceGit.get(workspaceId) === undefined) return
    this.repositories.workspaceGit.setState(workspaceId, "idle", this.keptRefusal(workspaceId))
  }

  /**
   * The refusal a read-only workspace's message explains, which only a
   * successful push can clear (§3.5): that push is what proves the host
   * accepts this user again. Any other message — a failed fetch that replaced
   * it — is about one cycle, and goes when a later one succeeds.
   */
  private keptRefusal(workspaceId: string): WorkspaceGitError | null {
    const binding = this.repositories.workspaceGit.get(workspaceId)
    return binding?.readOnly === true && binding.lastError?.code === "permission_denied" ? binding.lastError : null
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
      void this.autoSync(workspaceId)
    }, this.delayMs))
  }

  private cancelAutoCommit(workspaceId: string): void {
    const timer = this.timers.get(workspaceId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.timers.delete(workspaceId)
  }

  /**
   * After a merge ends — resolved, abandoned, dropped with its remote — the
   * edits it held back are no longer anyone's to commit: auto mode schedules
   * the commit their own writes could not while the workspace was `merging`.
   */
  private resumeAutoCommit(workspaceId: string): void {
    const binding = this.repositories.workspaceGit.get(workspaceId)
    if (this.disposed || binding?.mode !== "auto" || binding.state === "merging" || !this.uncommittedWrites(workspaceId)) return
    this.scheduleAutoCommit(workspaceId)
  }

  /**
   * The timer's cycle. Its failure is already the workspace's `lastError`;
   * there is no caller to throw to. A waiting merge commits nothing over it,
   * and an abandoned one still commits locally — only merging again and
   * pushing wait for Sync now.
   */
  private async autoSync(workspaceId: string): Promise<void> {
    try {
      await this.exclusive(workspaceId, async () => {
        // The mode can have changed, or the workspace been untracked, while this waited for the lock.
        const binding = this.repositories.workspaceGit.get(workspaceId)
        if (this.disposed || binding?.mode !== "auto" || binding.state === "merging") return
        const directory = this.cloneDir(workspaceId)
        if (binding.state === "diverged") await this.commitCycle(workspaceId, directory)
        else await this.syncCycle(workspaceId, directory, {}, !binding.readOnly)
      })
    } catch (error) {
      log.warn(`auto sync failed for workspace ${workspaceId}`, error)
    }
  }

  /** The workspace was deleted: its row went with it (ON DELETE CASCADE), and its clone goes now. */
  private forget(workspaceId: string): void {
    this.cancelAutoCommit(workspaceId)
    this.writes.delete(workspaceId)
    this.committedWrites.delete(workspaceId)
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

  /**
   * Compute the workspace's status and tell the observer. Announces of one
   * workspace run one at a time, in the order they were asked for, each
   * computing its status when its turn comes: a slower one can never emit
   * after a later one with the older picture, so the last status emitted is
   * the latest row's. They take no workspace lock, so one waits only for
   * another announce, never for a cycle.
   */
  private announce(workspaceId: string): Promise<WorkspaceGitStatus> {
    return enqueue(this.announceChains, workspaceId, async () => {
      const status = await this.status(workspaceId)
      try {
        this.options.onStatusChanged?.(status)
      } catch (error) {
        log.error("status observer failed for workspace", workspaceId, error)
      }
      return status
    })
  }

  /** Run `work` after everything already queued for the workspace, and before anything queued after it. */
  private exclusive<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    return enqueue(this.locks, workspaceId, work)
  }

  /** The workspace's clone. The id becomes a path, so it must be an id and nothing path-like. */
  private cloneDir(workspaceId: string): string {
    if (!RecordIdSchema.safeParse(workspaceId).success) throw new ValidationError(`'${workspaceId}' is not a workspace id`)
    return path.join(this.options.cloneRoot, workspaceId)
  }
}

/**
 * A push the host refused for this user: what makes a workspace read-only
 * (§3.5). The same refusal from a fetch is an ordinary error — it says the
 * remote cannot be read, not that it cannot be written.
 */
class PushRefusedError extends Error {
  readonly refusal: GitPermissionDeniedError

  constructor(refusal: GitPermissionDeniedError) {
    super(refusal.message)
    this.name = new.target.name
    this.refusal = refusal
  }
}

/**
 * Run `work` after everything already queued under `key`, and before anything
 * queued after it. `queues` holds each key's tail, which never rejects, and
 * drops it once nothing follows.
 */
function enqueue<T>(queues: Map<string, Promise<void>>, key: string, work: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).then(work)
  const tail = result.then(() => undefined, () => undefined)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return result
}

/** What an untracked workspace reports: the defaults a track would start from. */
function untrackedStatus(workspaceId: string): WorkspaceGitStatus {
  return {
    workspaceId,
    tracked: false,
    mode: "auto",
    remoteUrl: null,
    branch: "main",
    state: "idle",
    lastError: null,
    readOnly: false,
    incoming: 0,
    outgoing: 0,
    uncommitted: false,
    lastSyncedAt: null,
    lastCommit: null,
  }
}

/** The id a record file is named after (`<folder>/<slug>--<id>.json`), or undefined for a file that is not one. */
function recordIdOfFile(relative: string): string | undefined {
  const match = /--([A-Za-z0-9_][A-Za-z0-9_-]*)\.json$/.exec(relative)
  return match?.[1]
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

/**
 * The merge commit's message. Its subject says what happened; the body names
 * what the merge settled by itself — positions both copies moved, a dropped
 * edge — so the user can see why the result is not either copy.
 */
function mergeCommitMessage(notes: readonly GitMergeNote[], named?: string): string {
  const subject = named?.trim() || "Merge the remote's changes"
  if (notes.length === 0) return subject
  return [subject, "", "Settled by the merge:", ...notes.map((note) => `- ${describeMergeNote(note)}`)].join("\n")
}

/**
 * The failures that say only that the remote could not be reached or read —
 * what a later good fetch proves over. A push can fail these ways too; its
 * commits then still show as outgoing, and the next push retries them.
 */
const REACH_FAILURES: ReadonlySet<GitErrorCode> = new Set<GitErrorCode>([
  "network_error",
  "auth_failed",
  "timeout",
  "permission_denied",
  "git_not_installed",
])

function isReachFailure(error: WorkspaceGitError): boolean {
  return error.code !== null && REACH_FAILURES.has(error.code)
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
