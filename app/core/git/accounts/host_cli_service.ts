import os from "node:os"
import type { GitAccountList } from "@shared/types/GitAccountList"
import type { GitAccountRef } from "@shared/types/GitAccountRef"
import type { GitHostCli } from "@shared/types/GitHostCli"
import type { GitProvider } from "@shared/types/GitProvider"
import { GitAccountRefSchema } from "@shared/zod-schemas/GitAccountRefSchema"
import { resolveExecutable, spawnCommandFor } from "../../agents/executable"
import { GitAccountUnavailableError } from "../git_errors"
import { execGit, type GitExecOutcome } from "../git_process"
import type { GitAccountToken } from "../git_types"
import {
  firstLine,
  parseCliVersion,
  parseGhAccounts,
  parseGhToken,
  parseGlabAccounts,
  parseGlabCredential,
  type ParsedAccounts,
} from "./host_cli_parse"

export type HostCliCommand = "gh" | "glab"

export interface HostCliRunOptions {
  /** Written to the tool's stdin before it is closed. */
  readonly input?: string
  readonly timeoutMs: number
}

/** Runs `gh` or `glab` and reports how it went; never rejects. A tool that is not on PATH is a `spawn_failed` with `ENOENT`. */
export type HostCliRunner = (command: HostCliCommand, args: readonly string[], options: HostCliRunOptions) => Promise<GitExecOutcome>

export interface HostCliServiceOptions {
  /** Defaults to {@link hostCliRunner} over `process.env`. */
  readonly run?: HostCliRunner
}

const PROVIDERS: readonly GitProvider[] = ["github", "gitlab"]
const COMMANDS: Readonly<Record<GitProvider, HostCliCommand>> = { github: "gh", gitlab: "glab" }

const VERSION_TIMEOUT_MS = 10_000
/** Both status commands ask the host about every account they hold. */
const STATUS_TIMEOUT_MS = 30_000
const TOKEN_TIMEOUT_MS = 30_000

/** What `glab auth status` says, with no JSON, when it has never signed in anywhere: no accounts, not a failure. */
const GLAB_NO_HOSTS = /no GitLab instances have been authenticated/i

/**
 * Both tools without a terminal to talk to: no prompt, no update notice, no
 * colour codes in what is parsed. A tool's own environment otherwise passes
 * through — its config directory, a proxy, the hydrated login-shell PATH.
 */
const QUIET_ENVIRONMENT = {
  GH_PROMPT_DISABLED: "1",
  GH_NO_UPDATE_NOTIFIER: "1",
  GLAB_NO_PROMPT: "true",
  GLAB_CHECK_UPDATE: "false",
  NO_COLOR: "1",
} as const

const NOT_FOUND: GitExecOutcome = { status: "spawn_failed", exitCode: undefined, errorCode: "ENOENT", stdout: "", stderr: "" }

/**
 * Runs the tool as the user's shell would find it — `process.env`'s PATH,
 * which main hydrates from the login shell before anything starts — with no
 * shell in between; a `.cmd` shim goes through `cmd.exe` escaped, as an agent
 * CLI's does. The working directory is outside any repository: `glab` picks
 * its host from the current directory's git remotes.
 */
export function hostCliRunner(env: NodeJS.ProcessEnv = process.env): HostCliRunner {
  return async (command, args, options) => {
    const executable = resolveExecutable(command, env)
    if (executable === undefined) return NOT_FOUND
    const spawn = spawnCommandFor(executable, args, env)
    return execGit(spawn.file, spawn.args, {
      cwd: os.tmpdir(),
      env: { ...env, ...QUIET_ENVIRONMENT },
      timeoutMs: options.timeoutMs,
      input: options.input,
      verbatim: spawn.verbatim,
    })
  }
}

function succeeded(outcome: GitExecOutcome): boolean {
  return outcome.status === "exited" && outcome.exitCode === 0
}

/** Why a tool did not answer, from stderr alone: stdout is where a token would be. */
function failureText(command: HostCliCommand, outcome: GitExecOutcome): string {
  if (outcome.status === "timeout") return `${command} did not answer in time`
  if (outcome.status === "spawn_failed") {
    return outcome.errorCode === "ENOENT" ? `${command} is not installed` : `${command} could not start (${outcome.errorCode ?? "unknown error"})`
  }
  return firstLine(outcome.stderr) ?? `${command} exited with code ${outcome.exitCode ?? "unknown"}`
}

const STATUS_ARGS: Readonly<Record<GitProvider, readonly string[]>> = {
  github: ["auth", "status", "--json", "hosts"],
  gitlab: ["auth", "status", "--all", "--output", "json"],
}

/**
 * A status command's accounts, or undefined when it printed something else.
 * glab exits non-zero when one host's token fails and still prints every
 * host, so the exit code is not what decides; and a glab that has never
 * signed in prints no JSON at all, which is no accounts rather than a failure.
 */
function parseStatus(provider: GitProvider, outcome: GitExecOutcome): ParsedAccounts | undefined {
  if (outcome.status !== "exited") return undefined
  if (provider === "github") return parseGhAccounts(outcome.stdout)
  return parseGlabAccounts(outcome.stdout) ?? (GLAB_NO_HOSTS.test(outcome.stderr) ? { accounts: [], problems: [] } : undefined)
}

function unavailable(command: HostCliCommand, account: GitAccountRef, reason: string): GitAccountUnavailableError {
  return new GitAccountUnavailableError(`${command} could not sign in to ${account.host} as ${account.login}: ${reason}`)
}

/**
 * The accounts `gh` and `glab` are signed in to, and a token for one of them
 * when a git call needs it. APIWeave stores no token: both tools keep theirs
 * in the OS keyring, and this asks for one per operation, holding it only in
 * memory for the one process it is for. Electron-free, and every process goes
 * through one injectable runner, so a test drives it with a fake.
 */
export class HostCliService {
  private readonly run: HostCliRunner

  constructor(options: HostCliServiceOptions = {}) {
    this.run = options.run ?? hostCliRunner()
  }

  /** Whether each tool is on PATH, and its version. */
  async detect(): Promise<readonly GitHostCli[]> {
    return Promise.all(PROVIDERS.map((provider) => this.detectOne(provider)))
  }

  /**
   * Every account each tool is signed in to. A tool that is missing lists none
   * and says so; one that fails to answer lists none and says why. Neither is
   * an error: the other provider's accounts still come back.
   */
  async listAccounts(): Promise<GitAccountList> {
    const results = await Promise.all((await this.detect()).map((cli) => this.accountsOf(cli)))
    return { clis: results.map((result) => result.cli), accounts: results.flatMap((result) => result.accounts) }
  }

  /**
   * A credential for `account`, for one git call. Throws
   * {@link GitAccountUnavailableError} when the tool is missing, signed out of
   * that account, or — `glab` keeping one account per host — signed in there
   * as someone else.
   */
  async token(account: GitAccountRef): Promise<GitAccountToken> {
    // Only the three fields that name the account: a listed `GitAccount` carries more.
    const checked = GitAccountRefSchema.safeParse({ provider: account.provider, host: account.host, login: account.login })
    if (!checked.success) throw new GitAccountUnavailableError("that is not an account APIWeave can sign in as")
    return checked.data.provider === "github" ? this.githubToken(checked.data) : this.gitlabToken(checked.data)
  }

  private async detectOne(provider: GitProvider): Promise<GitHostCli> {
    const command = COMMANDS[provider]
    const outcome = await this.run(command, ["--version"], { timeoutMs: VERSION_TIMEOUT_MS })
    if (outcome.status === "spawn_failed" && outcome.errorCode === "ENOENT") {
      return { provider, command, missing: true, version: null, problem: null }
    }
    if (!succeeded(outcome)) return { provider, command, missing: false, version: null, problem: failureText(command, outcome) }
    return { provider, command, missing: false, version: parseCliVersion(outcome.stdout) ?? null, problem: null }
  }

  private async accountsOf(cli: GitHostCli): Promise<{ readonly cli: GitHostCli; readonly accounts: ParsedAccounts["accounts"] }> {
    if (cli.missing || cli.problem !== null) return { cli, accounts: [] }
    const outcome = await this.run(cli.command, STATUS_ARGS[cli.provider], { timeoutMs: STATUS_TIMEOUT_MS })
    const parsed = parseStatus(cli.provider, outcome)
    if (parsed === undefined) return { cli: { ...cli, problem: failureText(cli.command, outcome) }, accounts: [] }
    return { cli: { ...cli, problem: parsed.problems.length === 0 ? null : parsed.problems.join("; ") }, accounts: parsed.accounts }
  }

  /** `gh auth token --user` reads that account's token without touching which account is active. */
  private async githubToken(account: GitAccountRef): Promise<GitAccountToken> {
    const outcome = await this.run("gh", ["auth", "token", `--hostname=${account.host}`, `--user=${account.login}`], {
      timeoutMs: TOKEN_TIMEOUT_MS,
    })
    const token = succeeded(outcome) ? parseGhToken(outcome.stdout) : undefined
    if (token === undefined) throw unavailable("gh", account, succeeded(outcome) ? "gh printed no token" : failureText("gh", outcome))
    return { protocol: "https", host: account.host, username: "x-access-token", password: token }
  }

  /**
   * glab keeps one account per host, so its status for the host is asked
   * first: the account there must still be this one. That call also renews an
   * expired OAuth token. The token then comes from `glab auth git-credential`,
   * the helper `glab auth login` configures git with: it answers in git's
   * credential protocol, renews an OAuth token itself, and names the user name
   * the token goes with — `oauth2` for OAuth, the account's own for a personal
   * access token. `auth status --show-token` is not used: it prints the token
   * it read before renewing it, on stderr, in prose.
   */
  private async gitlabToken(account: GitAccountRef): Promise<GitAccountToken> {
    const status = await this.run("glab", ["auth", "status", `--hostname=${account.host}`, "--output", "json"], {
      timeoutMs: STATUS_TIMEOUT_MS,
    })
    const listed = status.status === "exited" ? parseGlabAccounts(status.stdout) : undefined
    const signedIn = listed?.accounts.find((candidate) => candidate.host === account.host)
    if (signedIn === undefined) throw unavailable("glab", account, listed?.problems[0] ?? failureText("glab", status))
    if (signedIn.login !== account.login) {
      throw unavailable("glab", account, `glab is signed in to ${account.host} as ${signedIn.login}, and keeps one account per host`)
    }
    const outcome = await this.run("glab", ["auth", "git-credential", "get"], {
      input: `protocol=https\nhost=${account.host}\n\n`,
      timeoutMs: TOKEN_TIMEOUT_MS,
    })
    const credential = succeeded(outcome) ? parseGlabCredential(outcome.stdout) : undefined
    if (credential === undefined) {
      throw unavailable("glab", account, succeeded(outcome) ? "glab printed no token" : failureText("glab", outcome))
    }
    return { protocol: "https", host: account.host, username: credential.username, password: credential.password }
  }
}
