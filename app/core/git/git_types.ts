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
  | "resetHard"
  | "log"
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
