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

/** The first line of a tool's own explanation, for a message. Never stdout: that is where a token would be. */
export function firstLine(stderr: string): string | undefined {
  return stderr.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
}
