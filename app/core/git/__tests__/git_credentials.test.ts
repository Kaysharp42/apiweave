import fs from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as GitProcess from "../git_process"
import { GitAuthFailedError, GitError, type GitProcessError } from "../git_errors"
import type { GitCredential } from "../git_types"
import { credentialServer, makeSandbox, makeTempDir, rawGit, writeFile, type CredentialServer, type GitSandbox } from "./git_test_utils"

/**
 * The per-call credential, proved with real git against a local endpoint that
 * speaks just enough smart HTTP to ask for a password and record the one it
 * gets. Runs on the Windows CI job too: Git for Windows starts a `!` helper
 * through its own bundled `sh`, which is what this exercises there.
 */

/** Every git process the service starts: its argv and its environment. */
const spawned = vi.hoisted(() => [] as { readonly args: readonly string[]; readonly env: NodeJS.ProcessEnv }[])

vi.mock("../git_process", async (importOriginal) => {
  const actual = await importOriginal<typeof GitProcess>()
  return {
    ...actual,
    execGit: (file: string, args: readonly string[], options: GitProcess.GitExecOptions) => {
      spawned.push({ args, env: options.env })
      return actual.execGit(file, args, options)
    },
  }
})

const TOKEN = "gho_TESTTOKEN0123456789abcdefABCDEF0123"
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64")

beforeEach(() => {
  spawned.length = 0
})

/**
 * What a user with two GitHub accounts has: a credential helper scoped to the
 * host, answering as whichever account is active — here, the wrong one — and
 * a catch-all helper besides. Written to the sandbox's global config, exactly
 * where `gh auth setup-git` writes the real one.
 */
function configureUserHelpers(sandbox: GitSandbox, host: string): string {
  const touched = path.join(sandbox.root, "catch-all-helper-ran")
  rawGit(
    sandbox.root,
    sandbox.env,
    "config",
    "--global",
    `credential.http://${host}.helper`,
    '!f() { test "$1" = get && printf "username=wrong-user\\npassword=wrong-password\\n"; }; f',
  )
  rawGit(sandbox.root, sandbox.env, "config", "--global", "--add", "credential.helper", `!f() { echo ran >> "${touched.replace(/\\/g, "/")}"; }; f`)
  return touched
}

function credentialFor(server: CredentialServer, overrides: Partial<GitCredential> = {}): GitCredential {
  return { protocol: "http", host: server.host, url: server.url, username: "x-access-token", password: TOKEN, ...overrides }
}

async function repoWithRemote(sandbox: GitSandbox, url: string): Promise<string> {
  const dir = path.join(sandbox.root, "repo")
  await sandbox.service.init(dir, { initialBranch: "main" })
  writeFile(dir, "a.json", "{}\n")
  await sandbox.service.add(dir, ["a.json"])
  await sandbox.service.commit(dir, "first")
  await sandbox.service.remoteAdd(dir, "origin", url)
  return dir
}

describe("a call with a credential", () => {
  it("is answered with that credential on fetch, push and clone, over a URL-scoped helper for the same host", async () => {
    const sandbox = makeSandbox()
    const server = await credentialServer()
    const catchAllRan = configureUserHelpers(sandbox, server.host)
    const dir = await repoWithRemote(sandbox, server.url)
    const credential = credentialFor(server)

    await expect(sandbox.service.fetch(dir, "origin", { credential })).rejects.toBeInstanceOf(GitError)
    await expect(sandbox.service.push(dir, "origin", "main", { credential })).rejects.toBeInstanceOf(GitError)
    await expect(sandbox.service.clone(server.url, path.join(sandbox.root, "clone"), { credential })).rejects.toBeInstanceOf(GitError)

    expect(server.seen.length).toBeGreaterThanOrEqual(3)
    expect(new Set(server.seen)).toEqual(new Set([`x-access-token:${TOKEN}`]))
    expect(fs.existsSync(catchAllRan)).toBe(false)
  })

  it("is what makes the difference: without one, the user's URL-scoped helper answers", async () => {
    const sandbox = makeSandbox()
    const server = await credentialServer()
    configureUserHelpers(sandbox, server.host)
    const dir = await repoWithRemote(sandbox, server.url)

    await expect(sandbox.service.fetch(dir, "origin")).rejects.toBeInstanceOf(GitError)

    expect(server.seen).toEqual(["wrong-user:wrong-password"])
  })

  it("answers nothing for another host or protocol, so the token never leaves for one", async () => {
    const sandbox = makeSandbox()
    const server = await credentialServer()
    const dir = await repoWithRemote(sandbox, server.url)

    for (const credential of [credentialFor(server, { host: "github.com" }), credentialFor(server, { protocol: "https" })]) {
      const error = await sandbox.service.fetch(dir, "origin", { credential }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(GitAuthFailedError)
    }
    expect(server.seen).toEqual([])
  })

  it("never lets the token reach an error, even when the remote echoes it", async () => {
    const sandbox = makeSandbox()
    const server = await credentialServer((credential) => `you sent ${credential} as ${Buffer.from(credential).toString("base64")}`)
    const dir = await repoWithRemote(sandbox, server.url)

    const error = await sandbox.service.fetch(dir, "origin", { credential: credentialFor(server) }).catch((caught: unknown) => caught)

    expect(server.seen).toEqual([`x-access-token:${TOKEN}`])
    expect(error).toBeInstanceOf(GitError)
    const shown = JSON.stringify({ message: (error as GitError).message, details: (error as GitProcessError).details })
    expect(shown).toContain("remote error: you sent x-access-token:***")
    expect(shown).not.toContain(TOKEN)
    expect(shown).not.toContain(BASIC)
  })

  it("carries the token in that process's environment only: never in argv, and never left in the clone", async () => {
    const sandbox = makeSandbox()
    const server = await credentialServer()
    const dir = await repoWithRemote(sandbox, server.url)
    spawned.length = 0

    await sandbox.service.fetch(dir, "origin", { credential: credentialFor(server) }).catch(() => undefined)
    await sandbox.service.status(dir)

    const [fetch, status] = spawned
    expect(fetch?.args.join(" ")).not.toContain(TOKEN)
    expect(fetch?.args).toContain("credential.helper=")
    expect(fetch?.env["APIWEAVE_GIT_PASSWORD"]).toBe(TOKEN)
    expect(status?.env["APIWEAVE_GIT_PASSWORD"]).toBeUndefined()
    expect(status?.args.some((arg) => arg.startsWith("credential.helper"))).toBe(false)
    expect(fs.readFileSync(path.join(dir, ".git", "config"), "utf8")).not.toMatch(/credential|APIWEAVE|gho_/)
  })

  it("falls back to no prompt program when the helper declines: GIT_ASKPASS (VS Code sets one) never runs", async () => {
    const scripts = makeTempDir("apiweave-askpass-")
    const marker = path.join(scripts, "askpass-ran")
    const askpass = path.join(scripts, "askpass")
    fs.writeFileSync(askpass, `#!/bin/sh\necho ran >> "${marker.replace(/\\/g, "/")}"\necho wrong\n`, { mode: 0o755 })
    const sandbox = makeSandbox({ env: { GIT_ASKPASS: askpass.replace(/\\/g, "/") } })
    const server = await credentialServer()
    const dir = await repoWithRemote(sandbox, server.url)

    // Control: with no credential, git asks the prompt program — so the program does run here.
    await sandbox.service.fetch(dir, "origin").catch(() => undefined)
    expect(fs.existsSync(marker)).toBe(true)
    fs.rmSync(marker)
    server.seen.length = 0

    const error = await sandbox.service.fetch(dir, "origin", { credential: credentialFor(server, { host: "github.com" }) }).catch((caught: unknown) => caught)

    expect(fs.existsSync(marker)).toBe(false)
    expect(server.seen).toEqual([])
    expect(error).toBeInstanceOf(GitAuthFailedError)
  })

  it("sets aside a user's http.extraHeader Authorization, scoped to the URL or not", async () => {
    const sandbox = makeSandbox()
    const server = await credentialServer()
    const dir = await repoWithRemote(sandbox, server.url)
    const header = (who: string): string => `Authorization: Basic ${Buffer.from(`${who}:${who}`).toString("base64")}`
    rawGit(sandbox.root, sandbox.env, "config", "--global", `http.http://${server.host}/.extraHeader`, header("scoped"))
    rawGit(sandbox.root, sandbox.env, "config", "--global", "http.extraHeader", header("unscoped"))

    // Control: without a credential, the configured header is what is sent.
    await sandbox.service.fetch(dir, "origin").catch(() => undefined)
    expect(server.seen).toEqual(["scoped:scoped"])
    server.seen.length = 0

    await sandbox.service.fetch(dir, "origin", { credential: credentialFor(server) }).catch(() => undefined)

    expect(server.seen).toEqual([`x-access-token:${TOKEN}`])
  })

  it("drops tracing that would write the Authorization header to disk", async () => {
    const traces = makeTempDir("apiweave-trace-")
    const trace = path.join(traces, "curl.trace")
    const sandbox = makeSandbox({ env: { GIT_TRACE_CURL: trace, GIT_TRACE_REDACT: "0", GIT_TRACE: path.join(traces, "trace") } })
    const server = await credentialServer()
    const dir = await repoWithRemote(sandbox, server.url)

    // Control: a call without a credential is traced as the user asked.
    await sandbox.service.fetch(dir, "origin").catch(() => undefined)
    expect(fs.existsSync(trace)).toBe(true)
    fs.rmSync(traces, { recursive: true, force: true })
    fs.mkdirSync(traces)
    spawned.length = 0

    await sandbox.service.fetch(dir, "origin", { credential: credentialFor(server) }).catch(() => undefined)

    expect(server.seen).toEqual([`x-access-token:${TOKEN}`])
    expect(fs.readdirSync(traces)).toEqual([])
    expect(Object.keys(spawned[0]?.env ?? {}).filter((name) => /^GIT_TRACE|^GIT_CURL_VERBOSE$/.test(name))).toEqual([])
  })
})

describe("the URL git will really use", () => {
  it("applies the user's insteadOf and pushInsteadOf rules to a remote, and insteadOf to a clone URL", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithRemote(sandbox, "https://github.com/acme/tests.git")
    rawGit(sandbox.root, sandbox.env, "config", "--global", "url.git@github.com:.insteadOf", "https://github.com/")
    rawGit(sandbox.root, sandbox.env, "config", "--global", "url.ssh://push.example/.pushInsteadOf", "https://github.com/")

    expect(await sandbox.service.remoteUrl(dir, "origin")).toBe("git@github.com:acme/tests.git")
    expect(await sandbox.service.remoteUrl(dir, "origin", { push: true })).toBe("ssh://push.example/acme/tests.git")
    expect(await sandbox.service.resolvedUrl("https://github.com/acme/tests.git", sandbox.root)).toBe("git@github.com:acme/tests.git")
    expect(await sandbox.service.resolvedUrl("https://gitlab.com/acme/tests.git", sandbox.root)).toBe("https://gitlab.com/acme/tests.git")
  })
})

describe("a call without a credential", () => {
  it("runs exactly as it did before accounts: no helper override, no credential variables", async () => {
    const sandbox = makeSandbox()
    const server = await credentialServer()
    const dir = await repoWithRemote(sandbox, server.url)
    spawned.length = 0

    await sandbox.service.fetch(dir, "origin").catch(() => undefined)
    await sandbox.service.push(dir, "origin", "main").catch(() => undefined)

    expect(spawned).toHaveLength(2)
    for (const call of spawned) {
      expect(call.args.some((arg) => arg.startsWith("credential.helper"))).toBe(false)
      expect(Object.keys(call.env).filter((name) => name.startsWith("APIWEAVE_GIT_"))).toEqual([])
    }
  })
})
