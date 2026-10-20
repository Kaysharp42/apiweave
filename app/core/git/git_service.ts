import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { ValidationError } from "../ipc/errors"
import { assertObjectId, assertRefName, assertRevision, assertSafeRemoteUrl } from "./git_arguments"
import { gitFailure } from "./git_classify"
import {
  GitCommandError,
  GitInvalidArgumentError,
  GitNotARepositoryError,
  GitNotInstalledError,
  GitTimeoutError,
  failureDetails,
  gitInstallUrl,
  type GitError,
  type GitFailureDetails,
} from "./git_errors"
import {
  LOG_FORMAT,
  parseAheadBehind,
  parseBlobBatch,
  parseCommitCount,
  parseLog,
  parseStatus,
  parseTreeEntries,
  parseTreeListings,
  parseVersion,
} from "./git_parse"
import { execGit, gitConfigArgs, gitEnvironment, timeoutFor, type GitExecOutcome } from "./git_process"
import type {
  GitAheadBehind,
  GitCommand,
  GitIdentity,
  GitLogEntry,
  GitLogOptions,
  GitServiceOptions,
  GitStatus,
  GitTreeBlob,
  GitTreeEntry,
  GitTreeLimits,
  GitVersion,
} from "./git_types"

/** A `cat-file --batch` at most this large stays well inside the process output cap; the caps keep the whole tree below 100 MB. */
const TREE_BATCH_BYTES = 32 * 1024 * 1024
const TREE_BATCH_FILES = 512

const NOTHING_TO_COMMIT = /nothing (?:added )?to commit|no changes added to commit/i
const PATH_NOT_IN_REVISION = /does not exist in|exists on disk, but not in/i
const NO_COMMITS_YET = /does not have any commits yet|ambiguous argument 'HEAD': unknown revision/i

function isFailure(error: unknown, test: (error: GitCommandError) => boolean): boolean {
  return error instanceof GitCommandError && test(error)
}

/** `rev-parse --verify --quiet` and `merge-base` say "no such thing" by exiting 1 without a word. */
function isSilentExit(error: GitCommandError): boolean {
  return error.details.exitCode === 1 && error.details.stderr.trim() === ""
}

/** git refuses an ident with angle brackets or a line break in it, and one that is empty after trimming. */
function checkedIdentityField(field: "name" | "email", value: string): string {
  const trimmed = value.trim()
  if (trimmed === "" || /[<>\r\n\0]/.test(trimmed)) {
    throw new GitInvalidArgumentError(`a commit author's ${field} must be non-empty, on one line, without '<' or '>'`)
  }
  return trimmed
}

/** What a parser made of git's output, or the failure that output is when it made nothing. */
function parsedOrFailure<T>(command: string, args: readonly string[], parsed: T | undefined): T {
  if (parsed === undefined) {
    throw new GitCommandError(`unexpected output from git ${command}`, failureDetails(args, 0, "", ""))
  }
  return parsed
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory()
  } catch {
    return false
  }
}

/** Split tree entries into batches a `cat-file` can hold: by file count and by the blobs' own sizes. */
function batchesBySize(entries: readonly GitTreeBlob[]): GitTreeBlob[][] {
  const batches: GitTreeBlob[][] = []
  let batch: GitTreeBlob[] = []
  let bytes = 0
  for (const entry of entries) {
    if (batch.length > 0 && (batch.length >= TREE_BATCH_FILES || bytes + entry.size > TREE_BATCH_BYTES)) {
      batches.push(batch)
      batch = []
      bytes = 0
    }
    batch.push(entry)
    bytes += entry.size
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

/**
 * Git through `execFile`, with no shell. Every invocation carries the
 * configuration and environment of {@link gitConfigArgs} and
 * {@link gitEnvironment}; positional arguments follow a `--`, or, for
 * revisions, are checked not to be options. Electron-free: everything it
 * depends on arrives through the options.
 *
 * What is disabled is what a *repository* controls: hooks (`core.hooksPath`
 * points at an empty directory), `fsmonitor`, `core.autocrlf`, the `ext::`
 * transport, and git's own interactive prompts (`GIT_TERMINAL_PROMPT=0`,
 * `credential.interactive=auto`). A cloned repository therefore cannot make
 * this service run anything of its own.
 *
 * What is deliberately inherited is the *user's* authentication: their ssh
 * configuration and their credential helper. Those are how this app
 * authenticates, so no `GIT_SSH_COMMAND` or `core.sshCommand` is set here —
 * forcing one would shadow the user's own and break their remotes. A helper
 * that hangs is bounded by the per-command timeout, which kills the tree.
 */
export class GitService {
  private readonly gitPath: string
  private readonly env: NodeJS.ProcessEnv
  private readonly configArgs: readonly string[]
  private readonly installUrl: string
  private readonly identity: GitIdentity | undefined
  private readonly timeouts: Partial<Record<GitCommand, number>>

  constructor(options: GitServiceOptions) {
    this.gitPath = options.gitPath ?? "git"
    this.env = gitEnvironment(options.env ?? process.env)
    this.configArgs = gitConfigArgs(options.hooksDir)
    this.installUrl = gitInstallUrl(options.platform ?? process.platform)
    this.identity = options.identity
    this.timeouts = options.timeouts ?? {}
  }

  /** Throws {@link GitNotInstalledError} when git is absent; on macOS the command-line-tools stub counts as absent until `git version` works. */
  async version(): Promise<GitVersion> {
    const stdout = await this.run("version", ["version"])
    const version = parseVersion(stdout)
    if (version === undefined) {
      throw new GitCommandError(`unexpected output from git version: ${stdout.trim()}`, failureDetails(["version"], 0, stdout, ""))
    }
    return version
  }

  async init(directory: string, options: { readonly initialBranch?: string } = {}): Promise<void> {
    const branch = options.initialBranch
    if (branch !== undefined) {
      assertRefName(branch)
    }
    await mkdir(directory, { recursive: true })
    await this.run("init", branch === undefined ? ["init"] : ["init", `--initial-branch=${branch}`], directory)
  }

  async status(repoDir: string): Promise<GitStatus> {
    const stdout = await this.run(
      "status",
      ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
      repoDir,
    )
    return parseStatus(stdout)
  }

  /** Stage the paths, deletions included. Pass `["."]` for everything. */
  async add(repoDir: string, paths: readonly string[]): Promise<void> {
    if (paths.length === 0) {
      throw new GitInvalidArgumentError("add needs at least one path")
    }
    await this.run("add", ["add", "--all", "--", ...paths], repoDir)
  }

  /** The new commit's sha, or undefined when there was nothing to commit. */
  async commit(
    repoDir: string,
    message: string,
    options: { readonly allowEmpty?: boolean } = {},
  ): Promise<string | undefined> {
    const args = [...this.identityArgs(), "commit", "--no-gpg-sign"]
    if (options.allowEmpty === true) {
      args.push("--allow-empty")
    }
    try {
      await this.run("commit", [...args, "-m", message], repoDir)
    } catch (error) {
      // "Nothing to commit" is printed on stdout, with exit 1.
      if (isFailure(error, (failure) => NOTHING_TO_COMMIT.test(failure.details.stdout))) {
        return undefined
      }
      throw error
    }
    return this.revParse(repoDir, "HEAD")
  }

  /** The full sha `rev` names, or undefined when it names nothing (an unborn HEAD included). */
  async revParse(repoDir: string, rev: string): Promise<string | undefined> {
    assertRevision(rev)
    return this.runOptional("revParse", ["rev-parse", "--verify", "--quiet", rev], repoDir)
  }

  /** The best common ancestor, or undefined when the histories are unrelated. */
  async mergeBase(repoDir: string, a: string, b: string): Promise<string | undefined> {
    assertRevision(a)
    assertRevision(b)
    return this.runOptional("mergeBase", ["merge-base", a, b], repoDir)
  }

  /**
   * How many commits each side holds that the other does not, in one
   * invocation: `ahead` counts `local`'s commits, `behind` counts `other`'s.
   * Zeros when either revision names nothing — an unborn HEAD, or a branch the
   * remote has not got yet — because git's `--ignore-missing` drops it from
   * the comparison rather than failing.
   */
  async countAheadBehind(repoDir: string, local: string, other: string): Promise<GitAheadBehind> {
    assertRevision(local)
    assertRevision(other)
    return this.revList(repoDir, ["rev-list", "--left-right", "--count", "--ignore-missing", `${local}...${other}`, "--"], parseAheadBehind)
  }

  /**
   * How many commits `rev` reaches. The caller checks that `rev` names
   * something first: `rev-list` fails on an unborn HEAD rather than counting
   * zero for it.
   */
  async countCommits(repoDir: string, rev: string): Promise<number> {
    assertRevision(rev)
    return this.revList(repoDir, ["rev-list", "--count", rev, "--"], parseCommitCount)
  }

  /** A `git rev-list` whose output `parse` must accept: anything else is a failure, not a count. */
  private async revList<T>(repoDir: string, args: string[], parse: (output: string) => T | undefined): Promise<T> {
    const stdout = await this.run("revList", args, repoDir)
    const parsed = parse(stdout)
    if (parsed === undefined) {
      throw new GitCommandError(`unexpected output from git rev-list: ${stdout.trim()}`, failureDetails(args, 0, stdout, ""))
    }
    return parsed
  }

  /** One branch fetched from `remote` (`refs/remotes/<remote>/…`), or undefined when it has none: what tells an empty remote from one with other branches. */
  async firstRemoteRef(repoDir: string, remote: string): Promise<string | undefined> {
    assertRefName(remote)
    const ref = await this.run(
      "forEachRef",
      ["for-each-ref", "--count=1", "--format=%(refname)", `refs/remotes/${remote}/`],
      repoDir,
    )
    return ref.trim() === "" ? undefined : ref.trim()
  }

  /** The file as stored at `rev` (`git show <rev>:<path>`), or undefined when `rev` has no such path. */
  async show(repoDir: string, rev: string, filePath: string): Promise<string | undefined> {
    assertRevision(rev)
    try {
      return await this.run("show", ["show", `${rev}:${filePath}`], repoDir)
    } catch (error) {
      if (isFailure(error, (failure) => PATH_NOT_IN_REVISION.test(failure.details.stderr))) {
        return undefined
      }
      throw error
    }
  }

  /**
   * The files `rev`'s tree holds under `paths`, recursively, with the id of the
   * blob behind each. A revision that names nothing — an unborn HEAD — is git's
   * own failure: the caller asks `revParse` first.
   */
  async lsTree(repoDir: string, rev: string, paths: readonly string[]): Promise<GitTreeEntry[]> {
    assertRevision(rev)
    if (paths.length === 0) {
      throw new GitInvalidArgumentError("ls-tree needs at least one path")
    }
    const args = ["ls-tree", "-r", "-z", rev, "--", ...paths]
    return parsedOrFailure("ls-tree", args, parseTreeEntries(await this.run("lsTree", args, repoDir)))
  }

  /**
   * The text of every blob in `oids`, by id, read by one `git cat-file --batch`
   * however many there are; an id the repository lacks maps to undefined. The
   * ids are checked before they reach git's stdin, and the output is capped
   * like `show`'s.
   */
  async readBlobs(repoDir: string, oids: readonly string[]): Promise<Map<string, string | undefined>> {
    const unique = [...new Set(oids)]
    for (const oid of unique) {
      assertObjectId(oid)
    }
    if (unique.length === 0) {
      return new Map()
    }
    const args = ["cat-file", "--batch"]
    const output = await this.run("catFile", args, repoDir, `${unique.join("\n")}\n`)
    return parsedOrFailure("cat-file", args, parseBlobBatch(output, unique))
  }

  /**
   * Every file of `rev`'s committed tree, path to text — what the working tree
   * would hold after checking it out, without touching the working tree. This
   * is how a merge reads the ancestor and both sides: the database is committed
   * first, so the committed tree is the truth about "ours", never the checkout.
   *
   * `ls-tree -r -l` reports each blob's size, so the caps are enforced before a
   * byte is read: a tree over them is refused with {@link ValidationError}, the
   * same classified refusal the checkout walk gives. Blobs then arrive in
   * bounded batches — by count and by their own sizes — so one `cat-file` never
   * has to hold a tree the process cannot buffer.
   */
  async readTreeFiles(repoDir: string, rev: string, limits: GitTreeLimits): Promise<Map<string, string>> {
    assertRevision(rev)
    const args = ["ls-tree", "-r", "-l", "-z", rev, "--", "."]
    const entries = parsedOrFailure("ls-tree", args, parseTreeListings(await this.run("lsTree", args, repoDir)))
    if (entries.length > limits.maxFiles) {
      throw new ValidationError(`the tree at ${rev} holds ${entries.length} files; at most ${limits.maxFiles} are read`)
    }
    let totalBytes = 0
    for (const entry of entries) {
      if (entry.size > limits.maxFileBytes) {
        throw new ValidationError(`${entry.path} at ${rev} is ${entry.size} bytes; at most ${limits.maxFileBytes} are read from one file`)
      }
      totalBytes += entry.size
      if (totalBytes > limits.maxTotalBytes) {
        throw new ValidationError(
          `${entry.path} pushes the tree at ${rev} over its ${limits.maxTotalBytes}-byte limit (${totalBytes} bytes in total); at most ${limits.maxTotalBytes} are read`,
        )
      }
    }
    const files = new Map<string, string>()
    for (const batch of batchesBySize(entries)) {
      const blobs = await this.readBlobs(repoDir, batch.map((entry) => entry.oid))
      for (const entry of batch) {
        const text = blobs.get(entry.oid)
        if (text === undefined) throw new GitCommandError(`the blob for ${entry.path} at ${rev} is missing`, failureDetails(args, 0, "", ""))
        files.set(entry.path, text)
      }
    }
    return files
  }

  /** Delete the untracked files and folders under `paths`; tracked files and ignored ones stay. */
  async clean(repoDir: string, paths: readonly string[]): Promise<void> {
    if (paths.length === 0) {
      throw new GitInvalidArgumentError("clean needs at least one path")
    }
    await this.run("clean", ["clean", "-f", "-d", "-q", "--", ...paths], repoDir)
  }

  async fetch(repoDir: string, remote: string): Promise<void> {
    assertRefName(remote)
    await this.run("fetch", ["fetch", "--prune", "--", remote], repoDir)
  }

  async push(
    repoDir: string,
    remote: string,
    branch: string,
    options: { readonly setUpstream?: boolean } = {},
  ): Promise<void> {
    assertRefName(remote)
    assertRefName(branch)
    const flags = options.setUpstream === true ? ["--set-upstream"] : []
    await this.run("push", ["push", ...flags, "--", remote, branch], repoDir)
  }

  /** Clone into `destination`, whose parent is created if missing. */
  async clone(url: string, destination: string, options: { readonly branch?: string } = {}): Promise<void> {
    assertSafeRemoteUrl(url)
    const branch = options.branch
    if (branch !== undefined) {
      assertRefName(branch)
    }
    const parent = path.dirname(destination)
    await mkdir(parent, { recursive: true })
    const flags = branch === undefined ? [] : [`--branch=${branch}`]
    await this.run("clone", ["clone", ...flags, "--", url, path.basename(destination)], parent)
  }

  async remoteAdd(repoDir: string, name: string, url: string): Promise<void> {
    await this.remoteCommand(repoDir, "add", name, url)
  }

  async remoteSetUrl(repoDir: string, name: string, url: string): Promise<void> {
    await this.remoteCommand(repoDir, "set-url", name, url)
  }

  /** Drops the remote and the remote-tracking branches fetched from it. */
  async remoteRemove(repoDir: string, name: string): Promise<void> {
    await this.remoteCommand(repoDir, "remove", name)
  }

  /**
   * Make `identity` the author of this repository's commits, in its own
   * `.git/config` — the repository-local counterpart of the `identity` option,
   * for a machine whose git configuration names nobody.
   */
  async setIdentity(repoDir: string, identity: GitIdentity): Promise<void> {
    const name = checkedIdentityField("name", identity.name)
    const email = checkedIdentityField("email", identity.email)
    await this.run("config", ["config", "--local", "--", "user.name", name], repoDir)
    await this.run("config", ["config", "--local", "--", "user.email", email], repoDir)
  }

  async mergeAbort(repoDir: string): Promise<void> {
    await this.run("mergeAbort", ["merge", "--abort"], repoDir)
  }

  /**
   * Begin a merge of `rev` without touching the working tree or the index:
   * git records the second parent and leaves `MERGE_HEAD`, and the `ours`
   * strategy leaves the tree as it is. The caller writes the merged files over
   * the checkout and commits, which is what turns this into a real two-parent
   * merge commit. `git merge --abort` is the cancel.
   */
  async mergeNoCommit(repoDir: string, rev: string): Promise<void> {
    assertRevision(rev)
    // Identity, like `commit`: even without committing, git prepares the merge
    // commit and refuses a machine with no author configured.
    await this.run("mergeNoCommit", [...this.identityArgs(), "merge", "--no-commit", "--no-ff", "-s", "ours", rev, "--"], repoDir)
  }

  /**
   * Fast-forward the checked-out branch to `rev`, leaving it otherwise alone:
   * a descendant moves the branch, an ancestor (or the same commit) is already
   * up to date, and a sibling is refused.
   */
  async mergeFastForward(repoDir: string, rev: string): Promise<void> {
    assertRevision(rev)
    await this.run("mergeFastForward", ["merge", "--ff-only", rev, "--"], repoDir)
  }

  /** Discard every local change and move the branch to `rev` (default `HEAD`). */
  async resetHard(repoDir: string, rev = "HEAD"): Promise<void> {
    assertRevision(rev)
    await this.run("resetHard", ["reset", "--hard", rev, "--"], repoDir)
  }

  /** Newest first. An unborn branch has no history, not an error. */
  async log(repoDir: string, options: GitLogOptions = {}): Promise<GitLogEntry[]> {
    const rev = options.rev ?? "HEAD"
    assertRevision(rev)
    const args = ["log", "-z", `--format=${LOG_FORMAT}`]
    if (options.maxCount !== undefined) {
      args.push(`--max-count=${options.maxCount}`)
    }
    args.push(rev)
    if (options.path !== undefined) {
      args.push("--", options.path)
    }
    try {
      return parseLog(await this.run("log", args, repoDir))
    } catch (error) {
      if (isFailure(error, (failure) => NO_COMMITS_YET.test(failure.details.stderr))) {
        return []
      }
      throw error
    }
  }

  private async remoteCommand(repoDir: string, action: "add" | "set-url" | "remove", name: string, url?: string): Promise<void> {
    assertRefName(name)
    if (url !== undefined) {
      assertSafeRemoteUrl(url)
    }
    await this.run("remote", ["remote", action, "--", name, ...(url === undefined ? [] : [url])], repoDir)
  }

  private identityArgs(): string[] {
    return this.identity === undefined
      ? []
      : ["-c", `user.name=${this.identity.name}`, "-c", `user.email=${this.identity.email}`]
  }

  /** Run and return trimmed stdout, or undefined for git's silent exit 1. */
  private async runOptional(command: GitCommand, args: readonly string[], cwd: string): Promise<string | undefined> {
    try {
      return (await this.run(command, args, cwd)).trim()
    } catch (error) {
      if (isFailure(error, isSilentExit)) {
        return undefined
      }
      throw error
    }
  }

  private async run(command: GitCommand, args: readonly string[], cwd?: string, input?: string): Promise<string> {
    const timeoutMs = timeoutFor(command, this.timeouts)
    const outcome = await execGit(this.gitPath, [...this.configArgs, ...args], { cwd, env: this.env, timeoutMs, input })
    if (outcome.status === "exited" && outcome.exitCode === 0) {
      return outcome.stdout
    }
    throw await this.failureOf(command, args, cwd, timeoutMs, outcome)
  }

  private async failureOf(
    command: GitCommand,
    args: readonly string[],
    cwd: string | undefined,
    timeoutMs: number,
    outcome: GitExecOutcome,
  ): Promise<GitError> {
    const details = failureDetails(args, outcome.exitCode, outcome.stdout, outcome.stderr)
    if (outcome.status === "timeout") {
      return new GitTimeoutError(`git ${command} timed out after ${timeoutMs} ms`, details)
    }
    if (outcome.status === "exited") {
      return gitFailure(command, details, this.installUrl)
    }
    return this.spawnFailure(outcome.errorCode, cwd, details)
  }

  /** `spawn` reports a missing working directory as ENOENT, exactly as it reports a missing binary. */
  private async spawnFailure(
    errorCode: string | undefined,
    cwd: string | undefined,
    details: GitFailureDetails,
  ): Promise<GitError> {
    if (errorCode !== "ENOENT") {
      return new GitCommandError(`could not start git: ${errorCode ?? "unknown error"}`, details)
    }
    if (cwd !== undefined && !(await isDirectory(cwd))) {
      return new GitNotARepositoryError(`not a git repository: ${cwd} does not exist`, details)
    }
    return new GitNotInstalledError(
      `git is not installed or not on PATH; install it from ${this.installUrl}`,
      details,
      this.installUrl,
    )
  }
}
