// fallow-ignore-file code-duplication -- a pure types module: its interfaces are runs of `readonly field: type` lines by nature, and the run shared with an unrelated repository interface is suffix-array coincidence, not behaviour to extract.
import type { GitIdentity } from "@shared/types/GitIdentity"

export type GitCommand =
  | "version"
  | "init"
  | "status"
  | "add"
  | "commit"
  | "revParse"
  | "mergeBase"
  | "forEachRef"
  | "show"
  | "fetch"
  | "push"
  | "clone"
  | "remote"
  | "mergeAbort"
  | "mergeFastForward"
  | "mergeNoCommit"
  | "resetHard"
  | "revList"
  | "log"
  | "lsTree"
  | "catFile"
  | "clean"
  | "config"

export type { GitIdentity }

export interface GitVersion {
  /** The text after `git version `, e.g. `2.55.0.windows.4` or `2.39.5 (Apple Git-154)`. */
  readonly raw: string
  readonly major: number
  readonly minor: number
  readonly patch: number
}

export type GitStatusEntryKind = "changed" | "renamed" | "unmerged" | "untracked"

export interface GitStatusEntry {
  readonly kind: GitStatusEntryKind
  readonly path: string
  /** The path before the rename; set only for `renamed`. */
  readonly origPath: string | undefined
  /** Porcelain `X` column: the index state, `.` when unchanged, `?` when untracked. */
  readonly index: string
  /** Porcelain `Y` column: the working-tree state, `.` when unchanged, `?` when untracked. */
  readonly worktree: string
}

export interface GitStatus {
  /** Undefined while HEAD is detached. */
  readonly branch: string | undefined
  /** The commit HEAD points at; undefined before the first commit. */
  readonly oid: string | undefined
  readonly upstream: string | undefined
  readonly ahead: number
  readonly behind: number
  readonly entries: readonly GitStatusEntry[]
  readonly clean: boolean
}

/** One file of a commit's tree: its path, and the id of the blob that holds its bytes. */
export interface GitTreeEntry {
  readonly path: string
  readonly oid: string
}

/**
 * One entry of a recursive `ls-tree -l`, whatever it is: a file, a symbolic
 * link or a submodule's commit, told apart by `mode` and `type`, with the size
 * git reports for a blob — so a reader can refuse what is not a plain file, and
 * an oversized tree, before reading it.
 */
export interface GitTreeListing extends GitTreeEntry {
  /** `100644` or `100755` for a file, `120000` for a symbolic link, `160000` for a submodule. */
  readonly mode: string
  /** `blob`, or `commit` for a submodule. */
  readonly type: string
  /** Zero for what is not a blob, which git gives no size. */
  readonly size: number
}

/** The most a committed tree may hold before it is refused unread: the same caps the checkout walk enforces. */
export interface GitTreeLimits {
  /** At most this many files. */
  readonly maxFiles: number
  /** At most this many bytes in total. */
  readonly maxTotalBytes: number
  /** At most this many bytes in one file. */
  readonly maxFileBytes: number
}

/** How two revisions stand apart: each side's commits the other does not reach. */
export interface GitAheadBehind {
  /** Commits the first revision has that the second does not. */
  readonly ahead: number
  /** Commits the second revision has that the first does not. */
  readonly behind: number
}

export interface GitLogOptions {
  /** A revision or range; defaults to `HEAD`. */
  readonly rev?: string
  readonly maxCount?: number
  /** Restrict the log to commits touching this path. */
  readonly path?: string
}

export interface GitServiceOptions {
  /** An empty directory handed to `core.hooksPath`, so no hook ever runs. The caller owns it. */
  readonly hooksDir: string
  /** The git executable; defaults to `git`, resolved through the child's PATH. */
  readonly gitPath?: string
  /** The environment git inherits; defaults to `process.env` as of construction. */
  readonly env?: NodeJS.ProcessEnv
  /** Picks the install link in {@link GitNotInstalledError}; defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform
  /** The author and committer of `commit`, for a machine with no `user.name`/`user.email`. */
  readonly identity?: GitIdentity
  /** Per-command timeouts in milliseconds, replacing the defaults. */
  readonly timeouts?: Partial<Record<GitCommand, number>>
}

export interface GitLogEntry {
  readonly sha: string
  readonly parents: readonly string[]
  readonly authorName: string
  readonly authorEmail: string
  /** Strict ISO 8601, as `%aI` prints it. */
  readonly authorDate: string
  readonly subject: string
  /** As git stores it, trailing newline and blank lines included. */
  readonly body: string
}
