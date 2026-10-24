import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { GitAccount } from "@shared/types/GitAccount"
import { GitAccountUnavailableError } from "../../git_errors"
import type { GitExecOutcome } from "../../git_process"
import { HostCliService, hostCliRunner, type HostCliCommand, type HostCliRunOptions } from "../host_cli_service"

const GH_RECORDED = fs.readFileSync(path.join(__dirname, "fixtures", "gh-auth-status.json"), "utf8")
const TOKEN = "gho_SECRETSECRETSECRETSECRETSECRET1234"

interface Call {
  readonly command: HostCliCommand
  readonly args: readonly string[]
  readonly input: string | undefined
}

const exited = (stdout: string, exitCode = 0, stderr = ""): GitExecOutcome => ({ status: "exited", exitCode, errorCode: undefined, stdout, stderr })
const notFound: GitExecOutcome = { status: "spawn_failed", exitCode: undefined, errorCode: "ENOENT", stdout: "", stderr: "" }

/** A runner that answers from a table keyed by `command args…`, and records every call. */
function fakeCli(answers: Record<string, GitExecOutcome>, missing: readonly HostCliCommand[] = []): { service: HostCliService; calls: Call[] } {
  const calls: Call[] = []
  const run = async (command: HostCliCommand, args: readonly string[], options: HostCliRunOptions): Promise<GitExecOutcome> => {
    calls.push({ command, args, input: options.input })
    if (missing.includes(command)) return notFound
    const answer = answers[[command, ...args].join(" ")]
    if (answer === undefined) throw new Error(`unexpected call: ${command} ${args.join(" ")}`)
    return answer
  }
  return { service: new HostCliService({ run }), calls }
}

const GH_VERSION = { "gh --version": exited("gh version 2.97.0 (2026-07-31)\n") }
const GLAB_VERSION = { "glab --version": exited("glab 1.46.1 (1a2b3c4)\n") }

describe("detect", () => {
  it("reports each tool's version, and a missing one as missing rather than failing", async () => {
    const { service } = fakeCli(GH_VERSION, ["glab"])

    expect(await service.detect()).toEqual([
      { provider: "github", command: "gh", missing: false, version: "2.97.0", problem: null },
      { provider: "gitlab", command: "glab", missing: true, version: null, problem: null },
    ])
  })

  it("reports a tool that is there but broken, with its own words", async () => {
    const { service } = fakeCli({ ...GH_VERSION, "glab --version": exited("", 1, "glab: cannot open config\n") })

    expect((await service.detect())[1]).toEqual({ provider: "gitlab", command: "glab", missing: false, version: null, problem: "glab: cannot open config" })
  })
})

describe("listAccounts", () => {
  it("lists gh's accounts and none for a missing glab", async () => {
    const { service, calls } = fakeCli({ ...GH_VERSION, "gh auth status --json hosts": exited(GH_RECORDED) }, ["glab"])

    const list = await service.listAccounts()

    expect(list.accounts.map((account) => `${account.provider}:${account.host}:${account.login}`)).toEqual([
      "github:github.com:octo-work",
      "github:github.com:octo-personal",
    ])
    expect(list.clis.find((cli) => cli.provider === "gitlab")).toMatchObject({ missing: true, problem: null })
    // Only status: never --show-token, never a login, switch or logout.
    expect(calls.map((call) => call.args.join(" "))).toEqual(["--version", "--version", "auth status --json hosts"])
  })

  it("lists glab's hosts even when glab exits non-zero for one whose token failed", async () => {
    const glabStatus = JSON.stringify({
      hosts: [
        { host: "gitlab.com", state: "success", user: "tanuki", git_protocol: "https", api_endpoint: "", graphql_endpoint: "" },
        { host: "git.example", state: "error", error: "401 Unauthorized", api_endpoint: "", graphql_endpoint: "" },
      ],
    })
    const { service } = fakeCli({ ...GLAB_VERSION, "glab auth status --all --output json": exited(glabStatus, 1) }, ["gh"])

    const list = await service.listAccounts()

    expect(list.accounts).toEqual([{ provider: "gitlab", host: "gitlab.com", login: "tanuki", gitProtocol: "https", active: true, problem: null }])
    expect(list.clis.find((cli) => cli.provider === "gitlab")?.problem).toBe("git.example: 401 Unauthorized")
  })

  it("reads a glab that has never signed in as no accounts, not a problem", async () => {
    const { service } = fakeCli(
      { ...GLAB_VERSION, "glab auth status --all --output json": exited("", 1, "no GitLab instances have been authenticated with glab; run `glab auth login` to authenticate\n") },
      ["gh"],
    )

    const list = await service.listAccounts()

    expect(list.accounts).toEqual([])
    expect(list.clis.find((cli) => cli.provider === "gitlab")?.problem).toBeNull()
  })

  it("reports a status that timed out or printed something else as the tool's problem, and still lists the other tool", async () => {
    const { service } = fakeCli({
      ...GH_VERSION,
      ...GLAB_VERSION,
      "gh auth status --json hosts": { status: "timeout", exitCode: undefined, errorCode: undefined, stdout: "", stderr: "" },
      "glab auth status --all --output json": exited("", 1, "Error: unknown flag: --output\n"),
    })

    const list = await service.listAccounts()

    expect(list.accounts).toEqual([])
    expect(list.clis.map((cli) => cli.problem)).toEqual(["gh did not answer in time", "Error: unknown flag: --output"])
  })
})

describe("token", () => {
  it("asks gh for one account's token by name, without switching accounts, and answers as x-access-token", async () => {
    const { service, calls } = fakeCli({ "gh auth token --hostname=github.com --user=octo-personal": exited(`${TOKEN}\n`) })

    const credential = await service.token({ provider: "github", host: "github.com", login: "octo-personal" })

    expect(credential).toEqual({ protocol: "https", host: "github.com", username: "x-access-token", password: TOKEN })
    expect(calls).toEqual([{ command: "gh", args: ["auth", "token", "--hostname=github.com", "--user=octo-personal"], input: undefined }])
  })

  it("takes a listed account as it is, using only the fields that name it", async () => {
    const { service } = fakeCli({ "gh auth token --hostname=github.com --user=octo-work": exited(`${TOKEN}\n`) })

    const listed: GitAccount = { provider: "github", host: "github.com", login: "octo-work", gitProtocol: "https", active: true, problem: null }
    const credential = await service.token(listed)

    expect(credential.password).toBe(TOKEN)
  })

  it("explains a missing token with gh's stderr, never its stdout", async () => {
    const { service } = fakeCli({
      "gh auth token --hostname=github.com --user=nobody": exited(`${TOKEN} half-printed`, 1, "no oauth token found for github.com account nobody\n"),
    })

    const error = await service.token({ provider: "github", host: "github.com", login: "nobody" }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitAccountUnavailableError)
    expect((error as Error).message).toBe("gh could not sign in to github.com as nobody: no oauth token found for github.com account nobody")
    expect(JSON.stringify(error)).not.toContain(TOKEN)
  })

  it("says gh is not installed when it is not", async () => {
    const { service } = fakeCli({}, ["gh"])

    await expect(service.token({ provider: "github", host: "github.com", login: "octo" })).rejects.toThrow("gh is not installed")
  })

  it.each([
    { what: "a login that would read as an option", account: { provider: "github", host: "github.com", login: "-oProxyCommand=x" } },
    { what: "a host with a path in it", account: { provider: "github", host: "github.com/evil", login: "octo" } },
    { what: "a provider APIWeave has no tool for", account: { provider: "bitbucket", host: "bitbucket.org", login: "octo" } },
  ])("refuses $what before any tool runs", async ({ account }) => {
    const { service, calls } = fakeCli({})

    await expect(service.token(account as never)).rejects.toBeInstanceOf(GitAccountUnavailableError)
    expect(calls).toEqual([])
  })

  it("checks glab is still signed in as the account, then reads its token through git's credential protocol", async () => {
    const status = JSON.stringify({ hosts: [{ host: "gitlab.com", state: "success", user: "tanuki", api_endpoint: "", graphql_endpoint: "" }] })
    const { service, calls } = fakeCli({
      "glab auth status --hostname=gitlab.com --output json": exited(status),
      "glab auth git-credential get": exited(`capability[]=authtype\npassword=${TOKEN}\nusername=oauth2\n`),
    })

    const credential = await service.token({ provider: "gitlab", host: "gitlab.com", login: "tanuki" })

    expect(credential).toEqual({ protocol: "https", host: "gitlab.com", username: "oauth2", password: TOKEN })
    expect(calls[1]).toEqual({ command: "glab", args: ["auth", "git-credential", "get"], input: "protocol=https\nhost=gitlab.com\n\n" })
  })

  it("refuses glab's token when glab is signed in to the host as someone else", async () => {
    const status = JSON.stringify({ hosts: [{ host: "gitlab.com", state: "success", user: "someone-else", api_endpoint: "", graphql_endpoint: "" }] })
    const { service, calls } = fakeCli({ "glab auth status --hostname=gitlab.com --output json": exited(status) })

    await expect(service.token({ provider: "gitlab", host: "gitlab.com", login: "tanuki" })).rejects.toThrow(
      "glab is signed in to gitlab.com as someone-else, and keeps one account per host",
    )
    expect(calls).toHaveLength(1)
  })

  it("refuses glab's token when glab's sign-in to the host no longer works", async () => {
    const status = JSON.stringify({ hosts: [{ host: "gitlab.com", state: "error", error: "401 Unauthorized", api_endpoint: "", graphql_endpoint: "" }] })
    const { service } = fakeCli({ "glab auth status --hostname=gitlab.com --output json": exited(status, 1) })

    await expect(service.token({ provider: "gitlab", host: "gitlab.com", login: "tanuki" })).rejects.toThrow("gitlab.com: 401 Unauthorized")
  })
})

describe("hostCliRunner", () => {
  it("reports a tool that is not on PATH as not found, without starting anything", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-no-cli-"))
    try {
      const outcome = await hostCliRunner({ PATH: empty })("gh", ["--version"], { timeoutMs: 5_000 })
      expect(outcome).toMatchObject({ status: "spawn_failed", errorCode: "ENOENT" })
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })
})
