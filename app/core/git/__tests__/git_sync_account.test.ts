import { inspect } from "node:util"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { GitAccountRef } from "@shared/types/GitAccountRef"
import { GitAccountUnavailableError } from "../git_errors"
import type { GitService } from "../git_service"
import type { GitSyncGit } from "../git_sync_service"
import type { GitCredential, GitRemoteOptions } from "../git_types"
import { openHarness, passthrough, type Harness } from "./git_sync_harness"
import { credentialServer, makeBareRemote, rawGit } from "./git_test_utils"

/**
 * A workspace bound to a `gh`/`glab` account. The remote is an HTTPS URL on a
 * host that does not exist; underneath, git is routed to a local repository,
 * and every network call records the credential the service handed it.
 */

const REMOTE_URL = "https://git.example.test/acme/tests.git"
const TOKEN = "gho_SYNCTOKEN0123456789abcdefABCDEF012345"
const ACCOUNT: GitAccountRef = { provider: "github", host: "git.example.test", login: "octo-personal" }

afterEach(() => {
  vi.restoreAllMocks()
})

interface NetworkCall {
  readonly command: "fetch" | "push" | "clone"
  readonly credential: GitCredential | undefined
}

interface AccountHarness {
  readonly harness: Harness
  readonly calls: NetworkCall[]
  readonly credentials: ReturnType<typeof vi.fn>
}

/** What each remote URL the service is given stands for underneath: `REMOTE_URL` a local repository, unless a test points it elsewhere. */
interface Routes {
  readonly urls: Map<string, string>
  /** Rewrites the credential before real git gets it, so a local http server can be reached with it. */
  rewrite: (credential: GitCredential | undefined) => GitCredential | undefined
}

function routed(git: GitService, routes: Routes, calls: NetworkCall[]): GitSyncGit {
  const real = passthrough(git)
  const route = (url: string): string => routes.urls.get(url) ?? url
  const withCredential = (command: NetworkCall["command"], options: GitRemoteOptions | undefined): GitRemoteOptions => {
    calls.push({ command, credential: options?.credential })
    return { credential: routes.rewrite(options?.credential) }
  }
  return {
    ...real,
    remoteAdd: (directory, name, url) => real.remoteAdd(directory, name, route(url)),
    remoteSetUrl: (directory, name, url) => real.remoteSetUrl(directory, name, route(url)),
    fetch: (directory, remote, options) => real.fetch(directory, remote, withCredential("fetch", options)),
    push: (directory, remote, branch, options) =>
      real.push(directory, remote, branch, { ...withCredential("push", options), ...(options?.setUpstream === true ? { setUpstream: true } : {}) }),
    clone: (url, destination, options) => real.clone(route(url), destination, withCredential("clone", options)),
  }
}

async function accountHarness(
  credentials: (account: GitAccountRef) => Promise<GitCredential> = async () => ({
    protocol: "https",
    host: ACCOUNT.host,
    username: "x-access-token",
    password: TOKEN,
  }),
): Promise<AccountHarness & { readonly routes: Routes; readonly remote: { dir: string; url: string } }> {
  const calls: NetworkCall[] = []
  const routes: Routes = { urls: new Map(), rewrite: (credential) => credential }
  const spy = vi.fn(credentials)
  const harness = openHarness({ wrap: (git) => routed(git, routes, calls), credentials: spy })
  const remote = makeBareRemote(harness.sandbox)
  routes.urls.set(REMOTE_URL, remote.url)
  await harness.sync.track(harness.workspaceId)
  return { harness, calls, credentials: spy, routes, remote }
}

/** Every column of the workspace's row, as text: what the database holds about it. */
function rowText(harness: Harness): string {
  return JSON.stringify(harness.db.kvStore.get("SELECT * FROM workspace_git WHERE workspace_id = ?", [harness.workspaceId]))
}

const EXPECTED_CREDENTIAL: GitCredential = { protocol: "https", host: "git.example.test", username: "x-access-token", password: TOKEN }

describe("a workspace bound to an account", () => {
  it("connects as the account: its token on the fetch and the first push, its name on the row, its token nowhere", async () => {
    const { harness, calls, credentials, remote } = await accountHarness()

    const status = await harness.sync.connectRemote(harness.workspaceId, REMOTE_URL, ACCOUNT)

    expect(credentials).toHaveBeenCalledWith(ACCOUNT)
    expect(calls).toEqual([
      { command: "fetch", credential: EXPECTED_CREDENTIAL },
      { command: "push", credential: EXPECTED_CREDENTIAL },
    ])
    expect(status).toMatchObject({ remoteUrl: REMOTE_URL, account: ACCOUNT, state: "idle", lastError: null })
    expect(rawGit(remote.dir, harness.sandbox.env, "rev-parse", "main").trim()).toBe(status.lastCommit?.sha)
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)?.account).toEqual(ACCOUNT)
    expect(rowText(harness)).not.toContain(TOKEN)
    expect(JSON.stringify(status)).not.toContain(TOKEN)
  })

  it("syncs as the account: every fetch and push of a cycle asks for the token afresh", async () => {
    const { harness, calls, credentials } = await accountHarness()
    await harness.sync.connectRemote(harness.workspaceId, REMOTE_URL, ACCOUNT)
    harness.repositories.workspaces.update(harness.workspaceId, { name: "Renamed" })
    calls.length = 0
    credentials.mockClear()

    const status = await harness.sync.syncNow(harness.workspaceId)

    expect(status).toMatchObject({ state: "idle", lastError: null, outgoing: 0 })
    expect(calls.map((call) => call.command)).toEqual(["fetch", "push"])
    expect(calls.every((call) => call.credential?.password === TOKEN)).toBe(true)
    expect(credentials).toHaveBeenCalledTimes(2)
  })

  it("records an account the tool cannot sign in as as the cycle's outcome, and recovers with the next good fetch", async () => {
    let available = true
    const { harness } = await accountHarness(async () => {
      if (!available) throw new GitAccountUnavailableError("gh could not sign in to git.example.test as octo-personal: no oauth token found")
      return EXPECTED_CREDENTIAL
    })
    await harness.sync.connectRemote(harness.workspaceId, REMOTE_URL, ACCOUNT)
    available = false

    const failed = await harness.sync.syncNow(harness.workspaceId)
    expect(failed).toMatchObject({ state: "error", lastError: { code: "account_unavailable" } })

    available = true
    expect(await harness.sync.syncNow(harness.workspaceId)).toMatchObject({ state: "idle", lastError: null })
  })

  it("never lets the token reach the status, the database or the log, even when the remote echoes it", async () => {
    const { harness, routes } = await accountHarness()
    await harness.sync.connectRemote(harness.workspaceId, REMOTE_URL, ACCOUNT)
    const server = await credentialServer((credential) => `you sent ${credential}`)
    rawGit(harness.dir, harness.sandbox.env, "remote", "set-url", "origin", server.url)
    routes.rewrite = (credential) => (credential === undefined ? undefined : { ...credential, protocol: "http", host: server.host })
    const logged = [vi.spyOn(console, "warn"), vi.spyOn(console, "error")]

    const status = await harness.sync.syncNow(harness.workspaceId)

    expect(server.seen).toEqual([`x-access-token:${TOKEN}`])
    expect(status.lastError?.message).toContain("you sent x-access-token:***")
    expect(JSON.stringify(status)).not.toContain(TOKEN)
    expect(rowText(harness)).not.toContain(TOKEN)
    const output = logged.flatMap((spy) => spy.mock.calls).map((args) => inspect(args, { depth: 8 })).join("\n")
    expect(output).toContain("you sent x-access-token:***")
    expect(output).not.toContain(TOKEN)
  })

  it("is refused, and nothing changes, when the account is on another host", async () => {
    const { harness, calls, credentials } = await accountHarness()
    const elsewhere: GitAccountRef = { provider: "gitlab", host: "gitlab.com", login: "tanuki" }

    await expect(harness.sync.connectRemote(harness.workspaceId, REMOTE_URL, elsewhere)).rejects.toThrow(
      "tanuki signs in to gitlab.com, but this remote is on git.example.test",
    )
    await expect(harness.sync.connectRemote(harness.workspaceId, makeBareRemote(harness.sandbox, "local.git").url, ACCOUNT)).rejects.toThrow(
      "needs no account",
    )

    expect(calls).toEqual([])
    expect(credentials).not.toHaveBeenCalled()
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)).toMatchObject({ remoteUrl: null, account: null })
  })

  it("over SSH carries no token: the user's own key answers whichever account is bound", async () => {
    const { harness, calls, credentials, routes, remote } = await accountHarness()
    const sshUrl = "git@git.example.test:acme/tests.git"
    routes.urls.set(sshUrl, remote.url)

    const status = await harness.sync.connectRemote(harness.workspaceId, sshUrl, ACCOUNT)

    expect(status).toMatchObject({ remoteUrl: sshUrl, account: ACCOUNT })
    expect(calls.map((call) => call.credential)).toEqual([undefined, undefined])
    expect(credentials).not.toHaveBeenCalled()
  })

  it("changes account on a connected workspace, clears a refusal that was the old account's, and goes back to none", async () => {
    const { harness, credentials } = await accountHarness()
    await harness.sync.connectRemote(harness.workspaceId, REMOTE_URL, null)
    harness.repositories.workspaceGit.setReadOnly(harness.workspaceId, true)
    expect(credentials).not.toHaveBeenCalled()

    expect(await harness.sync.setAccount(harness.workspaceId, ACCOUNT)).toMatchObject({ account: ACCOUNT, readOnly: false })
    expect(await harness.sync.setAccount(harness.workspaceId, null)).toMatchObject({ account: null })
    await expect(harness.sync.setAccount(harness.workspaceId, { provider: "gitlab", host: "gitlab.com", login: "tanuki" })).rejects.toThrow(
      "this remote is on git.example.test",
    )
  })

  it("has no account to change before a remote is connected, and loses it with the remote", async () => {
    const { harness } = await accountHarness()
    await expect(harness.sync.setAccount(harness.workspaceId, ACCOUNT)).rejects.toThrow("not connected to a remote")

    await harness.sync.connectRemote(harness.workspaceId, REMOTE_URL, ACCOUNT)
    const status = await harness.sync.disconnectRemote(harness.workspaceId)

    expect(status).toMatchObject({ remoteUrl: null, account: null })
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)?.account).toBeNull()
  })

  it("opens a workspace from git as the account: the clone carries its token, and the new row names it", async () => {
    const source = await accountHarness()
    await source.harness.sync.connectRemote(source.harness.workspaceId, REMOTE_URL, null)
    const { harness, calls, routes } = await accountHarness()
    routes.urls.set(REMOTE_URL, source.remote.url)

    const opened = await harness.sync.openFromGit(REMOTE_URL, ACCOUNT)

    expect(opened).toMatchObject({ kind: "opened", workspaceId: source.harness.workspaceId })
    expect(calls).toEqual([{ command: "clone", credential: EXPECTED_CREDENTIAL }])
    expect(harness.repositories.workspaceGit.get(source.harness.workspaceId)).toMatchObject({ remoteUrl: REMOTE_URL, account: ACCOUNT })
  })
})

describe("a workspace with no account", () => {
  it("never asks for a token: every call is the user's own credentials, as before accounts", async () => {
    const { harness, calls, credentials } = await accountHarness()

    await harness.sync.connectRemote(harness.workspaceId, REMOTE_URL)
    harness.repositories.workspaces.update(harness.workspaceId, { name: "Renamed" })
    await harness.sync.syncNow(harness.workspaceId)

    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.credential === undefined)).toBe(true)
    expect(credentials).not.toHaveBeenCalled()
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)?.account).toBeNull()
  })
})
