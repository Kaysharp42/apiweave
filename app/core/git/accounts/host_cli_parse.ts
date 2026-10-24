import { z } from "zod"
import type { GitAccount } from "@shared/types/GitAccount"
import type { GitProtocol } from "@shared/types/GitProtocol"
import type { GitProvider } from "@shared/types/GitProvider"
import type { GitRepository } from "@shared/types/GitRepository"

/**
 * One account of `gh auth status --json hosts`, as gh 2.97's `authEntry`
 * declares it (cli/cli `pkg/cmd/auth/status/status.go`). Not strict: a later
 * gh may add fields. `token` is only present with `--show-token`, which is
 * never passed.
 */
const GhEntrySchema = z.object({
  state: z.string(),
  error: z.string().optional(),
  active: z.boolean(),
  host: z.string(),
  login: z.string(),
  gitProtocol: z.string(),
  /** `keyring`, a hosts.yml path, or the environment variable the token came from (`GH_TOKEN`, `GH_ENTERPRISE_TOKEN`, …). */
  tokenSource: z.string().default(""),
})

/** gh's own test for a token it did not store (`authTokenWriteable`): the source is an environment variable. */
const FROM_ENVIRONMENT = /_TOKEN$/

const GhStatusSchema = z.object({ hosts: z.record(z.string(), z.array(GhEntrySchema)) })

/**
 * One host of `glab auth status --all --output json`, as glab's `hostStatus`
 * declares it (gitlab-org/cli `internal/commands/auth/status/status.go`).
 * `user` is omitted when the token did not work, and `hosts` is Go's nil
 * slice — `null` — when nothing matched.
 */
const GlabHostSchema = z.object({
  host: z.string(),
  state: z.string(),
  user: z.string().default(""),
  error: z.string().optional(),
  git_protocol: z.string().optional(),
})

const GlabStatusSchema = z.object({ hosts: z.array(GlabHostSchema).nullable() })

/** The accounts a status listed, and why an entry with no user name — which cannot be used — was listed at all. */
export interface ParsedAccounts {
  readonly accounts: readonly GitAccount[]
  readonly problems: readonly string[]
}

/** What a token looks like on its way to an environment variable: printable ASCII, no space, no line break that could end the credential-protocol line it is written on. */
const TOKEN_TEXT = /^[\x21-\x7e]+$/

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function problemOf(cli: string, state: string, error: string | undefined): string | null {
  if (state === "success") return null
  return error === undefined || error.trim() === "" ? `${cli} reports this account's sign-in as ${state}` : error.trim()
}

/** gh's `gitProtocol` is `https` or `ssh`, defaulting to `https` when unset. */
function ghProtocol(value: string): GitProtocol {
  return value === "ssh" ? "ssh" : "https"
}

/** glab's `git_protocol` is omitted when unset, and glab's documented default is `ssh`. */
function glabProtocol(value: string | undefined): GitProtocol {
  return value === "https" ? "https" : "ssh"
}

/** One account a status listed, in the terms both tools share. */
interface ListedAccount {
  readonly host: string
  /** Empty when the tool could not tell whose token it holds: a `GH_TOKEN` whose owner it could not look up, a glab token that failed. */
  readonly login: string
  readonly state: string
  readonly error: string | undefined
  readonly gitProtocol: GitProtocol
  readonly active: boolean
}

/**
 * The usable accounts — each host and login once — and a line naming the
 * host of each one that names no one.
 */
function collectAccounts(
  provider: GitProvider,
  cli: "gh" | "glab",
  listed: readonly ListedAccount[],
  problems: readonly string[] = [],
): ParsedAccounts {
  const accounts = new Map<string, GitAccount>()
  const unnamed: string[] = []
  for (const { host, login, state, error, gitProtocol, active } of listed) {
    const problem = problemOf(cli, state, error)
    if (login === "") unnamed.push(`${host}: ${problem ?? `${cli} could not tell whose token it holds`}`)
    else if (!accounts.has(`${host}\n${login}`)) accounts.set(`${host}\n${login}`, { provider, host, login, gitProtocol, active, problem })
  }
  return { accounts: [...accounts.values()], problems: [...problems, ...unnamed] }
}

/**
 * `gh auth status --json hosts`, or undefined when that is not what it
 * printed. A token gh reads from the environment (`GH_TOKEN`,
 * `GH_ENTERPRISE_TOKEN`, …) is listed as the host's active account, but it is
 * not one gh stores: `gh auth token --user` can never hand it over, and its
 * owner may be listed again as a stored account. So it is not offered — the
 * host says why instead — and the stored account stands.
 */
export function parseGhAccounts(stdout: string): ParsedAccounts | undefined {
  const parsed = GhStatusSchema.safeParse(parseJson(stdout))
  if (!parsed.success) return undefined
  const entries = Object.values(parsed.data.hosts).flat()
  const fromEnvironment = entries.filter((entry) => FROM_ENVIRONMENT.test(entry.tokenSource))
  const listed = entries
    .filter((entry) => !FROM_ENVIRONMENT.test(entry.tokenSource))
    .map((entry) => ({ ...entry, error: entry.error, gitProtocol: ghProtocol(entry.gitProtocol) }))
  const problems = fromEnvironment.map(
    (entry) => `${entry.host}: gh is using the token in ${entry.tokenSource}, which is not an account APIWeave can choose; only the accounts gh stores are listed`,
  )
  return collectAccounts("github", "gh", listed, problems)
}

/** `glab auth status --output json`, for every host or one, or undefined when that is not what it printed. */
export function parseGlabAccounts(stdout: string): ParsedAccounts | undefined {
  const parsed = GlabStatusSchema.safeParse(parseJson(stdout))
  if (!parsed.success) return undefined
  // glab keeps one token per host, so its one account there is the one it uses.
  const listed = (parsed.data.hosts ?? []).map((entry) => ({
    host: entry.host,
    login: entry.user,
    state: entry.state,
    error: entry.error,
    gitProtocol: glabProtocol(entry.git_protocol),
    active: true,
  }))
  return collectAccounts("gitlab", "glab", listed)
}

/** `gh auth token`'s output: the token alone on a line, or undefined for anything else. */
export function parseGhToken(stdout: string): string | undefined {
  const token = stdout.trim()
  return TOKEN_TEXT.test(token) ? token : undefined
}

/**
 * `glab auth git-credential get`'s answer, in git's credential protocol:
 * `key=value` lines, one of them `capability[]=authtype`. Undefined unless it
 * names a user and a token.
 */
export function parseGlabCredential(stdout: string): { readonly username: string; readonly password: string } | undefined {
  const fields = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const split = line.indexOf("=")
    if (split > 0) fields.set(line.slice(0, split), line.slice(split + 1))
  }
  const username = fields.get("username")
  const password = fields.get("password")
  if (username === undefined || password === undefined || !TOKEN_TEXT.test(username) || !TOKEN_TEXT.test(password)) return undefined
  return { username, password }
}

/** `gh version 2.97.0 (2026-07-31)` → `2.97.0`; `glab 1.46.1 (abc123)` → `1.46.1`. */
export function parseCliVersion(stdout: string): string | undefined {
  return /\b(\d+\.\d+\.\d+[\w.+-]*)/.exec(stdout)?.[1]
}

const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]/g
/** `one-time code: ABCD-1234`, and gh's clipboard form `One-time code (ABCD-1234) copied to clipboard`. */
const ONE_TIME_CODE = /one-time code(?::\s*|\s*\()([A-Z0-9][A-Z0-9-]{3,})/i
const HTTPS_URL = /https:\/\/[^\s"'<>)]+/g
/** Where a code is entered: GitHub's `verification_uri` (`/login/device`, which gh prints) and GitLab's (`/oauth/device`, which glab prints). */
const DEVICE_PAGE = /^\/(?:login|oauth)\/device\/?$/

/**
 * The page a sign-in asks the user to open, and the one-time code to enter
 * there when it has one — gh 2.97's device flow (`internal/authflow/flow.go`,
 * no terminal):
 *
 *     ! First copy your one-time code: ABCD-1234
 *     Open this URL to continue in your web browser: https://github.com/login/device
 *
 * gh with its `clipboard` setting on (2.103+), which this does not ask for:
 *
 *     ! One-time code (ABCD-1234) copied to clipboard
 *
 * glab's device flow (`internal/oauth2/device.go`):
 *
 *     First copy your one-time code: ABCD-EFGH
 *     Then open this URL on any device to authorize: https://gitlab.com/oauth/device
 *
 * and gh against a GitHub Enterprise Server with no device flow, where
 * cli/oauth falls back to the web application flow: the page alone, no code,
 * and the browser's redirect to gh's local callback finishes it.
 *
 * Read from complete lines only, so undefined until the page's line has
 * ended; the code, when there is one, is printed before it. The page must be
 * on exactly the host being signed in to: main opens it in the browser, and a
 * page anywhere else is not one to send the user to.
 */
export function parseSignInPrompt(stderr: string, host: string): { readonly code: string | null; readonly url: string } | undefined {
  // Complete lines only: stderr arrives in pieces, and a URL cut mid-way is still a URL.
  const output = stderr.slice(0, stderr.lastIndexOf("\n") + 1).replace(ANSI_ESCAPE, "")
  const hostname = host.replace(/:\d+$/, "").toLowerCase()
  const url = [...output.matchAll(HTTPS_URL)]
    .map((match) => match[0])
    .find((candidate) => URL.canParse(candidate) && new URL(candidate).hostname.toLowerCase() === hostname)
  if (url === undefined) return undefined
  const code = ONE_TIME_CODE.exec(output)?.[1] ?? null
  // A device page is useless without its code: the web flow's page is the only one that comes alone.
  if (code === null && DEVICE_PAGE.test(new URL(url).pathname)) return undefined
  return { code, url }
}

/** `✓ Logged in as octocat`, which both tools print last: who the sign-in was for. */
export function parseSignedInLogin(stderr: string): string | undefined {
  return /Logged in as (\S+)/.exec(stderr.replace(ANSI_ESCAPE, ""))?.[1]
}

/**
 * A repository as GitHub's REST API returns it (`GET /repos/{owner}/{repo}`,
 * `POST /user/repos`, `POST /orgs/{org}/repos`): the "full repository"
 * object, of which only these fields are read. Recorded from `gh api` 2.97.
 */
const GhRestRepositorySchema = z.object({
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  private: z.boolean(),
  clone_url: z.string(),
  ssh_url: z.string(),
})

/** One of `GET /user/orgs`: the organizations the account belongs to. */
const GhOrganizationsSchema = z.array(z.object({ login: z.string() }))

/**
 * A project as GitLab's REST API returns it (`POST /projects`, `GET
 * /projects/:id`; docs.gitlab.com/api/projects): only these fields are read.
 * `permissions` is present on a project the user is a member of.
 */
const GitLabProjectSchema = z.object({
  id: z.number(),
  path: z.string(),
  path_with_namespace: z.string(),
  namespace: z.object({ full_path: z.string() }),
  visibility: z.string(),
  http_url_to_repo: z.string(),
  ssh_url_to_repo: z.string(),
  empty_repo: z.boolean().default(false),
})

/**
 * One repository of `gh repo list --json name,nameWithOwner,url,sshUrl,isEmpty,viewerPermission,visibility`,
 * as gh 2.97 prints it: `url` is the web page (no `.git`), `viewerPermission`
 * GitHub's `RepositoryPermission` (`ADMIN`, `MAINTAIN`, `WRITE`, `TRIAGE`,
 * `READ`), `visibility` `PUBLIC`, `PRIVATE` or `INTERNAL`.
 */
const GhListedRepositorySchema = z.object({
  name: z.string(),
  nameWithOwner: z.string(),
  url: z.string(),
  sshUrl: z.string(),
  isEmpty: z.boolean(),
  viewerPermission: z.string().nullable(),
  visibility: z.string(),
})

/** The permissions that may push to a GitHub repository. */
const GH_PUSH_PERMISSIONS: ReadonlySet<string> = new Set(["ADMIN", "MAINTAIN", "WRITE"])

/** GitLab's Developer role, the least that may push (docs.gitlab.com/user/permissions). */
const GITLAB_DEVELOPER = 30

const GitLabAccessSchema = z.object({ access_level: z.number() }).nullable().optional()

/** A project of `GET /projects?membership=true`, with the user's own access through the project or its group. */
const GitLabListedProjectSchema = GitLabProjectSchema.extend({
  permissions: z.object({ project_access: GitLabAccessSchema, group_access: GitLabAccessSchema }).optional(),
})

/** One of `GET /groups` (docs.gitlab.com/api/groups): its id, which `POST /projects` takes as `namespace_id`, and its path. */
const GitLabGroupSchema = z.object({ id: z.number(), full_path: z.string() })

/** `value` as `schema` reads it, or undefined when it is not that. */
function readAs<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** What `stdout` holds as `schema` reads it, or undefined when it is not JSON of that shape. */
function parseAs<T>(schema: z.ZodType<T>, stdout: string): T | undefined {
  return readAs(schema, parseJson(stdout))
}

/** A repository GitHub's REST API returned — one just created, so empty and the account's — or undefined for anything else. */
export function parseGhRestRepository(stdout: string): GitRepository | undefined {
  const repository = parseAs(GhRestRepositorySchema, stdout)
  return repository && {
    owner: repository.owner.login,
    name: repository.name,
    fullName: repository.full_name,
    httpsUrl: repository.clone_url,
    sshUrl: repository.ssh_url,
    private: repository.private,
    empty: true,
    canPush: true,
  }
}

/** The organizations `GET /user/orgs` listed, or undefined for anything else. */
export function parseGhOrganizations(stdout: string): readonly string[] | undefined {
  return parseAs(GhOrganizationsSchema, stdout)?.map((organization) => organization.login)
}

/** A project of GitLab's REST API as a repository; whether the account may push is the caller's to say. */
function gitLabRepository(project: z.infer<typeof GitLabProjectSchema>, canPush: boolean): GitRepository {
  return {
    owner: project.namespace.full_path,
    name: project.path,
    fullName: project.path_with_namespace,
    httpsUrl: project.http_url_to_repo,
    sshUrl: project.ssh_url_to_repo,
    private: project.visibility !== "public",
    empty: project.empty_repo,
    canPush,
  }
}

/** A project GitLab's REST API returned for a create, which the account may push to, or undefined for anything else. */
export function parseGitLabProject(stdout: string): GitRepository | undefined {
  const project = parseAs(GitLabProjectSchema, stdout)
  return project && gitLabRepository(project, true)
}

/** The repositories `gh repo list --json …` printed, or undefined for anything else. */
export function parseGhRepositoryList(stdout: string): readonly GitRepository[] | undefined {
  return parseAs(z.array(GhListedRepositorySchema), stdout)?.map((repository) => ({
    owner: repository.nameWithOwner.slice(0, repository.nameWithOwner.lastIndexOf("/")),
    name: repository.name,
    fullName: repository.nameWithOwner,
    httpsUrl: `${repository.url}.git`,
    sshUrl: repository.sshUrl,
    private: repository.visibility !== "PUBLIC",
    empty: repository.isEmpty,
    canPush: repository.viewerPermission !== null && GH_PUSH_PERMISSIONS.has(repository.viewerPermission),
  }))
}

/** The projects `GET /projects?membership=true` listed, each pushable for a Developer or more, or undefined for anything else. */
export function parseGitLabProjectList(stdout: string): readonly GitRepository[] | undefined {
  return parseAs(z.array(GitLabListedProjectSchema), stdout)?.map((project) => {
    const access = Math.max(project.permissions?.project_access?.access_level ?? 0, project.permissions?.group_access?.access_level ?? 0)
    return gitLabRepository(project, access >= GITLAB_DEVELOPER)
  })
}

/** The groups `GET /groups` listed, or undefined for anything else. */
export function parseGitLabGroups(stdout: string): readonly { readonly id: number; readonly path: string }[] | undefined {
  return parseAs(z.array(GitLabGroupSchema), stdout)?.map((group) => ({ id: group.id, path: group.full_path }))
}

/** One GitLab group, as `GET /groups/:id` returns it. */
export function parseGitLabGroup(stdout: string): { readonly id: number; readonly path: string } | undefined {
  const group = parseAs(GitLabGroupSchema, stdout)
  return group && { id: group.id, path: group.full_path }
}

/**
 * The body both tools print on stdout when a request fails: GitHub's
 * `message` and `errors`, GitLab's `message` (a sentence, or for a refused
 * field an object of its complaints) and an OAuth `error`.
 */
const ApiErrorBodySchema = z.object({
  message: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  errors: z.array(z.unknown()).optional(),
  error: z.string().optional(),
})

/** One of GitHub's `errors`: a sentence, or an object whose `message` is one; anything else says nothing. */
const ApiErrorEntrySchema = z.union([z.string(), z.object({ message: z.string() }).transform((entry) => entry.message)])

/** GitLab's `{"name": ["has already been taken"]}` as `name has already been taken`. */
function fieldComplaints(message: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(message).map(([field, complaints]) => `${field} ${Array.isArray(complaints) ? complaints.join(", ") : String(complaints)}`)
}

/**
 * What a host's API said was wrong, from the body both tools print on stdout
 * when a request fails: GitHub's `message` and each of its `errors`, or
 * GitLab's `message`, which is a sentence or, for a refused field, an object
 * of the field's complaints (`{"name": ["has already been taken"]}`).
 * Undefined when the body says nothing readable.
 */
export function parseApiError(stdout: string): string | undefined {
  const body = parseAs(ApiErrorBodySchema, stdout)
  if (body === undefined) return undefined
  const messages = typeof body.message === "string" ? [body.message] : fieldComplaints(body.message ?? {})
  const errors = (body.errors ?? []).flatMap((entry) => readAs(ApiErrorEntrySchema, entry) ?? [])
  const parts = [...messages, ...errors]
  if (parts.length === 0 && body.error !== undefined) parts.push(body.error)
  return parts.length === 0 ? undefined : parts.join("; ")
}

/** The last line of a tool's own explanation: a failed sign-in ends with why, after the code it printed first. */
export function lastLine(stderr: string): string | undefined {
  return stderr.replace(ANSI_ESCAPE, "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).at(-1)
}

/** The first line of a tool's own explanation, for a message. Never stdout: that is where a token would be. */
export function firstLine(stderr: string): string | undefined {
  return stderr.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
}
