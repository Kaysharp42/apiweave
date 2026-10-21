import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { GitInvalidArgumentError } from "../git_errors"
import { openHarness, passthrough, subjects, type Harness } from "./git_sync_harness"
import { makeBareRemote, rawGit, writeFile } from "./git_test_utils"

const TRACK_FIRST = "Track this workspace's version history before connecting a remote."
const ALREADY_CONNECTED = "This workspace is already connected to a remote. Disconnect it first."
const UNRELATED = "That repository already has history this workspace did not come from. Open a workspace from git instead."

async function trackedHarness(options?: Parameters<typeof openHarness>[0]): Promise<Harness> {
  const harness = openHarness(options)
  await harness.sync.track(harness.workspaceId)
  return harness
}

function remotesOf(harness: Harness): string[] {
  return rawGit(harness.dir, harness.sandbox.env, "remote").split("\n").filter((line) => line !== "")
}

function binding(harness: Harness) {
  const row = harness.repositories.workspaceGit.get(harness.workspaceId)
  if (row === undefined) throw new Error("the workspace is not tracked")
  return row
}

/** A bare repository holding a history of its own on `branch`, which shares no commit with any workspace. */
async function unrelatedRemote(harness: Harness, branch = "main"): Promise<{ dir: string; url: string }> {
  const remote = makeBareRemote(harness.sandbox, `unrelated-${branch}.git`)
  const other = path.join(harness.sandbox.root, `other-${branch}`)
  await harness.git.init(other, { initialBranch: branch })
  writeFile(other, "README.md", "someone else's project\n")
  await harness.git.add(other, ["README.md"])
  await harness.git.commit(other, "initial")
  await harness.git.remoteAdd(other, "origin", remote.url)
  await harness.git.push(other, "origin", branch)
  return remote
}

/** A bare copy of the workspace's own clone: a remote this workspace's history is already on. */
function relatedRemote(harness: Harness): { dir: string; url: string } {
  const dir = path.join(harness.sandbox.root, "related.git")
  rawGit(harness.sandbox.root, harness.sandbox.env, "clone", "--bare", harness.dir, dir)
  return { dir, url: pathToFileURL(dir).href }
}

function headOf(harness: Harness, repository: string, rev = "HEAD"): string {
  return rawGit(repository, harness.sandbox.env, "rev-parse", rev).trim()
}

describe("GitSyncService.connectRemote", () => {
  it("pushes the history to an empty repository and binds the workspace to it", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)

    const status = await harness.sync.connectRemote(harness.workspaceId, `  ${remote.url}  `)

    expect(status).toMatchObject({ tracked: true, remoteUrl: remote.url, branch: "main", state: "idle", lastError: null })
    expect(binding(harness)).toMatchObject({ remoteUrl: remote.url, branch: "main", lastSyncedCommit: null, lastSyncedAt: null })
    const head = headOf(harness, harness.dir)
    expect(headOf(harness, harness.dir, "origin/main")).toBe(head)
    expect(headOf(harness, remote.dir, "main")).toBe(head)
    expect((await harness.git.status(harness.dir)).upstream).toBe("origin/main")
    expect(await subjects(harness)).toEqual(["Start tracking this workspace in APIWeave"])
    expect(status.lastCommit?.sha).toBe(head)
  })

  it("announces the status it leaves behind, on connect and on disconnect", async () => {
    const announced: Array<string | null> = []
    const harness = await trackedHarness({ onStatusChanged: (status) => announced.push(status.remoteUrl) })
    const remote = makeBareRemote(harness.sandbox)
    announced.length = 0

    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    expect(announced).toEqual([remote.url])

    await harness.sync.disconnectRemote(harness.workspaceId)
    expect(announced).toEqual([remote.url, null])
  })

  it("refuses a repository whose history is not this workspace's, and leaves no trace of the attempt", async () => {
    const harness = await trackedHarness()
    const remote = await unrelatedRemote(harness)
    const before = binding(harness)

    await expect(harness.sync.connectRemote(harness.workspaceId, remote.url)).rejects.toThrow(UNRELATED)

    expect(binding(harness)).toEqual(before)
    expect(remotesOf(harness)).toEqual([])
    expect(headOf(harness, remote.dir, "main")).not.toBe(headOf(harness, harness.dir))
  })

  it("refuses a repository that has history only on another branch, as someone else's project", async () => {
    const harness = await trackedHarness()
    const remote = await unrelatedRemote(harness, "master")
    const before = binding(harness)

    await expect(harness.sync.connectRemote(harness.workspaceId, remote.url)).rejects.toThrow(UNRELATED)

    expect(binding(harness)).toEqual(before)
    expect(remotesOf(harness)).toEqual([])
    expect(rawGit(remote.dir, harness.sandbox.env, "for-each-ref", "--format=%(refname)").trim()).toBe("refs/heads/master")
  })

  it("refuses an empty working copy with a message that says so, and adds no remote", async () => {
    const harness = await trackedHarness()
    const workingCopy = path.join(harness.sandbox.root, "working-copy")
    rawGit(harness.sandbox.root, harness.sandbox.env, "init", "--initial-branch=main", workingCopy)
    const before = binding(harness)

    await expect(harness.sync.connectRemote(harness.workspaceId, pathToFileURL(workingCopy).href)).rejects.toThrow(
      "That repository is a working copy, not a bare repository",
    )

    expect(binding(harness)).toEqual(before)
    expect(remotesOf(harness)).toEqual([])
  })

  it.each([
    ["a path that does not exist", (root: string) => pathToFileURL(path.join(root, "missing.git")).href],
    ["a folder that is not a repository", (root: string) => {
      const folder = path.join(root, "plain-folder")
      fs.mkdirSync(folder)
      return pathToFileURL(folder).href
    }],
  ])("rejects %s and removes the remote it added", async (_label, urlFor) => {
    const harness = await trackedHarness()
    const before = binding(harness)

    await expect(harness.sync.connectRemote(harness.workspaceId, urlFor(harness.sandbox.root))).rejects.toThrow(/git fetch failed/)

    expect(binding(harness)).toEqual(before)
    expect(remotesOf(harness)).toEqual([])
  })

  it("joins a repository that already holds this history, and pushes nothing", async () => {
    const harness = await trackedHarness()
    const remote = relatedRemote(harness)
    const remoteHead = headOf(harness, remote.dir, "main")
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await harness.sync.commitLocal(harness.workspaceId, { message: "Add login" })

    const status = await harness.sync.connectRemote(harness.workspaceId, remote.url)

    expect(status.remoteUrl).toBe(remote.url)
    expect(headOf(harness, remote.dir, "main")).toBe(remoteHead)
    expect(headOf(harness, harness.dir)).not.toBe(remoteHead)
    expect(await subjects(harness)).toEqual(["Add login", "Start tracking this workspace in APIWeave"])
  })

  it("refuses a second connect and leaves the binding as it was", async () => {
    const harness = await trackedHarness()
    const first = makeBareRemote(harness.sandbox, "first.git")
    const second = makeBareRemote(harness.sandbox, "second.git")
    await harness.sync.connectRemote(harness.workspaceId, first.url)
    const before = binding(harness)

    await expect(harness.sync.connectRemote(harness.workspaceId, second.url)).rejects.toThrow(ALREADY_CONNECTED)

    expect(binding(harness)).toEqual(before)
    expect(rawGit(harness.dir, harness.sandbox.env, "remote", "get-url", "origin").trim()).toBe(first.url)
    expect(rawGit(second.dir, harness.sandbox.env, "for-each-ref").trim()).toBe("")
  })

  it("takes over an origin an adopted clone already had, pointing it at the new URL", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    rawGit(harness.dir, harness.sandbox.env, "remote", "add", "origin", "file:///stale/elsewhere.git")

    const status = await harness.sync.connectRemote(harness.workspaceId, remote.url)

    expect(status.remoteUrl).toBe(remote.url)
    expect(rawGit(harness.dir, harness.sandbox.env, "remote", "get-url", "origin").trim()).toBe(remote.url)
    expect(headOf(harness, remote.dir, "main")).toBe(headOf(harness, harness.dir))
  })

  it("builds origin fresh, so a pushurl an adopted clone carried cannot redirect the push", async () => {
    const harness = await trackedHarness()
    const target = makeBareRemote(harness.sandbox, "target.git")
    const stale = makeBareRemote(harness.sandbox, "stale.git")
    rawGit(harness.dir, harness.sandbox.env, "remote", "add", "origin", "file:///stale/elsewhere.git")
    rawGit(harness.dir, harness.sandbox.env, "config", "remote.origin.pushurl", stale.url)

    await harness.sync.connectRemote(harness.workspaceId, target.url)

    expect(headOf(harness, target.dir, "main")).toBe(headOf(harness, harness.dir))
    expect(rawGit(stale.dir, harness.sandbox.env, "for-each-ref").trim()).toBe("")
    expect(rawGit(harness.dir, harness.sandbox.env, "config", "--get-regexp", "^remote\\.origin\\.")).not.toContain("pushurl")
  })

  it("leaves a commit failure the workspace already had as it was", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    harness.repositories.workspaceGit.setState(harness.workspaceId, "error", { code: "command_failed", message: "disk full" })

    const connected = await harness.sync.connectRemote(harness.workspaceId, remote.url)
    expect(connected).toMatchObject({ remoteUrl: remote.url, state: "error", lastError: { message: "disk full" } })

    const disconnected = await harness.sync.disconnectRemote(harness.workspaceId)
    expect(disconnected).toMatchObject({ remoteUrl: null, state: "error", lastError: { message: "disk full" } })
  })

  it("leaves an adopted clone with no origin, and the binding as it was, when that connect fails", async () => {
    const harness = await trackedHarness()
    const before = binding(harness)
    rawGit(harness.dir, harness.sandbox.env, "remote", "add", "origin", "file:///stale/elsewhere.git")
    const missing = pathToFileURL(path.join(harness.sandbox.root, "missing.git")).href

    await expect(harness.sync.connectRemote(harness.workspaceId, missing)).rejects.toThrow(/git fetch failed/)

    expect(binding(harness)).toEqual(before)
    expect(remotesOf(harness)).toEqual([])
  })

  it("asks for a first commit when the workspace has none, and adds no remote", async () => {
    const harness = openHarness({ anonymous: true })
    await harness.sync.track(harness.workspaceId).catch(() => undefined)
    const remote = makeBareRemote(harness.sandbox)
    const before = binding(harness)

    await expect(harness.sync.connectRemote(harness.workspaceId, remote.url)).rejects.toThrow(
      "Commit the workspace once before connecting a remote.",
    )

    expect(binding(harness)).toEqual(before)
    expect(remotesOf(harness)).toEqual([])
    expect(rawGit(remote.dir, harness.sandbox.env, "for-each-ref").trim()).toBe("")
  })

  it("needs a tracked workspace", async () => {
    const harness = openHarness()
    const remote = makeBareRemote(harness.sandbox)

    await expect(harness.sync.connectRemote(harness.workspaceId, remote.url)).rejects.toThrow(TRACK_FIRST)

    expect(harness.repositories.workspaceGit.get(harness.workspaceId)).toBeUndefined()
  })

  it("refuses a URL git would read as an option or a command, or that is not an accepted form, before touching the clone", async () => {
    const harness = await trackedHarness()
    const before = binding(harness)
    const refused = [
      "-oProxyCommand=touch pwned",
      "--upload-pack=touch pwned",
      "ext::sh -c id",
      "http://example.com/r.git",
      "https://octocat:ghp_hunter2@example.com/r.git",
      "C:\\repo",
      "",
    ]

    for (const url of refused) {
      await expect(harness.sync.connectRemote(harness.workspaceId, url), url).rejects.toBeInstanceOf(GitInvalidArgumentError)
    }

    expect(binding(harness)).toEqual(before)
    expect(remotesOf(harness)).toEqual([])
  })

  it("rethrows the error that failed the connect when the rollback fails too", async () => {
    let removals = 0
    const harness = await trackedHarness({
      wrap: (git) => ({
        ...passthrough(git),
        fetch: () => Promise.reject(new Error("network down")),
        // The first removal clears whatever origin the clone had; the second is the rollback.
        remoteRemove: (dir, name) =>
          ++removals === 1 ? git.remoteRemove(dir, name).catch(() => undefined) : Promise.reject(new Error("could not write .git/config")),
      }),
    })
    const remote = makeBareRemote(harness.sandbox)

    await expect(harness.sync.connectRemote(harness.workspaceId, remote.url)).rejects.toThrow("network down")

    expect(removals).toBe(2)
    expect(binding(harness).remoteUrl).toBeNull()
  })

  it("runs behind the workspace's lock: a commit queued meanwhile waits for the connect", async () => {
    const events: string[] = []
    const harness = await trackedHarness({
      wrap: (git) => ({
        ...passthrough(git),
        fetch: async (dir, remote) => {
          events.push("fetch:start")
          await new Promise((resolve) => setTimeout(resolve, 50))
          await git.fetch(dir, remote)
          events.push("fetch:end")
        },
        commit: async (dir, message) => {
          events.push("commit:start")
          return git.commit(dir, message)
        },
      }),
    })
    await harness.sync.setMode(harness.workspaceId, "manual")
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    const remote = makeBareRemote(harness.sandbox)
    events.length = 0

    await Promise.all([
      harness.sync.connectRemote(harness.workspaceId, remote.url),
      harness.sync.commitLocal(harness.workspaceId, { message: "Add login" }),
    ])

    expect(events).toEqual(["fetch:start", "fetch:end", "commit:start"])
  })
})

describe("GitSyncService.disconnectRemote", () => {
  it("removes the remote and the binding, and keeps the clone and every commit", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    const head = headOf(harness, harness.dir)
    harness.db.kvStore.set(
      "UPDATE workspace_git SET last_synced_commit = ?, last_synced_at = ? WHERE workspace_id = ?",
      [head, "2026-10-19T10:00:00.000Z", harness.workspaceId],
    )

    const status = await harness.sync.disconnectRemote(harness.workspaceId)

    expect(status).toMatchObject({ tracked: true, remoteUrl: null, state: "idle", lastError: null })
    expect(binding(harness)).toMatchObject({ remoteUrl: null, lastSyncedCommit: null, lastSyncedAt: null })
    expect(remotesOf(harness)).toEqual([])
    expect(headOf(harness, harness.dir)).toBe(head)
    expect(await subjects(harness)).toEqual(["Start tracking this workspace in APIWeave"])
    expect(headOf(harness, remote.dir, "main")).toBe(head)

    expect(await harness.sync.disconnectRemote(harness.workspaceId)).toEqual(status)
  })

  it("lets the same remote be connected again afterwards", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    await harness.sync.disconnectRemote(harness.workspaceId)

    const status = await harness.sync.connectRemote(harness.workspaceId, remote.url)

    expect(status.remoteUrl).toBe(remote.url)
  })

  it("still clears the binding when the clone is gone", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    fs.rmSync(harness.dir, { recursive: true, force: true })

    const status = await harness.sync.disconnectRemote(harness.workspaceId)

    expect(status).toMatchObject({ tracked: true, remoteUrl: null })
    expect(binding(harness).remoteUrl).toBeNull()
  })

  it("still clears the binding when the clone has no origin", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    rawGit(harness.dir, harness.sandbox.env, "remote", "remove", "origin")
    expect(remotesOf(harness)).toEqual([])

    const status = await harness.sync.disconnectRemote(harness.workspaceId)

    expect(status).toMatchObject({ tracked: true, remoteUrl: null, state: "idle", lastError: null })
    expect(binding(harness).remoteUrl).toBeNull()
    expect(await subjects(harness)).toEqual(["Start tracking this workspace in APIWeave"])
  })

  it("keeps the binding when git fails for any other reason", async () => {
    let failing = false
    const harness = await trackedHarness({
      wrap: (git) => ({
        ...passthrough(git),
        remoteRemove: (dir, name) => (failing ? Promise.reject(new Error("disk full")) : git.remoteRemove(dir, name)),
      }),
    })
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    failing = true

    await expect(harness.sync.disconnectRemote(harness.workspaceId)).rejects.toThrow("disk full")

    expect(binding(harness).remoteUrl).toBe(remote.url)
  })

  it("forgets what the old remote said about the workspace: a read-only flag and a sync position", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    harness.db.kvStore.set("UPDATE workspace_git SET read_only = 1 WHERE workspace_id = ?", [harness.workspaceId])
    expect(binding(harness).readOnly).toBe(true)

    await harness.sync.disconnectRemote(harness.workspaceId)

    expect(binding(harness).readOnly).toBe(false)
  })

  it("leaves a diverged workspace idle: diverging is about the remote it no longer has", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    harness.repositories.workspaceGit.setState(harness.workspaceId, "diverged", { code: null, message: "the remote's history was rewritten" })

    const status = await harness.sync.disconnectRemote(harness.workspaceId)

    expect(status).toMatchObject({ remoteUrl: null, state: "idle", lastError: null })
    expect(binding(harness)).toMatchObject({ remoteUrl: null, state: "idle", lastError: null })
  })

  it("needs a tracked workspace, and says it has nothing to disconnect rather than asking to connect", async () => {
    const harness = openHarness()

    await expect(harness.sync.disconnectRemote(harness.workspaceId)).rejects.toThrow(
      "This workspace has no version history, so it has no remote to disconnect.",
    )
  })
})

describe("GitSyncService.reconcile with a remote", () => {
  it("puts origin back in a clone that was recreated, without a network call", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    fs.rmSync(harness.dir, { recursive: true, force: true })
    // A remote that cannot be reached: reconcile must not try.
    fs.rmSync(remote.dir, { recursive: true, force: true })

    await harness.sync.reconcile()

    expect(rawGit(harness.dir, harness.sandbox.env, "remote", "get-url", "origin").trim()).toBe(remote.url)
    expect(binding(harness)).toMatchObject({ remoteUrl: remote.url, state: "idle", lastError: null })
  })

  it("makes the row's URL the clone's, over one a clone adopted from a backup carries", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    rawGit(harness.dir, harness.sandbox.env, "remote", "set-url", "origin", "file:///stale/elsewhere.git")

    await harness.sync.reconcile()

    expect(rawGit(harness.dir, harness.sandbox.env, "remote", "get-url", "origin").trim()).toBe(remote.url)
  })

  it("adds no remote to a workspace that has none", async () => {
    const harness = await trackedHarness()

    await harness.sync.reconcile()

    expect(remotesOf(harness)).toEqual([])
  })
})

describe("GitSyncService.discardLocalChanges", () => {
  it("keeps the read-only flag and the refusal's message: discarding says nothing about accepting a push", async () => {
    const harness = await trackedHarness()
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Unpushed" })
    await harness.sync.commitLocal(harness.workspaceId, { message: "Local work" })
    // What a refused push leaves behind.
    harness.repositories.workspaceGit.setReadOnly(harness.workspaceId, true)
    harness.repositories.workspaceGit.setState(harness.workspaceId, "idle", { code: "permission_denied", message: "the host refused the push" })

    const status = await harness.sync.discardLocalChanges(harness.workspaceId)

    expect(status).toMatchObject({
      state: "idle",
      readOnly: true,
      lastError: { code: "permission_denied", message: "the host refused the push" },
      incoming: 0,
      outgoing: 0,
    })
    expect(await subjects(harness)).toEqual(["Start tracking this workspace in APIWeave"])
    expect(headOf(harness, harness.dir)).toBe(headOf(harness, remote.dir, "main"))
  })
})
