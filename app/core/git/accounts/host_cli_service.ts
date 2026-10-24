import os from "node:os"
import type { GitAccountList } from "@shared/types/GitAccountList"
import type { GitAccountRef } from "@shared/types/GitAccountRef"
import type { GitCreatedRepository } from "@shared/types/GitCreatedRepository"
import type { GitCreateRepositoryRequest } from "@shared/types/GitCreateRepositoryRequest"
import type { GitHostCli } from "@shared/types/GitHostCli"
import type { GitProvider } from "@shared/types/GitProvider"
import type { GitRepository } from "@shared/types/GitRepository"
import type { GitRepositoryOwner } from "@shared/types/GitRepositoryOwner"
import type { GitRepositoryOwnerList } from "@shared/types/GitRepositoryOwnerList"
import { GitAccountRefSchema, GitHostSchema } from "@shared/zod-schemas/GitAccountRefSchema"
import { GitCreateRepositoryRequestSchema } from "@shared/zod-schemas/GitCreateRepositoryRequestSchema"
import { resolveExecutable, spawnCommandFor } from "../../agents/executable"
import { ConflictError, ValidationError } from "../../ipc/errors"
import { GitAccountUnavailableError, redactCredentials } from "../git_errors"
import { execGit, type GitExecOutcome } from "../git_process"
import type { GitAccountToken } from "../git_types"
import {
  firstLine,
  lastLine,
  parseApiError,
  parseCliVersion,
  parseGhAccounts,
  parseGhOrganizations,
  parseGhRestRepository,
  parseGhToken,
  parseGitLabGroup,
  parseGitLabGroups,
  parseGitLabProject,
  parseGlabAccounts,
  parseGlabCredential,
  parseSignedInLogin,
  parseSignInPrompt,
  type ParsedAccounts,
} from "./host_cli_parse"

/** The topic APIWeave tags the repositories it creates with, on GitHub and GitLab alike: what Open from git lists by. */
export const APIWEAVE_REPOSITORY_TOPIC = "apiweave-workspace"

export type HostCliCommand = "gh" | "glab"

export interface HostCliRunOptions {
  /** Written to the tool's stdin before it is closed. */
  readonly input?: string
  readonly timeoutMs: number
  /** Told each piece of stderr as it arrives. */
  readonly onStderr?: (text: string) => void
  /** Aborting it kills the tool's process tree; the outcome is `cancelled`. */
  readonly signal?: AbortSignal | undefined
  /** Set for this one process only, over what it inherits: an account's token, say. */
  readonly env?: Readonly<Record<string, string>>
}

export interface HostCliSignInOptions {
  /** Told the one-time code and the page to enter it on, once the tool prints them. */
  readonly onPrompt: (prompt: { readonly code: string | null; readonly url: string }) => void
  /** Aborting it cancels the sign-in: the tool's process tree is killed. */
  readonly signal?: AbortSignal | undefined
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
/** A one-time code lives 15 minutes on GitHub and GitLab; the tool gives up then, and this a little after. */
const SIGN_IN_TIMEOUT_MS = 16 * 60_000

const SIGN_IN_ARGS: Readonly<Record<GitProvider, (host: string) => readonly string[]>> = {
  github: (host) => ["auth", "login", `--hostname=${host}`, "--web", "--skip-ssh-key", "--clipboard=false"],
  gitlab: (host) => ["auth", "login", `--hostname=${host}`, "--device", "--git-protocol=https"],
}
/** Both status commands ask the host about every account they hold. */
const STATUS_TIMEOUT_MS = 30_000
const TOKEN_TIMEOUT_MS = 30_000
const API_TIMEOUT_MS = 60_000

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
  // Set, and false: gh then also ignores a legacy `DEBUG` that would log each request.
  GH_DEBUG: "0",
  GLAB_NO_PROMPT: "true",
  GLAB_CHECK_UPDATE: "false",
  NO_COLOR: "1",
} as const

/**
 * What each tool's child is run with on top of {@link QUIET_ENVIRONMENT}:
 * variables set, and variables removed. glab reads a token and a host from
 * its environment ahead of what it stores, and GitLab's docs say neither is
 * scoped to a host — a `GITLAB_TOKEN` for one instance would be sent to
 * another, and would make glab act as someone other than the account it was
 * checked to hold — so none reaches it; the host is always its
 * `--hostname`. Its debug logs, which print transport detail to the stderr
 * a failure is told from, are off.
 */
const COMMAND_ENVIRONMENT: Readonly<Record<HostCliCommand, { readonly set: Readonly<Record<string, string>>; readonly unset: readonly string[] }>> = {
  gh: { set: {}, unset: [] },
  glab: {
    set: { GLAB_DEBUG_HTTP: "false", GLAB_DEBUG: "false" },
    unset: ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "OAUTH_TOKEN", "GITLAB_API_HOST", "GITLAB_HOST", "GITLAB_URI", "GITLAB_URL", "GL_HOST"],
  },
}

/**
 * The environment one call of `command` runs with: the caller's, quietened,
 * with the tool's own settings and the call's own variables (an account's
 * token) on top, and the variables the tool must not see removed — by name
 * in any letter case, as Windows matches them.
 */
export function hostCliEnvironment(command: HostCliCommand, base: NodeJS.ProcessEnv, extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const { set, unset } = COMMAND_ENVIRONMENT[command]
  const removed = new Set(unset)
  const kept = Object.entries(base).filter(([name]) => !removed.has(name.toUpperCase()))
  return { ...Object.fromEntries(kept), ...QUIET_ENVIRONMENT, ...set, ...extra }
}

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
      env: hostCliEnvironment(command, env, options.env),
      timeoutMs: options.timeoutMs,
      input: options.input,
      verbatim: spawn.verbatim,
      onStderr: options.onStderr,
      signal: options.signal,
    })
  }
}

function succeeded(outcome: GitExecOutcome): boolean {
  return outcome.status === "exited" && outcome.exitCode === 0
}

/** Why a tool did not answer, from stderr alone: stdout is where a token would be. */
function failureText(command: HostCliCommand, outcome: GitExecOutcome): string {
  if (outcome.status === "timeout") return `${command} did not answer in time`
  if (outcome.status === "cancelled") return `${command} was stopped`
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
    const checked = checkedAccount(account)
    return checked.provider === "github" ? this.githubToken(checked) : this.gitlabToken(checked)
  }

  /**
   * Sign in to `host` with the provider's own tool, in the browser, and
   * resolve with the account it signed in as. The tool runs with no terminal
   * and prints a page, with a one-time code to enter there when the host has
   * a device flow; `onPrompt` is told them once, and the tool then waits —
   * for as long as the code lives — until the user has finished in the
   * browser. Aborting `signal` kills the tool's process tree.
   *
   * gh: `auth login --web` (the device flow; with no terminal it neither
   * waits for Enter nor offers to configure git; on a GitHub Enterprise
   * Server without one, the web flow, which prints the page alone) — and, as
   * from a terminal, the account becomes gh's active one on the host.
   * `--clipboard=false`: gh 2.103's `clipboard` setting would otherwise
   * overwrite the user's clipboard with the code. `--git-protocol` is not
   * passed: gh keeps one protocol per host for every account on it, and the
   * user's choice stays theirs. glab: `auth login --device`, the flow that
   * prints a code (`--web` opens a browser from a fixed local port and prints
   * none); `--git-protocol=https`, since glab keeps one account per host and
   * the setting is that account's. Neither touches git's configuration.
   *
   * Rejects with the tool's own last words when it fails, and when cancelled.
   */
  async signIn(provider: GitProvider, host: string, options: HostCliSignInOptions): Promise<GitAccountRef> {
    const checked = GitHostSchema.safeParse(host)
    if (!checked.success) throw new Error(`'${host}' is not a host name APIWeave can sign in to`)
    const command = COMMANDS[provider]
    let stderr = ""
    let prompted = false
    const outcome = await this.run(command, SIGN_IN_ARGS[provider](checked.data), {
      timeoutMs: SIGN_IN_TIMEOUT_MS,
      signal: options.signal,
      onStderr: (text) => {
        stderr += text
        const prompt = prompted ? undefined : parseSignInPrompt(stderr, checked.data)
        if (prompt === undefined) return
        prompted = true
        options.onPrompt(prompt)
      },
    })
    if (outcome.status === "cancelled") throw new Error("Sign-in was cancelled.")
    if (outcome.status === "timeout") throw new Error(`${command} gave up waiting for the code to be entered. Start the sign-in again.`)
    if (!succeeded(outcome)) {
      throw new Error(`${command} could not sign in to ${checked.data}: ${lastLine(outcome.stderr) ?? failureText(command, outcome)}`)
    }
    // Checked like any account from outside main: it is bound, stored and passed to `--user` later.
    const account = GitAccountRefSchema.safeParse({ provider, host: checked.data, login: parseSignedInLogin(outcome.stderr) })
    if (!account.success) throw new Error(`${command} signed in to ${checked.data} but did not say as whom; check its accounts and try again.`)
    return account.data
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
    await this.assertGlabSignedInAs(account)
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

  /**
   * glab keeps one account per host, so its status for the host says whether
   * that account is still this one. The call also renews an expired OAuth
   * token, which the call after it then uses.
   */
  private async assertGlabSignedInAs(account: GitAccountRef): Promise<void> {
    const status = await this.run("glab", ["auth", "status", `--hostname=${account.host}`, "--output", "json"], {
      timeoutMs: STATUS_TIMEOUT_MS,
    })
    const listed = status.status === "exited" ? parseGlabAccounts(status.stdout) : undefined
    const signedIn = listed?.accounts.find((candidate) => candidate.host === account.host)
    if (signedIn === undefined) throw unavailable("glab", account, listed?.problems[0] ?? failureText("glab", status))
    if (signedIn.login !== account.login) {
      throw unavailable("glab", account, `glab is signed in to ${account.host} as ${signedIn.login}, and keeps one account per host`)
    }
  }

  /**
   * Where `account` can create a repository: itself, and its GitHub
   * organizations (`GET /user/orgs`) or the GitLab groups where it is at
   * least a Developer (`GET /groups?min_access_level=30`), the first 100 of
   * each. Organizations or groups that cannot be listed leave the account
   * itself, with the reason as `problem`.
   */
  async listOwners(account: GitAccountRef): Promise<GitRepositoryOwnerList> {
    const checked = checkedAccount(account)
    const api = await this.apiAs(checked)
    const self: GitRepositoryOwner = { path: checked.login, kind: "user" }
    if (checked.provider === "github") {
      const outcome = await api.call(["user/orgs?per_page=100"])
      const organizations = succeeded(outcome) ? parseGhOrganizations(outcome.stdout) : undefined
      if (organizations === undefined) return { owners: [self], problem: `The organizations of ${checked.login} could not be listed: ${api.failure(outcome)}` }
      return { owners: [self, ...organizations.map((path) => ({ path, kind: "organization" as const }))], problem: ownersCapReached(organizations.length, "organizations") }
    }
    const outcome = await api.call(["groups?min_access_level=30&per_page=100&order_by=path"])
    const groups = succeeded(outcome) ? parseGitLabGroups(outcome.stdout) : undefined
    if (groups === undefined) return { owners: [self], problem: `The groups of ${checked.login} could not be listed: ${api.failure(outcome)}` }
    return { owners: [self, ...groups.map((group) => ({ path: group.path, kind: "group" as const }))], problem: ownersCapReached(groups.length, "groups") }
  }

  /**
   * Create an empty repository as `account` — no README, no licence, no
   * first commit, so a workspace can be pushed to it — and tag it
   * `apiweave-workspace`, the topic Open from git lists by.
   *
   * A repository that is already there is never adopted: it is asked for
   * first, and a name that exists, or that the host refuses as taken, is a
   * {@link ConflictError} naming it. Nothing this creates is ever deleted, by
   * this or by a failure after it: a tag that could not be added is the
   * result's `problem`, and the repository is still returned.
   *
   * GitHub: `POST /user/repos` for the account itself, `POST
   * /orgs/{org}/repos` for an organization, then `PUT
   * /repos/{owner}/{repo}/topics`, through `gh api` with the account's token
   * in `GH_TOKEN` for that one process. GitLab: `POST /projects` with
   * `initialize_with_readme: false` and the topic, under the group's
   * `namespace_id` (none for the account itself), through `glab api`, which
   * keeps one account per host and is first checked to be signed in as this one.
   */
  async createRepository(account: GitAccountRef, request: GitCreateRepositoryRequest): Promise<GitCreatedRepository> {
    const checked = checkedAccount(account)
    const valid = checkedCreateRequest(checked, request)
    const where = `${checked.host}/${valid.owner}/${valid.name}`
    const api = await this.apiAs(checked)
    await assertAbsent(api, checked.provider, valid, where)
    return checked.provider === "github" ? this.createOnGitHub(checked, api, valid, where) : this.createOnGitLab(checked, api, valid, where)
  }

  private async createOnGitHub(account: GitAccountRef, api: HostApi, request: GitCreateRepositoryRequest, where: string): Promise<GitCreatedRepository> {
    const endpoint = sameLogin(request.owner, account.login) ? "user/repos" : `orgs/${request.owner}/repos`
    const created = await api.call(["--method=POST", endpoint, "--input=-"], { name: request.name, private: request.private, auto_init: false })
    const repository = createdRepository(account, request, where, created, api, parseGhRestRepository)
    const tagged = await api.call(["--method=PUT", `repos/${repository.fullName}/topics`, "--input=-"], { names: [APIWEAVE_REPOSITORY_TOPIC] })
    return {
      repository,
      problem: succeeded(tagged) ? null : `${repository.fullName} was created, but not tagged ${APIWEAVE_REPOSITORY_TOPIC}: ${api.failure(tagged)}`,
    }
  }

  private async createOnGitLab(account: GitAccountRef, api: HostApi, request: GitCreateRepositoryRequest, where: string): Promise<GitCreatedRepository> {
    let namespaceId: number | undefined
    if (!sameLogin(request.owner, account.login)) {
      const group = await api.call([`groups/${encodeURIComponent(request.owner)}`])
      const found = succeeded(group) ? parseGitLabGroup(group.stdout) : undefined
      if (found === undefined) throw new Error(`APIWeave could not find the group ${request.owner} on ${account.host}: ${api.failure(group)}`)
      namespaceId = found.id
    }
    const created = await api.call(["--method=POST", "projects", "--input=-"], {
      name: request.name,
      path: request.name,
      ...(namespaceId === undefined ? {} : { namespace_id: namespaceId }),
      visibility: request.private ? "private" : "public",
      initialize_with_readme: false,
      topics: [APIWEAVE_REPOSITORY_TOPIC],
    })
    const repository = createdRepository(account, request, where, created, api, parseGitLabProject)
    return { repository: { ...repository, empty: true }, problem: null }
  }

  /**
   * A way to call the host's REST API as `account`, one request per call.
   * gh gets the account's token in `GH_TOKEN` (github.com and `*.ghe.com`)
   * and `GH_ENTERPRISE_TOKEN` (a GitHub Enterprise Server), for that one
   * process: gh's active account is never switched. glab keeps one token per
   * host and is checked once, here, to hold this account's; it then uses its
   * own. A body goes to stdin as JSON (`--input -`): nothing in it is read as
   * a flag, a file or a placeholder. A failure's text comes from what the
   * host said, with the token, should it ever appear, removed.
   */
  private async apiAs(account: GitAccountRef): Promise<HostApi> {
    const command = COMMANDS[account.provider]
    let env: Readonly<Record<string, string>> | undefined
    const secrets: string[] = []
    if (account.provider === "github") {
      const { password } = await this.githubToken(account)
      env = { GH_TOKEN: password, GH_ENTERPRISE_TOKEN: password, GH_HOST: account.host }
      secrets.push(password)
    } else {
      await this.assertGlabSignedInAs(account)
    }
    return {
      call: (args, body) =>
        this.run(command, ["api", `--hostname=${account.host}`, ...args], {
          timeoutMs: API_TIMEOUT_MS,
          ...(body === undefined ? {} : { input: JSON.stringify(body) }),
          ...(env === undefined ? {} : { env }),
        }),
      failure: (outcome) => redactCredentials(parseApiError(outcome.stdout) ?? failureText(command, outcome), secrets),
    }
  }
}

/** One account's API, as {@link HostCliService.apiAs} sets it up. */
interface HostApi {
  readonly call: (args: readonly string[], body?: unknown) => Promise<GitExecOutcome>
  readonly failure: (outcome: GitExecOutcome) => string
}

/** Only the three fields that name an account, checked: a listed `GitAccount` carries more, and the bridge refuses more. */
function checkedAccount(account: GitAccountRef): GitAccountRef {
  const checked = GitAccountRefSchema.safeParse({ provider: account.provider, host: account.host, login: account.login })
  if (!checked.success) throw new GitAccountUnavailableError("that is not an account APIWeave can sign in as")
  return checked.data
}

/** GitHub and GitLab compare user names without regard to case. */
function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** A request to create a repository, checked before any tool runs: a name and owner both hosts accept, and on GitHub an owner with no subgroup. */
function checkedCreateRequest(account: GitAccountRef, request: GitCreateRepositoryRequest): GitCreateRepositoryRequest {
  const parsed = GitCreateRepositoryRequestSchema.safeParse(request)
  if (!parsed.success) throw new ValidationError(`That is not a repository APIWeave can create: ${parsed.error.issues[0]?.message ?? "invalid"}.`)
  if (account.provider === "github" && parsed.data.owner.includes("/")) throw new ValidationError(`${parsed.data.owner} is not a GitHub user or organization.`)
  return parsed.data
}

/**
 * Ask for the repository before creating it: one that is there is never
 * adopted. Only the host's 404 lets the create go ahead; any other answer —
 * a timeout, a refusal — stops it, because it says nothing about whether
 * the name is free.
 */
async function assertAbsent(api: HostApi, provider: GitProvider, request: GitCreateRepositoryRequest, where: string): Promise<void> {
  const path = `${request.owner}/${request.name}`
  const existing = await api.call([provider === "github" ? `repos/${path}` : `projects/${encodeURIComponent(path)}`])
  if (succeeded(existing)) throw alreadyExists(where)
  if (!/\(HTTP 404\)/.test(existing.stderr)) throw new Error(`APIWeave could not check whether ${where} exists: ${api.failure(existing)}`)
}

function alreadyExists(where: string): ConflictError {
  return new ConflictError(`${where} already exists. Choose another name, or connect to it by its URL if it is empty.`)
}

/** A list of owners that stopped at its one page: said, so the list is not taken for all of them. */
function ownersCapReached(count: number, what: "organizations" | "groups"): string | null {
  return count >= 100 ? `Only the first 100 ${what} are listed. Use a URL for a repository under another.` : null
}

/**
 * The host refused the request and said why — a 4xx with a body, which
 * creates nothing. A 5xx, a timeout, a cancel or an answer with no body
 * says nothing about whether the repository was made. gh prints `(HTTP
 * 422)`, glab `(HTTP 400)` or, for a body whose message is an object of
 * refused fields, no status at all.
 */
function refusedWithReason(outcome: GitExecOutcome): boolean {
  if (outcome.status !== "exited" || outcome.exitCode === 0) return false
  if (/\bHTTP 5\d\d\b/.test(outcome.stderr) || parseApiError(outcome.stdout) === undefined) return false
  return /\bHTTP 4\d\d\b/.test(outcome.stderr) || !/\bHTTP \d{3}\b/.test(outcome.stderr)
}

/**
 * The repository a create's answer describes. A refusal is an error saying
 * why — the host's "taken" as the name that exists. Anything else that is
 * not a readable answer may still have made the repository, and says so,
 * because APIWeave neither deletes it nor guesses. A repository made under
 * another name than the one asked for is not one to bind a workspace to.
 */
function createdRepository(
  account: GitAccountRef,
  request: GitCreateRepositoryRequest,
  where: string,
  outcome: GitExecOutcome,
  api: HostApi,
  parse: (stdout: string) => GitRepository | undefined,
): GitRepository {
  const repository = succeeded(outcome) ? parse(outcome.stdout) : undefined
  if (repository === undefined) {
    const reason = succeeded(outcome) ? "the host's answer could not be read" : api.failure(outcome)
    if (!refusedWithReason(outcome)) throw mayHaveBeenCreated(where, reason)
    if (/already exists|has already been taken/i.test(reason)) throw alreadyExists(where)
    throw new Error(`APIWeave could not create ${where}: ${reason}`)
  }
  if (!sameLogin(repository.fullName, `${request.owner}/${request.name}`)) {
    throw new Error(`${where} was created as ${account.host}/${repository.fullName}, and not connected. Check it on the host, then connect to it by its URL.`)
  }
  return repository
}

function mayHaveBeenCreated(where: string, reason: string): Error {
  return new Error(`${where} may have been created (${reason}). Check it on the host, then connect to it by its URL.`)
}
