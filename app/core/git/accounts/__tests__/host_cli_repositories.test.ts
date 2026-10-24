import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ConflictError, ValidationError } from "../../../ipc/errors"
import { GitAccountUnavailableError } from "../../git_errors"
import type { GitExecOutcome } from "../../git_process"
import { APIWEAVE_REPOSITORY_TOPIC, HostCliService, hostCliRunner, type HostCliCommand, type HostCliRunOptions } from "../host_cli_service"

const fixture = (name: string): string => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
const GH_REPO = fixture("gh-repo.json")
const GH_ORGS = fixture("gh-user-orgs.json")
const GITLAB_PROJECT = fixture("gitlab-project.json")
const TOKEN = "gho_SECRETSECRETSECRETSECRETSECRET1234"

const GITHUB = { provider: "github" as const, host: "github.com", login: "octo-work" }
const GITLAB = { provider: "gitlab" as const, host: "gitlab.com", login: "tanuki" }

interface Call {
  readonly command: HostCliCommand
  readonly args: readonly string[]
  readonly input: string | undefined
  readonly env: Readonly<Record<string, string>> | undefined
}

const exited = (stdout: string, exitCode = 0, stderr = ""): GitExecOutcome => ({ status: "exited", exitCode, errorCode: undefined, stdout, stderr })
/** gh 2.97 on a missing repository, recorded: the body on stdout, the status on stderr. */
const GH_NOT_FOUND = exited('{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/repos#get-a-repository","status":"404"}', 1, "gh: Not Found (HTTP 404)\n")
/** glab on a missing project (`internal/commands/api/api.go`): the body on stdout, `glab: <message> (HTTP <code>)` on stderr. */
const GLAB_NOT_FOUND = exited('{"message":"404 Project Not Found"}', 1, "glab: 404 Project Not Found (HTTP 404)\n")
const GLAB_SIGNED_IN = exited(JSON.stringify({ hosts: [{ host: "gitlab.com", state: "success", user: "tanuki", api_endpoint: "", graphql_endpoint: "" }] }))

/** A runner that answers from a table keyed by `command args…`, and records every call with its input and environment. */
function fakeCli(answers: Record<string, GitExecOutcome>): { service: HostCliService; calls: Call[] } {
  const calls: Call[] = []
  const run = async (command: HostCliCommand, args: readonly string[], options: HostCliRunOptions): Promise<GitExecOutcome> => {
    calls.push({ command, args, input: options.input, env: options.env })
    const answer = answers[[command, ...args].join(" ")]
    if (answer === undefined) throw new Error(`unexpected call: ${command} ${args.join(" ")}`)
    return answer
  }
  return { service: new HostCliService({ run }), calls }
}

const GH_TOKEN_CALL = { "gh auth token --hostname=github.com --user=octo-work": exited(`${TOKEN}\n`) }
const GLAB_STATUS_CALL = { "glab auth status --hostname=gitlab.com --output json": GLAB_SIGNED_IN }

describe("listOwners", () => {
  it("lists the GitHub account and its organizations, calling the API with the account's token in that process only", async () => {
    const { service, calls } = fakeCli({ ...GH_TOKEN_CALL, "gh api --hostname=github.com user/orgs?per_page=100": exited(GH_ORGS) })

    expect(await service.listOwners(GITHUB)).toEqual({
      owners: [
        { path: "octo-work", kind: "user" },
        { path: "acme", kind: "organization" },
        { path: "octo-org", kind: "organization" },
      ],
      problem: null,
    })
    const api = calls.find((call) => call.args[0] === "api")
    expect(api?.env).toEqual({ GH_TOKEN: TOKEN, GH_ENTERPRISE_TOKEN: TOKEN, GH_HOST: "github.com" })
    // The token is never an argument.
    expect(calls.flatMap((call) => call.args).join(" ")).not.toContain(TOKEN)
  })

  it("keeps the account itself when its organizations cannot be listed, and says why", async () => {
    const { service } = fakeCli({
      ...GH_TOKEN_CALL,
      "gh api --hostname=github.com user/orgs?per_page=100": exited('{"message":"Bad credentials","status":"401"}', 1, "gh: Bad credentials (HTTP 401)\n"),
    })

    expect(await service.listOwners(GITHUB)).toEqual({
      owners: [{ path: "octo-work", kind: "user" }],
      problem: "The organizations of octo-work could not be listed: Bad credentials",
    })
  })

  it("lists the GitLab groups the account can create in, after checking glab is signed in as it", async () => {
    const { service, calls } = fakeCli({
      ...GLAB_STATUS_CALL,
      "glab api --hostname=gitlab.com groups?min_access_level=30&per_page=100&order_by=path": exited(
        JSON.stringify([
          { id: 6, name: "Acme", path: "acme", full_path: "acme" },
          { id: 7, name: "QA", path: "qa", full_path: "acme/qa" },
        ]),
      ),
    })

    expect((await service.listOwners(GITLAB)).owners).toEqual([
      { path: "tanuki", kind: "user" },
      { path: "acme", kind: "group" },
      { path: "acme/qa", kind: "group" },
    ])
    // glab uses its own token for the host, which the status check proved is this account's.
    expect(calls.map((call) => call.env)).toEqual([undefined, undefined])
  })

  it("refuses when glab is signed in to the host as someone else, before any API call", async () => {
    const { service, calls } = fakeCli({
      "glab auth status --hostname=gitlab.com --output json": exited(JSON.stringify({ hosts: [{ host: "gitlab.com", state: "success", user: "other" }] })),
    })

    await expect(service.listOwners(GITLAB)).rejects.toBeInstanceOf(GitAccountUnavailableError)
    expect(calls).toHaveLength(1)
  })
})

describe("createRepository", () => {
  const REQUEST = { owner: "octo-work", name: "api-tests", private: true }

  it("creates an empty private repository for the GitHub account itself and tags it, all as that account", async () => {
    const { service, calls } = fakeCli({
      ...GH_TOKEN_CALL,
      "gh api --hostname=github.com repos/octo-work/api-tests": GH_NOT_FOUND,
      "gh api --hostname=github.com --method=POST user/repos --input=-": exited(GH_REPO),
      "gh api --hostname=github.com --method=PUT repos/octo-work/api-tests/topics --input=-": exited('{"names":["apiweave-workspace"]}'),
    })

    const created = await service.createRepository(GITHUB, REQUEST)

    expect(created).toEqual({
      repository: {
        owner: "octo-work",
        name: "api-tests",
        fullName: "octo-work/api-tests",
        httpsUrl: "https://github.com/octo-work/api-tests.git",
        sshUrl: "git@github.com:octo-work/api-tests.git",
        private: true,
        empty: true,
        canPush: true,
      },
      problem: null,
    })
    const [, , post, topics] = calls
    expect(JSON.parse(post?.input ?? "")).toEqual({ name: "api-tests", private: true, auto_init: false })
    expect(JSON.parse(topics?.input ?? "")).toEqual({ names: [APIWEAVE_REPOSITORY_TOPIC] })
    expect(calls.slice(1).every((call) => call.env?.GH_TOKEN === TOKEN)).toBe(true)
  })

  it("creates under an organization through the organization's endpoint", async () => {
    const { service, calls } = fakeCli({
      ...GH_TOKEN_CALL,
      "gh api --hostname=github.com repos/acme/api-tests": GH_NOT_FOUND,
      "gh api --hostname=github.com --method=POST orgs/acme/repos --input=-": exited(GH_REPO.replaceAll("octo-work", "acme")),
      "gh api --hostname=github.com --method=PUT repos/acme/api-tests/topics --input=-": exited("{}"),
    })

    const created = await service.createRepository(GITHUB, { ...REQUEST, owner: "acme", private: false })

    expect(created.repository.fullName).toBe("acme/api-tests")
    expect(JSON.parse(calls[2]?.input ?? "")).toMatchObject({ private: false })
  })

  it("refuses a name that already exists, naming it, and creates nothing", async () => {
    const { service, calls } = fakeCli({ ...GH_TOKEN_CALL, "gh api --hostname=github.com repos/octo-work/api-tests": exited(GH_REPO) })

    const error = await service.createRepository(GITHUB, REQUEST).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as Error).message).toMatch(/^github\.com\/octo-work\/api-tests already exists\./)
    expect(calls.some((call) => call.args.includes("--method=POST"))).toBe(false)
  })

  it("reports the host's 'already exists' — a race with another creation — as the name that exists", async () => {
    const { service } = fakeCli({
      ...GH_TOKEN_CALL,
      "gh api --hostname=github.com repos/octo-work/api-tests": GH_NOT_FOUND,
      // GitHub's 422 for a taken name (docs.github.com/rest/repos/repos#create-a-repository-for-the-authenticated-user).
      "gh api --hostname=github.com --method=POST user/repos --input=-": exited(
        '{"message":"Repository creation failed.","errors":[{"resource":"Repository","code":"custom","field":"name","message":"name already exists on this account"}],"status":"422"}',
        1,
        "gh: Repository creation failed. (HTTP 422)\n",
      ),
    })

    await expect(service.createRepository(GITHUB, REQUEST)).rejects.toBeInstanceOf(ConflictError)
  })

  it("keeps a repository it could not tag, saying so instead of failing", async () => {
    const { service } = fakeCli({
      ...GH_TOKEN_CALL,
      "gh api --hostname=github.com repos/octo-work/api-tests": GH_NOT_FOUND,
      "gh api --hostname=github.com --method=POST user/repos --input=-": exited(GH_REPO),
      "gh api --hostname=github.com --method=PUT repos/octo-work/api-tests/topics --input=-": exited('{"message":"Resource not accessible by integration"}', 1, "gh: Resource not accessible by integration (HTTP 403)\n"),
    })

    const created = await service.createRepository(GITHUB, REQUEST)

    expect(created.repository.fullName).toBe("octo-work/api-tests")
    expect(created.problem).toBe("octo-work/api-tests was created, but not tagged apiweave-workspace: Resource not accessible by integration")
  })

  it("stops when it cannot tell whether the repository exists", async () => {
    const { service, calls } = fakeCli({
      ...GH_TOKEN_CALL,
      "gh api --hostname=github.com repos/octo-work/api-tests": { status: "timeout", exitCode: undefined, errorCode: undefined, stdout: "", stderr: "" },
    })

    await expect(service.createRepository(GITHUB, REQUEST)).rejects.toThrow("could not check whether github.com/octo-work/api-tests exists: gh did not answer in time")
    expect(calls).toHaveLength(2)
  })

  it.each([
    { what: "a name that starts with -", request: { ...REQUEST, name: "-oProxyCommand" } },
    { what: "a name with a slash", request: { ...REQUEST, name: "a/b" } },
    { what: "a name with two special characters in a row", request: { ...REQUEST, name: "a..b" } },
    { what: "a name ending in .git", request: { ...REQUEST, name: "tests.git" } },
    { what: "an owner with a path traversal", request: { ...REQUEST, owner: "../orgs" } },
    { what: "a GitHub owner with a subgroup", request: { ...REQUEST, owner: "acme/qa" } },
  ])("refuses $what before any tool runs", async ({ request }) => {
    const { service, calls } = fakeCli({})

    await expect(service.createRepository(GITHUB, request)).rejects.toBeInstanceOf(ValidationError)
    expect(calls).toEqual([])
  })

  it("creates an empty, tagged GitLab project in a subgroup, by the group's namespace id", async () => {
    const { service, calls } = fakeCli({
      ...GLAB_STATUS_CALL,
      "glab api --hostname=gitlab.com projects/acme%2Fqa%2Fapi-tests": GLAB_NOT_FOUND,
      "glab api --hostname=gitlab.com groups/acme%2Fqa": exited(JSON.stringify({ id: 7, name: "QA", path: "qa", full_path: "acme/qa" })),
      "glab api --hostname=gitlab.com --method=POST projects --input=-": exited(GITLAB_PROJECT),
    })

    const created = await service.createRepository(GITLAB, { owner: "acme/qa", name: "api-tests", private: true })

    expect(created).toEqual({
      repository: {
        owner: "acme/qa",
        name: "api-tests",
        fullName: "acme/qa/api-tests",
        httpsUrl: "https://gitlab.com/acme/qa/api-tests.git",
        sshUrl: "git@gitlab.com:acme/qa/api-tests.git",
        private: true,
        empty: true,
        canPush: true,
      },
      problem: null,
    })
    expect(JSON.parse(calls.at(-1)?.input ?? "")).toEqual({
      name: "api-tests",
      path: "api-tests",
      namespace_id: 7,
      visibility: "private",
      initialize_with_readme: false,
      topics: [APIWEAVE_REPOSITORY_TOPIC],
    })
  })

  it("creates a GitLab project in the account's own namespace without a namespace id", async () => {
    const { service, calls } = fakeCli({
      ...GLAB_STATUS_CALL,
      "glab api --hostname=gitlab.com projects/tanuki%2Fapi-tests": GLAB_NOT_FOUND,
      "glab api --hostname=gitlab.com --method=POST projects --input=-": exited(GITLAB_PROJECT),
    })

    await service.createRepository(GITLAB, { owner: "tanuki", name: "api-tests", private: false })

    expect(JSON.parse(calls.at(-1)?.input ?? "")).not.toHaveProperty("namespace_id")
    expect(JSON.parse(calls.at(-1)?.input ?? "")).toMatchObject({ visibility: "public" })
  })

  it("reports GitLab's 'has already been taken' as the name that exists", async () => {
    const { service } = fakeCli({
      ...GLAB_STATUS_CALL,
      "glab api --hostname=gitlab.com projects/tanuki%2Fapi-tests": GLAB_NOT_FOUND,
      // A refused field is an object of complaints (docs.gitlab.com/api/rest/troubleshooting), which glab prints on stdout.
      "glab api --hostname=gitlab.com --method=POST projects --input=-": exited(
        '{"message":{"name":["has already been taken"],"path":["has already been taken"]}}',
        1,
        "glab: map[message:map[name:[has already been taken] path:[has already been taken]]]\n",
      ),
    })

    await expect(service.createRepository(GITLAB, { owner: "tanuki", name: "api-tests", private: true })).rejects.toThrow(
      "gitlab.com/tanuki/api-tests already exists.",
    )
  })
})

describe("hostCliRunner's environment", () => {
  it("sets a call's own variables on that process only, and keeps gh's debug log off", async () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-fake-gh-"))
    try {
      if (process.platform === "win32") {
        fs.writeFileSync(path.join(bin, "gh.cmd"), "@echo off\r\necho %GH_TOKEN%^|%GH_DEBUG%\r\n")
      } else {
        fs.writeFileSync(path.join(bin, "gh"), '#!/bin/sh\necho "$GH_TOKEN|$GH_DEBUG"\n', { mode: 0o755 })
      }
      const windows = { PATHEXT: ".CMD;.EXE", SystemRoot: process.env.SystemRoot ?? "", COMSPEC: process.env.ComSpec ?? "cmd.exe" }
      const run = hostCliRunner({ PATH: bin, ...(process.platform === "win32" ? windows : {}), DEBUG: "api" })

      const outcome = await run("gh", ["api", "user"], { timeoutMs: 10_000, env: { GH_TOKEN: "t0ken" } })

      expect(outcome.stdout.trim(), JSON.stringify(outcome)).toBe("t0ken|0")
      expect(process.env.GH_TOKEN).not.toBe("t0ken")
    } finally {
      fs.rmSync(bin, { recursive: true, force: true })
    }
  })
})
