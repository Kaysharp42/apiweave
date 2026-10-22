import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { assertRefName, assertRevision, assertSafeRemoteUrl } from "./git_arguments"
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
import { LOG_FORMAT, parseLog, parseStatus, parseVersion } from "./git_parse"
import { execGit, gitConfigArgs, gitEnvironment, timeoutFor, type GitExecOutcome } from "./git_process"
import type {
  GitCommand,
  GitIdentity,
  GitLogEntry,
  GitLogOptions,
  GitServiceOptions,
  GitStatus,
  GitVersion,
} from "./git_types"

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

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory()
  } catch {
    return false
  }
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

  async mergeAbort(repoDir: string): Promise<void> {
    await this.run("mergeAbort", ["merge", "--abort"], repoDir)
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

  private async remoteCommand(repoDir: string, action: "add" | "set-url", name: string, url: string): Promise<void> {
    assertRefName(name)
    assertSafeRemoteUrl(url)
    await this.run("remote", ["remote", action, "--", name, url], repoDir)
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

  private async run(command: GitCommand, args: readonly string[], cwd?: string): Promise<string> {
    const timeoutMs = timeoutFor(command, this.timeouts)
    const outcome = await execGit(this.gitPath, [...this.configArgs, ...args], { cwd, env: this.env, timeoutMs })
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
