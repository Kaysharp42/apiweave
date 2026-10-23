import { z } from "zod"
import type { GitAccount } from "@shared/types/GitAccount"
import type { GitProtocol } from "@shared/types/GitProtocol"
import type { GitProvider } from "@shared/types/GitProvider"

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
})

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

/** The usable accounts, and a line naming the host of each one that names no one. */
function collectAccounts(provider: GitProvider, cli: "gh" | "glab", listed: readonly ListedAccount[]): ParsedAccounts {
  const accounts: GitAccount[] = []
  const problems: string[] = []
  for (const { host, login, state, error, gitProtocol, active } of listed) {
    const problem = problemOf(cli, state, error)
    if (login === "") problems.push(`${host}: ${problem ?? `${cli} could not tell whose token it holds`}`)
    else accounts.push({ provider, host, login, gitProtocol, active, problem })
  }
  return { accounts, problems }
}

/** `gh auth status --json hosts`, or undefined when that is not what it printed. */
export function parseGhAccounts(stdout: string): ParsedAccounts | undefined {
  const parsed = GhStatusSchema.safeParse(parseJson(stdout))
  if (!parsed.success) return undefined
  const listed = Object.values(parsed.data.hosts)
    .flat()
    .map((entry) => ({ ...entry, error: entry.error, gitProtocol: ghProtocol(entry.gitProtocol) }))
  return collectAccounts("github", "gh", listed)
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
const ONE_TIME_CODE = /one-time code:\s*([A-Z0-9][A-Z0-9-]{3,})/i
const HTTPS_URL = /https:\/\/[^\s"'<>]+/

/**
 * The one-time code and the page to enter it on, once a sign-in has printed
 * both — gh 2.97 (`internal/authflow/flow.go`, no terminal):
 *
 *     ! First copy your one-time code: ABCD-1234
 *     Open this URL to continue in your web browser: https://github.com/login/device
 *
 * and glab's device flow (`internal/oauth2/device.go`):
 *
 *     First copy your one-time code: ABCD-EFGH
 *     Then open this URL on any device to authorize: https://gitlab.com/oauth/device
 *
 * Undefined until both are there. The page must be on the host being signed
 * in to (or a subdomain of it): main opens it in the browser, and a page
 * anywhere else is not one to send the user to.
 */
export function parseSignInPrompt(stderr: string, host: string): { readonly code: string; readonly url: string } | undefined {
  // Complete lines only: stderr arrives in pieces, and a URL cut mid-way is still a URL.
  const output = stderr.slice(0, stderr.lastIndexOf("\n") + 1).replace(ANSI_ESCAPE, "")
  const code = ONE_TIME_CODE.exec(output)
  if (code?.[1] === undefined) return undefined
  const url = HTTPS_URL.exec(output.slice(code.index + code[0].length))?.[0]
  if (url === undefined) return undefined
  const hostname = host.replace(/:\d+$/, "").toLowerCase()
  const pageHost = URL.canParse(url) ? new URL(url).hostname.toLowerCase() : ""
  if (pageHost !== hostname && !pageHost.endsWith(`.${hostname}`)) return undefined
  return { code: code[1], url }
}

/** `✓ Logged in as octocat`, which both tools print last: who the sign-in was for. */
export function parseSignedInLogin(stderr: string): string | undefined {
  return /Logged in as (\S+)/.exec(stderr.replace(ANSI_ESCAPE, ""))?.[1]
}

/** The last line of a tool's own explanation: a failed sign-in ends with why, after the code it printed first. */
export function lastLine(stderr: string): string | undefined {
  return stderr.replace(ANSI_ESCAPE, "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).at(-1)
}

/** The first line of a tool's own explanation, for a message. Never stdout: that is where a token would be. */
export function firstLine(stderr: string): string | undefined {
  return stderr.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
}
