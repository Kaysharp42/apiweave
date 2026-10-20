import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowRepository,
  WorkspaceGitRepository,
  WorkspaceRepository,
} from "../../repositories"
import { serializeWorkspace, workspaceSnapshot, type WorkspaceSnapshot } from "../../services/workspace_repo_format"
import {
  GitCommandError,
  GitNetworkError,
  GitNonFastForwardError,
  type GitFailureDetails,
} from "../git_errors"
import { GitService } from "../git_service"
import { GitSyncService, SYNC_INTERVAL_MS, type GitSyncGit, type GitSyncRepositories } from "../git_sync_service"
import { passthrough } from "./git_sync_harness"
import { closedPortUrl, listen, makeBareRemote, makeSandbox, rawGit, type GitSandbox } from "./git_test_utils"

/**
 * One device: its own database and clone root, against a sandbox shared by
 * both. A device is created before it has a workspace — A makes one, B opens
 * the one A pushed, which is what two computers do.
 */
interface Device {
  readonly db: InitializedDatabase
  readonly repositories: GitSyncRepositories
  readonly sync: GitSyncService
  readonly git: GitService
  readonly cloneRoot: string
  readonly env: NodeJS.ProcessEnv
  /** Every workspace the service said it imported into, in order. */
  readonly imports: string[]
}

const devices: Device[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const device of devices.splice(0)) {
    await device.sync.dispose()
    device.db.close()
  }
})

function openDevice(sandbox: GitSandbox, name: string, wrap?: (git: GitService) => GitSyncGit): Device {
  const db = initDatabase({ databasePath: ":memory:" })
  let sync: GitSyncService | undefined
  const note = (workspaceId: string): void => sync?.workspaceChanged(workspaceId)
  const repositories: GitSyncRepositories = {
    workspaces: new WorkspaceRepository(db.kvStore, note),
    collections: new CollectionRepository(db.kvStore, note),
    workflows: new WorkflowRepository(db.kvStore, (event) => sync?.workflowChanged(event)),
    environments: new EnvironmentRepository(db.kvStore, note),
    workspaceGit: new WorkspaceGitRepository(db.kvStore),
  }
  // Devices are different computers: each one commits under its own identity, so a clone's history says which machine wrote what.
  const git = new GitService({
    hooksDir: sandbox.hooksDir,
    identity: { name: `Device ${name.toUpperCase()}`, email: `${name}@example.invalid` },
    env: sandbox.env,
  })
  const cloneRoot = path.join(sandbox.root, `${name}-clones`)
  const imports: string[] = []
  sync = new GitSyncService({ cloneRoot, git: wrap?.(git) ?? git, repositories, onImported: (workspaceId) => imports.push(workspaceId) })
  const device: Device = { db, repositories, sync, git, cloneRoot, env: sandbox.env, imports }
  devices.push(device)
  return device
}

function dirOf(device: Device, workspaceId: string): string {
  return path.join(device.cloneRoot, workspaceId)
}

async function subjectsOf(device: Device, workspaceId: string): Promise<string[]> {
  return (await device.git.log(dirOf(device, workspaceId))).map((entry) => entry.subject)
}

function headOf(device: Device, workspaceId: string): string {
  return rawGit(dirOf(device, workspaceId), device.env, "rev-parse", "HEAD").trim()
}

function remoteHead(sandbox: GitSandbox, remoteDir: string): string {
  return rawGit(remoteDir, sandbox.env, "rev-parse", "main").trim()
}

function binding(device: Device, workspaceId: string) {
  const row = device.repositories.workspaceGit.get(workspaceId)
  if (row === undefined) throw new Error("the workspace is not tracked")
  return row
}

function snapshotOf(device: Device, workspaceId: string): WorkspaceSnapshot {
  const { workspaces, collections, workflows, environments } = device.repositories
  return workspaceSnapshot({
    workspace: workspaces.getById(workspaceId)!,
    projects: collections.listByWorkspace(workspaceId).items,
    workflows: workflows.listByWorkspace(workspaceId, true).items,
    environments: environments.listByWorkspace(workspaceId).items,
  })
}

/** The device's clone as a path-to-text map, the way the format writes it. */
function treeOf(device: Device, workspaceId: string): Map<string, string> {
  return serializeWorkspace(workspaceSnapshot({
    workspace: device.repositories.workspaces.getById(workspaceId)!,
    projects: device.repositories.collections.listByWorkspace(workspaceId).items,
    workflows: device.repositories.workflows.listByWorkspace(workspaceId, true).items,
    environments: device.repositories.environments.listByWorkspace(workspaceId).items,
  }))
}

function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
}

async function elapse(device: Device, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  await device.sync.settled()
}

interface FetchGate {
  readonly wrap: (git: GitService) => GitSyncGit
  /** Make the next fetch wait until {@link release}. */
  hold(): void
  /** Resolves once the held fetch has started. */
  readonly fetching: Promise<void>
  release(): void
}

/**
 * A git whose next fetch waits for the test: the window in which an edit can
 * land in the database after a cycle read it and before the cycle reads the
 * remote. Deterministic, where a real network would be a race.
 */
function deferredFetch(): FetchGate {
  let hold = false
  let release: (() => void) | undefined
  let started: (() => void) | undefined
  const fetching = new Promise<void>((resolve) => {
    started = resolve
  })
  return {
    wrap: (git) => ({
      ...passthrough(git),
      fetch: async (dir, remote) => {
        if (hold) {
          hold = false
          await new Promise<void>((resolve) => {
            release = resolve
            started?.()
          })
        }
        return git.fetch(dir, remote)
      },
    }),
    hold: () => {
      hold = true
    },
    fetching,
    release: () => release?.(),
  }
}

/** A device A with a tracked workspace, connected to `remote` (which receives its first commit). */
async function publish(device: Device, sandbox: GitSandbox, remote?: { dir: string; url: string }): Promise<string> {
  const workspaceId = device.repositories.workspaces.create({ name: "Acme QA", slug: "acme-qa" }).workspaceId
  await device.sync.track(workspaceId)
  await device.sync.connectRemote(workspaceId, (remote ?? makeBareRemote(sandbox)).url)
  return workspaceId
}

/** A second device, which opens the workspace the first pushed. */
async function openFromRemote(device: Device, url: string): Promise<string> {
  const result = await device.sync.openFromGit(url)
  if (result.kind !== "opened") throw new Error(`expected opened, got ${result.kind}`)
  return result.workspaceId
}

/**
 * A commit pushed straight to the remote by "another device": a fresh clone
 * with the files the caller names, over whatever the remote holds. The returned
 * sha is the remote's new tip.
 */
let elsewhereCount = 0

function pushFromElsewhere(
  sandbox: GitSandbox,
  remote: { dir: string; url: string },
  files: Record<string, string>,
  message: string,
): string {
  const scratch = path.join(sandbox.root, `elsewhere-${++elsewhereCount}`)
  rawGit(sandbox.root, sandbox.env, "clone", remote.url, scratch)
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(scratch, name)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  rawGit(scratch, sandbox.env, "add", "-A")
  rawGit(scratch, sandbox.env, "-c", "user.name=Someone Else", "-c", "user.email=someone@example.invalid", "commit", "-m", message)
  rawGit(scratch, sandbox.env, "push", "origin", "main")
  return rawGit(scratch, sandbox.env, "rev-parse", "HEAD").trim()
}

/** A `workspace.json` no build can parse: what a hand-edited or conflicted file pushed from elsewhere looks like. */
const NOT_A_WORKSPACE = "{ this is not a workspace\n"

/** A workflow file the format accepts, under an id no test has yet: proof that an import happened. */
const REMOTE_WORKFLOW_ID = "wf-fixed-on-remote"
const REMOTE_WORKFLOW_FILE = `workflows/fixed--${REMOTE_WORKFLOW_ID}.json`
function remoteWorkflowFile(): string {
  return `${JSON.stringify(
    {
      workflowId: REMOTE_WORKFLOW_ID,
      projectId: null,
      name: "Fixed on the remote",
      description: "",
      selectedEnvironmentId: null,
      tags: [],
      variables: {},
      nodes: [],
      edges: [],
      nodeTemplates: [],
    },
    null,
    2,
  )}\n`
}

/** A rejection git itself would classify as a non-fast-forward; the details are only read by logging. */
function nonFastForward(): GitNonFastForwardError {
  const details: GitFailureDetails = { args: ["push"], exitCode: 1, stdout: "", stderr: "! [rejected] main -> main (non-fast-forward)" }
  return new GitNonFastForwardError("git push failed: (non-fast-forward)", details)
}

const NETWORK_DOWN = "git fetch failed: fatal: unable to access the remote: Could not resolve host"

/** A fetch that cannot reach the remote, as git classifies it. */
function networkDown(): GitNetworkError {
  return new GitNetworkError(NETWORK_DOWN, { args: ["fetch"], exitCode: 128, stdout: "", stderr: NETWORK_DOWN })
}

/** A reset that fails, as one would on a clone a crashed git left locked. */
function resetRefused(): GitCommandError {
  const stderr = "fatal: Unable to create '.git/index.lock': File exists."
  return new GitCommandError(`git reset failed: ${stderr}`, { args: ["reset"], exitCode: 128, stdout: "", stderr })
}

describe("the sync cycle", () => {
  it("pushes A's edit, and B pulling it gets the same records with nothing to commit", async () => {
    fakeTimers()
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)

    // B opens the workspace as it stands, before A's edit: what B ends up with must come from a pull.
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    expect(opened).toBe(workspaceId)
    const openedAt = headOf(b, opened)
    expect(openedAt).toBe(remoteHead(sandbox, remote.dir))
    expect(await subjectsOf(b, opened)).toEqual(["Start tracking this workspace in APIWeave"])

    const login = a.repositories.workflows.create({ workspaceId, name: "Login" })
    await a.sync.syncNow(workspaceId, { message: "Add login" })
    const pushed = remoteHead(sandbox, remote.dir)
    expect(pushed).not.toBe(openedAt)

    await b.sync.start()

    expect(snapshotOf(b, opened)).toEqual(snapshotOf(a, workspaceId))
    expect(b.repositories.workflows.getById(login.workflowId)?.name).toBe("Login")
    expect(headOf(b, opened)).toBe(pushed)
    expect(await subjectsOf(b, opened)).toEqual(await subjectsOf(a, workspaceId))
    // The commit B pulled is A's, and B made none of its own: nothing schedules a commit behind the import.
    expect((await b.git.log(dirOf(b, opened)))[0]).toMatchObject({ authorName: "Device A", authorEmail: "a@example.invalid", subject: "Add login" })
    expect(await b.git.status(dirOf(b, opened))).toMatchObject({ clean: true })
    expect(binding(b, opened)).toMatchObject({ state: "idle", lastError: null, lastSyncedCommit: pushed, integratingFrom: null })
    expect(binding(b, opened).lastSyncedAt).not.toBeNull()
    // The one import is announced, for the renderer to refetch what it rewrote.
    expect(b.imports).toEqual([opened])
    const status = await b.sync.status(opened)
    expect(status).toMatchObject({ incoming: 0, outgoing: 0, readOnly: false })

    await elapse(b, 30_000)
    expect(await subjectsOf(b, opened)).toEqual(await subjectsOf(a, workspaceId))
  })

  it("fetches but integrates nothing in manual mode, and reports the incoming count", async () => {
    fakeTimers()
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    await b.sync.setMode(opened, "manual")
    const localEdit = b.repositories.workflows.create({ workspaceId: opened, name: "Local only" })
    const before = await subjectsOf(b, opened)
    const headBefore = headOf(b, opened)

    a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })

    await b.sync.start()

    expect(await b.sync.status(opened)).toMatchObject({ incoming: 1, outgoing: 0, state: "idle" })
    expect(b.repositories.workflows.getById(localEdit.workflowId)?.name).toBe("Local only")
    // Nothing was integrated and nothing committed: the manual cycle waits for Sync now.
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .toEqual(["Local only"])
    expect(headOf(b, opened)).toBe(headBefore)
    expect(await subjectsOf(b, opened)).toEqual(before)
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(a, workspaceId))

    // The interval fetches again, and still integrates nothing.
    a.repositories.workflows.create({ workspaceId, name: "Second on A" })
    await a.sync.syncNow(workspaceId, { message: "Add a second on A" })
    await elapse(b, SYNC_INTERVAL_MS)
    expect(await b.sync.status(opened)).toMatchObject({ incoming: 2, outgoing: 0 })
    expect(headOf(b, opened)).toBe(headBefore)

    // The local edit was never committed; drop it, and Sync now is what brings A's commits in.
    b.repositories.workflows.delete(localEdit.workflowId)
    const synced = await b.sync.syncNow(opened)
    expect(synced).toMatchObject({ incoming: 0, outgoing: 0, state: "idle" })
    expect(headOf(b, opened)).toBe(headOf(a, workspaceId))
    expect(snapshotOf(b, opened)).toEqual(snapshotOf(a, workspaceId))
  })

  it("stops on divergence without pushing, and discard brings the clone and the records back to the remote", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
    await a.sync.syncNow(workspaceId, { message: "Add shared" })
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)

    a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    const aHead = headOf(a, workspaceId)
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)

    b.repositories.workflows.create({ workspaceId: opened, name: "On B" })
    const diverged = await b.sync.syncNow(opened, { message: "Add on B" })

    expect(diverged).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })
    expect(diverged.lastError?.message).toMatch(/each changed since they last agreed/)
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
    const bHead = headOf(b, opened)
    expect(bHead).not.toBe(aHead)

    // A diverged workspace stays stopped: another cycle neither pushes nor pulls.
    const again = await b.sync.syncNow(opened)
    expect(again.state).toBe("diverged")
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
    expect(headOf(b, opened)).toBe(bHead)

    const discarded = await b.sync.discardLocalChanges(opened)

    expect(discarded).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    expect(b.imports).toEqual([opened])
    expect(binding(b, opened).integratingFrom).toBeNull()
    expect(headOf(b, opened)).toBe(aHead)
    expect(await b.git.status(dirOf(b, opened))).toMatchObject({ clean: true })
    expect(binding(b, opened)).toMatchObject({ lastSyncedCommit: aHead })
    expect(snapshotOf(b, opened)).toEqual(snapshotOf(a, workspaceId))
    expect(b.repositories.workflows.getById(shared.workflowId)).toBeDefined()
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .not.toContain("On B")
  })

  it("discard removes a deletion and an addition from this device, restoring the remote's tree", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const kept = a.repositories.workflows.create({ workspaceId, name: "Kept" })
    const removed = a.repositories.workflows.create({ workspaceId, name: "Removed" })
    await a.sync.syncNow(workspaceId, { message: "Add two" })
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    const remoteSha = remoteHead(sandbox, remote.dir)

    b.repositories.workflows.delete(removed.workflowId)
    b.repositories.workflows.create({ workspaceId: opened, name: "B only" })
    expect(await b.sync.commitLocal(opened, { message: "Edit on B" })).toBeDefined()
    expect(headOf(b, opened)).not.toBe(remoteSha)

    const discarded = await b.sync.discardLocalChanges(opened)

    expect(discarded.state).toBe("idle")
    expect(headOf(b, opened)).toBe(remoteSha)
    expect(b.repositories.workflows.getById(removed.workflowId)?.name).toBe("Removed")
    expect(b.repositories.workflows.getById(kept.workflowId)?.name).toBe("Kept")
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .not.toContain("B only")
    expect(treeOf(b, opened)).toEqual(treeOf(a, workspaceId))
  })

  it("refuses to discard without a remote, or when the remote has no branch for the workspace yet", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const workspaceId = a.repositories.workspaces.create({ name: "Local only", slug: "local-only" }).workspaceId
    await a.sync.track(workspaceId)
    await expect(a.sync.discardLocalChanges(workspaceId)).rejects.toThrow("not connected to a remote")

    const b = openDevice(sandbox, "b")
    const remote = makeBareRemote(sandbox, "shared.git")
    const published = await publish(b, sandbox, remote)
    rawGit(remote.dir, sandbox.env, "update-ref", "-d", "refs/heads/main")

    await expect(b.sync.discardLocalChanges(published)).rejects.toThrow("does not have this workspace's branch yet")
    expect(binding(b, published).remoteUrl).toBe(remote.url)
  })

  it("marks the workspace read-only when the host refuses a push, keeps committing locally, and pushes nothing by itself", async () => {
    const sandbox = makeSandbox()
    const refusing = await listen((_request, response) => {
      response.writeHead(403, { "Content-Type": "text/plain" })
      response.end("Forbidden\n")
    })
    let refusePush = false
    let pushes = 0
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      push: async (dir, remote, branch, options) => {
        pushes += 1
        if (!refusePush) return git.push(dir, remote, branch, options)
        // The clone keeps its real remote: one push is answered by a host that refuses this user, as GitHub does with a 403.
        const original = rawGit(dir, sandbox.env, "remote", "get-url", "origin").trim()
        try {
          await git.remoteSetUrl(dir, "origin", refusing.url)
          return await git.push(dir, remote, branch, options)
        } finally {
          await git.remoteSetUrl(dir, "origin", original)
        }
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(b, sandbox, remote)
    const remoteSha = remoteHead(sandbox, remote.dir)
    b.repositories.workflows.create({ workspaceId, name: "B's work" })
    pushes = 0
    refusePush = true

    const refused = await b.sync.syncNow(workspaceId)

    expect(refused).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" } })
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)
    const localHead = headOf(b, workspaceId)
    expect(localHead).not.toBe(remoteSha)

    // Local commits continue, and the refusal's message survives them: only a successful push clears it.
    b.repositories.workflows.create({ workspaceId, name: "More of B's work" })
    expect(await b.sync.commitLocal(workspaceId, { message: "Keep working" })).toBeDefined()
    expect(headOf(b, workspaceId)).not.toBe(localHead)
    expect(await b.sync.status(workspaceId)).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" } })

    // An automatic pass fetches and integrates, but does not push — and still does not clear the message.
    await b.sync.start()
    expect(await b.sync.status(workspaceId)).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" } })
    expect(pushes).toBe(1)
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)

    // Sync now still tries, and success is what proves the host accepts this user again.
    refusePush = false
    const accepted = await b.sync.syncNow(workspaceId)
    expect(accepted).toMatchObject({ state: "idle", readOnly: false, lastError: null, incoming: 0, outgoing: 0 })
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, workspaceId))
    expect(binding(b, workspaceId).lastSyncedCommit).toBe(headOf(b, workspaceId))

    // And A, which pushed the workspace, pulls all of it.
    const a = openDevice(sandbox, "a")
    const openedOnA = await openFromRemote(a, remote.url)
    expect(openedOnA).toBe(workspaceId)
    expect(snapshotOf(a, openedOnA)).toEqual(snapshotOf(b, workspaceId))
  })

  it("makes B read-only when the remote's pre-receive hook declines B's commits, while A keeps pushing", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    // A real server-side refusal by author, as a host's push rules make one. Git for Windows
    // runs the hook through its bundled sh; elsewhere the file must be executable.
    const hook = path.join(remote.dir, "hooks", "pre-receive")
    fs.writeFileSync(
      hook,
      [
        "#!/bin/sh",
        "while read old new ref; do",
        "  if [ -n \"$(git log --author='<b@example.invalid>' --format=%H \"$old..$new\")\" ]; then",
        "    echo 'b@example.invalid may not push to this repository' >&2",
        "    exit 1",
        "  fi",
        "done",
        "exit 0",
        "",
      ].join("\n"),
    )
    if (process.platform !== "win32") fs.chmodSync(hook, 0o755)
    const remoteSha = remoteHead(sandbox, remote.dir)

    b.repositories.workflows.create({ workspaceId: opened, name: "On B" })
    const refused = await b.sync.syncNow(opened, { message: "Add on B" })

    expect(refused).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" }, outgoing: 1 })
    expect(refused.lastError?.message).toMatch(/pre-receive hook declined/)
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)

    // The hook refuses B, not the branch: A's push goes through.
    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    expect(await a.sync.syncNow(workspaceId, { message: "Add on A" })).toMatchObject({ state: "idle", readOnly: false, lastError: null })
    const aHead = remoteHead(sandbox, remote.dir)
    expect(aHead).toBe(headOf(a, workspaceId))

    // The read-only offer: B drops its commit and takes A's, and stays read-only.
    const discarded = await b.sync.discardLocalChanges(opened)
    expect(discarded).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" }, incoming: 0, outgoing: 0 })
    expect(headOf(b, opened)).toBe(aHead)
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name)).toEqual(["On A"])
    expect(b.repositories.workflows.getById(onA.workflowId)).toBeDefined()

    // Retry with nothing to send: git would answer "Everything up-to-date" without asking the
    // hook, which proves nothing about the host. Nothing is pushed, and B stays read-only.
    const retried = await b.sync.syncNow(opened)
    expect(retried).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" }, incoming: 0, outgoing: 0 })
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
  })

  it("surfaces a network loss mid-push as an error, keeps the commit, and retries on the next cycle", async () => {
    const sandbox = makeSandbox()
    const deadUrl = await closedPortUrl()
    let failNextPush = false
    const a = openDevice(sandbox, "a", (git) => ({
      ...passthrough(git),
      push: async (dir, remote, branch, options) => {
        if (!failNextPush) return git.push(dir, remote, branch, options)
        failNextPush = false
        const original = rawGit(dir, sandbox.env, "remote", "get-url", "origin").trim()
        try {
          await git.remoteSetUrl(dir, "origin", deadUrl)
          return await git.push(dir, remote, branch, options)
        } finally {
          await git.remoteSetUrl(dir, "origin", original)
        }
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const remoteSha = remoteHead(sandbox, remote.dir)
    a.repositories.workflows.create({ workspaceId, name: "While offline" })
    failNextPush = true

    const failed = await a.sync.syncNow(workspaceId, { message: "Add while offline" })

    expect(failed).toMatchObject({ state: "error", lastError: { code: "network_error" } })
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)
    expect(remoteHead(sandbox, remote.dir)).not.toBe(headOf(a, workspaceId))
    expect(await subjectsOf(a, workspaceId)).toContain("Add while offline")

    const retried = await a.sync.syncNow(workspaceId)
    expect(retried).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(a, workspaceId))
    expect(binding(a, workspaceId).lastSyncedCommit).toBe(headOf(a, workspaceId))
  })

  it("retries a non-fast-forward once from a fresh fetch, and succeeds when the remote had not really moved", async () => {
    const sandbox = makeSandbox()
    let armed = false
    let pushes = 0
    let fetches = 0
    const a = openDevice(sandbox, "a", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remote) => {
        fetches += 1
        return git.fetch(dir, remote)
      },
      push: async (dir, remote, branch, options) => {
        pushes += 1
        return armed && pushes === 1 ? Promise.reject(nonFastForward()) : git.push(dir, remote, branch, options)
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    // The connection's own push and fetch are the baseline.
    pushes = 0
    fetches = 0
    armed = true
    a.repositories.workflows.create({ workspaceId, name: "Retried" })

    const status = await a.sync.syncNow(workspaceId, { message: "Add retried" })

    expect(status).toMatchObject({ state: "idle", lastError: null })
    expect(pushes).toBe(2)
    // The retry fetches again before pushing: the one from the first cycle, the one from the retry.
    expect(fetches).toBe(2)
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(a, workspaceId))
  })

  it("ends the second non-fast-forward honestly: error, with the classified failure and the local commits", async () => {
    const sandbox = makeSandbox()
    let armed = false
    let pushes = 0
    const a = openDevice(sandbox, "a", (git) => ({
      ...passthrough(git),
      push: async (dir, remote, branch, options) => {
        pushes += 1
        return armed && pushes <= 2 ? Promise.reject(nonFastForward()) : git.push(dir, remote, branch, options)
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    pushes = 0
    armed = true
    const remoteSha = remoteHead(sandbox, remote.dir)
    a.repositories.workflows.create({ workspaceId, name: "Never lands" })

    const status = await a.sync.syncNow(workspaceId, { message: "Add never lands" })

    // Only this workspace's side holds a new commit: a race, not the diverged state.
    expect(status).toMatchObject({ state: "error", lastError: { code: "non_fast_forward" }, incoming: 0, outgoing: 1 })
    expect(pushes).toBe(2)
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)
    expect(await subjectsOf(a, workspaceId)).toContain("Add never lands")
  })

  it("recovers from a restart that left a cycle mid-flight", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const remoteSha = remoteHead(sandbox, remote.dir)
    a.repositories.workflows.create({ workspaceId, name: "Pending at quit" })
    // What a crash in the middle of a cycle leaves: the row says syncing, nothing has run.
    a.repositories.workspaceGit.setState(workspaceId, "syncing")
    expect(binding(a, workspaceId).state).toBe("syncing")

    await a.sync.reconcile()

    expect(binding(a, workspaceId)).toMatchObject({ state: "idle", lastError: null })
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)
    // The pending edit was committed by reconcile, and the next cycle pushes it.
    const [newest] = await subjectsOf(a, workspaceId)
    expect(newest).toMatch(/^Update workflows\/pending-at-quit-.*\.json$/)
    await a.sync.syncNow(workspaceId)
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(a, workspaceId))
  })

  it("skips a workspace whose cycle is already running when the interval reaches it", async () => {
    fakeTimers()
    const sandbox = makeSandbox()
    let fetches = 0
    let holdNextFetch = false
    let fetchStarted: (() => void) | undefined
    let releaseFetch: (() => void) | undefined
    const a = openDevice(sandbox, "a", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remote) => {
        fetches += 1
        if (holdNextFetch) {
          holdNextFetch = false
          await new Promise<void>((resolve) => {
            releaseFetch = resolve
            fetchStarted?.()
          })
        }
        return git.fetch(dir, remote)
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    await a.sync.start()
    fetches = 0

    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve
    })
    holdNextFetch = true
    const cycle = a.sync.syncNow(workspaceId)
    await started

    // The interval reaches the workspace while the cycle holds its lock, and leaves it alone.
    vi.advanceTimersByTime(SYNC_INTERVAL_MS)
    expect(fetches).toBe(1)

    releaseFetch?.()
    await cycle
    await a.sync.settled()
    expect(fetches).toBe(1)
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(a, workspaceId))
  })

  it("commits an edit that lands while an automatic cycle is fetching, and stops as diverged instead of importing over it", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const gate = deferredFetch()
    const b = openDevice(sandbox, "b", gate.wrap)
    const opened = await openFromRemote(b, remote.url)
    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    const aHead = remoteHead(sandbox, remote.dir)

    gate.hold()
    const starting = b.sync.start()
    await gate.fetching

    // The edit lands after the cycle read the database, while its fetch is in flight.
    b.repositories.workflows.create({ workspaceId: opened, name: "On B while fetching" })
    gate.release()
    await starting
    await b.sync.settled()

    const status = await b.sync.status(opened)
    expect(status).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })
    expect(status.lastError?.message).toMatch(/each changed since they last agreed/)
    // The edit was committed and survives; the remote's tree was not imported over it.
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .toContain("On B while fetching")
    expect(b.repositories.workflows.getById(onA.workflowId)).toBeUndefined()
    expect((await subjectsOf(b, opened))[0]).toMatch(/^Update workflows\/on-b-while-fetching--/)
    expect(headOf(b, opened)).not.toBe(aHead)
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
  })

  it("commits an edit that lands while a manual cycle is fetching, and stops as diverged instead of importing over it", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const gate = deferredFetch()
    const b = openDevice(sandbox, "b", gate.wrap)
    const opened = await openFromRemote(b, remote.url)
    await b.sync.setMode(opened, "manual")
    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    const aHead = remoteHead(sandbox, remote.dir)

    gate.hold()
    const cycle = b.sync.syncNow(opened)
    await gate.fetching

    // Manual mode schedules no commit of its own: only the cycle can keep this edit, before it reads the remote.
    b.repositories.workflows.create({ workspaceId: opened, name: "On B while fetching" })
    gate.release()
    const status = await cycle

    expect(status).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })
    expect(status.lastError?.message).toMatch(/each changed since they last agreed/)
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .toContain("On B while fetching")
    expect(b.repositories.workflows.getById(onA.workflowId)).toBeUndefined()
    expect((await subjectsOf(b, opened))[0]).toMatch(/^Update workflows\/on-b-while-fetching--/)
    expect(headOf(b, opened)).not.toBe(aHead)
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
  })

  it("catches an edit that lands while the clone is fast-forwarding: the clone goes back, and the cycle stops as diverged", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    let editDuringFastForward: (() => void) | undefined
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      mergeFastForward: async (dir, rev) => {
        // After the cycle's last look at the write count, before the import reads the tree.
        editDuringFastForward?.()
        editDuringFastForward = undefined
        return git.mergeFastForward(dir, rev)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    const tip = headOf(b, opened)
    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    const aHead = remoteHead(sandbox, remote.dir)
    editDuringFastForward = () => {
      b.repositories.workflows.create({ workspaceId: opened, name: "On B while moving" })
    }

    const status = await b.sync.syncNow(opened)

    expect(status).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .toEqual(["On B while moving"])
    expect(b.repositories.workflows.getById(onA.workflowId)).toBeUndefined()
    // The edit is committed on the commit the clone was on before it moved, not on the remote's.
    expect((await subjectsOf(b, opened))[0]).toMatch(/^Update workflows\/on-b-while-moving--/)
    expect(rawGit(dirOf(b, opened), sandbox.env, "rev-parse", "HEAD~1").trim()).toBe(tip)
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
  })

  it("keeps an edit that lands while the cycle is writing its own commit: that commit read the database before it", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    let editDuringAdd: (() => void) | undefined
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      add: async (dir, paths) => {
        // The tree is already serialized: this edit is not in the commit being made.
        editDuringAdd?.()
        editDuringAdd = undefined
        return git.add(dir, paths)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    await b.sync.setMode(opened, "manual")
    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    const aHead = remoteHead(sandbox, remote.dir)
    editDuringAdd = () => {
      b.repositories.workflows.create({ workspaceId: opened, name: "On B while committing" })
    }

    const status = await b.sync.syncNow(opened)

    expect(status).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .toEqual(["On B while committing"])
    expect(b.repositories.workflows.getById(onA.workflowId)).toBeUndefined()
    expect((await subjectsOf(b, opened))[0]).toMatch(/^Update workflows\/on-b-while-committing--/)
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
  })

  it("imports as usual when the write that lands while fast-forwarding changes nothing the tree holds", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
    await a.sync.syncNow(workspaceId, { message: "Add shared" })
    let fastForwards = 0
    let writeDuringFastForward: (() => void) | undefined
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      mergeFastForward: async (dir, rev) => {
        fastForwards += 1
        writeDuringFastForward?.()
        writeDuringFastForward = undefined
        return git.mergeFastForward(dir, rev)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    // A write the repositories announce, but one that leaves the serialized tree as it was.
    writeDuringFastForward = () => {
      b.repositories.workflows.update(shared.workflowId, {})
    }

    const status = await b.sync.syncNow(opened)

    expect(status).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    // Moved back, found nothing to commit, and fast-forwarded again.
    expect(fastForwards).toBe(2)
    expect(headOf(b, opened)).toBe(remoteHead(sandbox, remote.dir))
    expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
  })

  it("moves the clone back when a fast-forward's tree cannot be imported, so no later cycle pushes a revert", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    await publish(a, sandbox, remote)
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    const before = snapshotOf(b, opened)
    const tip = headOf(b, opened)

    // Another device pushes a file this build cannot read.
    const broken = pushFromElsewhere(sandbox, remote, { "workspace.json": NOT_A_WORKSPACE }, "Break the workspace file")

    const failed = await b.sync.syncNow(opened)

    expect(failed.state).toBe("error")
    expect(failed.lastError?.message).toMatch(/workspace\.json is not valid JSON/)
    expect(headOf(b, opened)).toBe(tip)
    expect(snapshotOf(b, opened)).toEqual(before)
    expect(remoteHead(sandbox, remote.dir)).toBe(broken)
    expect(await b.git.status(dirOf(b, opened))).toMatchObject({ clean: true })
    // Back where the database is, so nothing is left to recover; and nothing was imported to announce.
    expect(binding(b, opened).integratingFrom).toBeNull()
    expect(b.imports).toEqual([])

    // The next cycle fails the same way and pushes nothing: without the rollback it would push this tree back over the remote's.
    const again = await b.sync.syncNow(opened)
    expect(again.state).toBe("error")
    expect(headOf(b, opened)).toBe(tip)
    expect(remoteHead(sandbox, remote.dir)).toBe(broken)

    // With the remote's tree readable again, the same cycle brings it in.
    const fixed = pushFromElsewhere(
      sandbox,
      remote,
      {
        "workspace.json": fs.readFileSync(path.join(dirOf(b, opened), "workspace.json"), "utf8"),
        [REMOTE_WORKFLOW_FILE]: remoteWorkflowFile(),
      },
      "Fix the workspace file",
    )
    const imported = await b.sync.syncNow(opened)

    expect(imported).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    expect(headOf(b, opened)).toBe(fixed)
    expect(binding(b, opened)).toMatchObject({ lastSyncedCommit: fixed, integratingFrom: null })
    expect(b.repositories.workflows.getById(REMOTE_WORKFLOW_ID)?.name).toBe("Fixed on the remote")
    expect(b.imports).toEqual([opened])
  })

  it("moves the clone back when a discard cannot import the remote's tree, so the local tree is never pushed over it", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    await publish(a, sandbox, remote)
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    b.repositories.workflows.create({ workspaceId: opened, name: "B only" })
    await b.sync.commitLocal(opened, { message: "B's work" })
    const localTip = headOf(b, opened)

    const broken = pushFromElsewhere(sandbox, remote, { "workspace.json": NOT_A_WORKSPACE }, "Break the workspace file")

    await expect(b.sync.discardLocalChanges(opened)).rejects.toThrow(/workspace\.json is not valid JSON/)

    expect(b.imports).toEqual([])
    expect(binding(b, opened).integratingFrom).toBeNull()
    expect(headOf(b, opened)).toBe(localTip)
    expect(await b.git.status(dirOf(b, opened))).toMatchObject({ clean: true })
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name)).toEqual(["B only"])
    expect(remoteHead(sandbox, remote.dir)).toBe(broken)

    // The local commits are still here, so the cycle stops diverged instead of pushing this tree over the remote's.
    const later = await b.sync.syncNow(opened)
    expect(later.state).toBe("diverged")
    expect(headOf(b, opened)).toBe(localTip)
    expect(remoteHead(sandbox, remote.dir)).toBe(broken)
  })

  it("keeps pulling while read-only: the remote's commits still come in, and the refusal's message stays", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    let pushes = 0
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      push: async (dir, remoteName, branch, options) => {
        pushes += 1
        return git.push(dir, remoteName, branch, options)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    // What a refused push leaves behind.
    b.repositories.workspaceGit.setReadOnly(opened, true)
    b.repositories.workspaceGit.setState(opened, "idle", { code: "permission_denied", message: "the host refused the push" })

    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    const aHead = remoteHead(sandbox, remote.dir)

    await b.sync.start()

    expect(pushes).toBe(0)
    expect(await b.sync.status(opened)).toMatchObject({
      state: "idle",
      readOnly: true,
      incoming: 0,
      outgoing: 0,
      lastError: { code: "permission_denied", message: "the host refused the push" },
    })
    expect(headOf(b, opened)).toBe(aHead)
    expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
    expect(binding(b, opened).lastSyncedCommit).toBe(aHead)
  })

  it("keeps a read-only workspace's refusal through manual fetches, but not a failed fetch's message past the next good one", async () => {
    fakeTimers()
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    await publish(a, sandbox, remote)
    let failFetch = false
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remoteName) => {
        if (failFetch) throw networkDown()
        return git.fetch(dir, remoteName)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    await b.sync.setMode(opened, "manual")
    const refusal = { code: "permission_denied" as const, message: "the host refused the push" }
    b.repositories.workspaceGit.setReadOnly(opened, true)
    b.repositories.workspaceGit.setState(opened, "idle", refusal)

    await b.sync.start()
    expect(await b.sync.status(opened)).toMatchObject({ state: "idle", readOnly: true, lastError: refusal })

    failFetch = true
    await elapse(b, SYNC_INTERVAL_MS)
    expect(await b.sync.status(opened)).toMatchObject({ state: "error", readOnly: true, lastError: { code: "network_error", message: NETWORK_DOWN } })

    // The failure was about one fetch; the next good one clears it. The workspace is still read-only.
    failFetch = false
    await elapse(b, SYNC_INTERVAL_MS)
    expect(await b.sync.status(opened)).toMatchObject({ state: "idle", readOnly: true, lastError: null })
  })

  it("leaves a diverged workspace diverged when its periodic fetch fails, and the fetch's reason as the message", async () => {
    fakeTimers()
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    let failFetch = false
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remoteName) => {
        if (failFetch) throw new Error("network down")
        return git.fetch(dir, remoteName)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    await b.sync.setMode(opened, "manual")
    a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    b.repositories.workflows.create({ workspaceId: opened, name: "On B" })

    const diverged = await b.sync.syncNow(opened, { message: "Add on B" })
    expect(diverged).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })

    // The periodic pass in manual mode only fetches, and this one fails. Where the histories
    // stand has not changed, so the state stays diverged and the message is the fetch's.
    failFetch = true
    await b.sync.start()
    expect(await b.sync.status(opened)).toMatchObject({
      state: "diverged",
      incoming: 1,
      outgoing: 1,
      lastError: { code: null, message: "network down" },
    })

    // A fetch that succeeds does not settle it either: only integrating can, and a fetch is not that.
    failFetch = false
    await elapse(b, SYNC_INTERVAL_MS)
    expect(await b.sync.status(opened)).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })
  })

  it("ends a retried push that finds both sides moved as the late divergence, keeping the local commit", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    await publish(a, sandbox, remote)
    let fetches = 0
    let pushes = 0
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remoteName) => {
        fetches += 1
        // The third fetch follows the second refusal: the remote gained a sibling commit while this device was pushing.
        if (fetches === 3) pushFromElsewhere(sandbox, remote, { "note.txt": "someone else's work\n" }, "Someone else's commit")
        return git.fetch(dir, remoteName)
      },
      push: async (dir, remoteName, branch, options) => {
        pushes += 1
        return pushes <= 2 ? Promise.reject(nonFastForward()) : git.push(dir, remoteName, branch, options)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    b.repositories.workflows.create({ workspaceId: opened, name: "B's work" })

    const status = await b.sync.syncNow(opened, { message: "Add B's work" })

    expect(status).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })
    expect(status.lastError?.message).toMatch(/moved again while this workspace was pushing/)
    expect(pushes).toBe(2)
    expect(await subjectsOf(b, opened)).toContain("Add B's work")
    expect(await subjectsOf(b, opened)).not.toContain("Someone else's commit")
    expect(remoteHead(sandbox, remote.dir)).not.toBe(headOf(b, opened))
  })

  describe("a clone left ahead of its database", () => {
    /**
     * What a crash, a kill or a quit between a fast-forward and its import
     * leaves on a device: the row marked as the service marks it, the clone at
     * the remote's tip, and the database as it was.
     */
    function moveCloneWithoutImport(device: Device, workspaceId: string): void {
      const dir = dirOf(device, workspaceId)
      rawGit(dir, device.env, "fetch", "origin")
      device.repositories.workspaceGit.setIntegratingFrom(workspaceId, headOf(device, workspaceId))
      rawGit(dir, device.env, "merge", "--ff-only", "origin/main")
    }

    /** A device whose `git reset` fails while `refuse` says so. */
    function refusingResets(sandbox: GitSandbox, name: string): { device: Device; refuse: (on: boolean) => void } {
      let refusing = false
      const device = openDevice(sandbox, name, (git) => ({
        ...passthrough(git),
        resetHard: async (dir, rev) => {
          if (refusing) throw resetRefused()
          return git.resetHard(dir, rev)
        },
      }))
      return {
        device,
        refuse: (on) => {
          refusing = on
        },
      }
    }

    it("goes back to the database's commit on restart, so nothing reverts the remote's change, and then imports it", async () => {
      const sandbox = makeSandbox()
      const a = openDevice(sandbox, "a")
      const remote = makeBareRemote(sandbox, "shared.git")
      const workspaceId = await publish(a, sandbox, remote)
      const b = openDevice(sandbox, "b")
      const opened = await openFromRemote(b, remote.url)
      const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
      await a.sync.syncNow(workspaceId, { message: "Add on A" })
      const aHead = remoteHead(sandbox, remote.dir)

      moveCloneWithoutImport(b, opened)
      expect(headOf(b, opened)).toBe(aHead)
      expect(b.repositories.workflows.getById(onA.workflowId)).toBeUndefined()

      await b.sync.start()

      // Serializing the old database over the moved clone would have committed A's workflow away and pushed that.
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      expect(headOf(b, opened)).toBe(aHead)
      expect(await subjectsOf(b, opened)).toEqual(await subjectsOf(a, workspaceId))
      expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
      expect(binding(b, opened)).toMatchObject({ state: "idle", lastError: null, integratingFrom: null, lastSyncedCommit: aHead })
      expect(b.imports).toEqual([opened])

      await a.sync.syncNow(workspaceId)
      expect(a.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
    })

    it("stops with an error and pushes nothing while the clone cannot be moved back, and recovers once it can", async () => {
      const sandbox = makeSandbox()
      const a = openDevice(sandbox, "a")
      const remote = makeBareRemote(sandbox, "shared.git")
      const workspaceId = await publish(a, sandbox, remote)
      const { device: b, refuse } = refusingResets(sandbox, "b")
      const opened = await openFromRemote(b, remote.url)
      const openedAt = headOf(b, opened)
      const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
      await a.sync.syncNow(workspaceId, { message: "Add on A" })
      const aHead = remoteHead(sandbox, remote.dir)
      moveCloneWithoutImport(b, opened)
      const subjects = await subjectsOf(b, opened)
      // Even a workspace recorded as diverged: a clone that cannot be moved back is an error.
      b.repositories.workspaceGit.setState(opened, "diverged", null)
      refuse(true)

      const stopped = await b.sync.syncNow(opened)

      expect(stopped).toMatchObject({ state: "error", lastError: { code: "command_failed" } })
      expect(await subjectsOf(b, opened)).toEqual(subjects)
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      expect(binding(b, opened).integratingFrom).toBe(openedAt)

      // A restart's reconcile stops the same way rather than committing over the moved clone.
      await b.sync.reconcile()
      expect(binding(b, opened)).toMatchObject({ state: "error", integratingFrom: openedAt })
      expect(await subjectsOf(b, opened)).toEqual(subjects)

      refuse(false)
      const recovered = await b.sync.syncNow(opened)

      expect(recovered).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
      expect(binding(b, opened).integratingFrom).toBeNull()
    })

    it("stays marked when moving back after a failed import fails, and the next cycle moves back before committing", async () => {
      const sandbox = makeSandbox()
      const a = openDevice(sandbox, "a")
      const remote = makeBareRemote(sandbox, "shared.git")
      await publish(a, sandbox, remote)
      const { device: b, refuse } = refusingResets(sandbox, "b")
      const opened = await openFromRemote(b, remote.url)
      const tip = headOf(b, opened)
      const broken = pushFromElsewhere(sandbox, remote, { "workspace.json": NOT_A_WORKSPACE }, "Break the workspace file")
      refuse(true)

      const failed = await b.sync.syncNow(opened)

      expect(failed.state).toBe("error")
      expect(failed.lastError?.message).toMatch(/workspace\.json is not valid JSON/)
      expect(headOf(b, opened)).toBe(broken)
      expect(binding(b, opened).integratingFrom).toBe(tip)

      refuse(false)
      const again = await b.sync.syncNow(opened)

      // Back on the database's commit first: the cycle met the same unreadable tree, rather than committing the database's over it.
      expect(again.state).toBe("error")
      expect(again.lastError?.message).toMatch(/workspace\.json is not valid JSON/)
      expect(headOf(b, opened)).toBe(tip)
      expect(remoteHead(sandbox, remote.dir)).toBe(broken)
      expect(binding(b, opened).integratingFrom).toBeNull()
    })

    it("moves the clone back before connecting another remote, so it never pushes commits the database does not hold", async () => {
      const sandbox = makeSandbox()
      const a = openDevice(sandbox, "a")
      const remote = makeBareRemote(sandbox, "shared.git")
      const workspaceId = await publish(a, sandbox, remote)
      const b = openDevice(sandbox, "b")
      const opened = await openFromRemote(b, remote.url)
      const openedAt = headOf(b, opened)
      a.repositories.workflows.create({ workspaceId, name: "On A" })
      await a.sync.syncNow(workspaceId, { message: "Add on A" })
      moveCloneWithoutImport(b, opened)
      await b.sync.disconnectRemote(opened)
      const other = makeBareRemote(sandbox, "other.git")

      await b.sync.connectRemote(opened, other.url)

      expect(remoteHead(sandbox, other.dir)).toBe(openedAt)
      expect(headOf(b, opened)).toBe(openedAt)
      expect(binding(b, opened).integratingFrom).toBeNull()
    })
  })

  it("records a fetch the host refuses as an error: only a refused push makes a workspace read-only", async () => {
    const sandbox = makeSandbox()
    const refusing = await listen((_request, response) => {
      response.writeHead(403, { "Content-Type": "text/plain" })
      response.end("Forbidden\n")
    })
    let refuseFetch = false
    const a = openDevice(sandbox, "a", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remoteName) => {
        if (!refuseFetch) return git.fetch(dir, remoteName)
        const original = rawGit(dir, sandbox.env, "remote", "get-url", "origin").trim()
        try {
          await git.remoteSetUrl(dir, "origin", refusing.url)
          return await git.fetch(dir, remoteName)
        } finally {
          await git.remoteSetUrl(dir, "origin", original)
        }
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    refuseFetch = true

    const status = await a.sync.syncNow(workspaceId)

    expect(status).toMatchObject({ state: "error", readOnly: false, lastError: { code: "permission_denied" } })
  })

  it("keeps an automatic workspace diverged through a cycle that fails before integrating, and through reconcile", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    let failFetch = false
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remoteName) => {
        if (failFetch) throw networkDown()
        return git.fetch(dir, remoteName)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    b.repositories.workflows.create({ workspaceId: opened, name: "On B" })
    expect(await b.sync.syncNow(opened, { message: "Add on B" })).toMatchObject({ state: "diverged" })

    failFetch = true
    await b.sync.start()

    expect(binding(b, opened)).toMatchObject({ state: "diverged", lastError: { code: "network_error", message: NETWORK_DOWN } })
    await b.sync.reconcile()
    expect(binding(b, opened)).toMatchObject({ state: "diverged", lastError: { code: "network_error", message: NETWORK_DOWN } })

    failFetch = false
    expect(await b.sync.syncNow(opened)).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })
  })

  it.each([
    { cause: "a missing author", lastError: { code: "identity_missing" as const, message: "git does not know who you are" } },
    { cause: "a push the remote kept rejecting", lastError: { code: "non_fast_forward" as const, message: "git push failed: (non-fast-forward)" } },
  ])("keeps an error a fetch did not cause, $cause, through a good manual fetch", async ({ lastError }) => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    await publish(a, sandbox, remote)
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    await b.sync.setMode(opened, "manual")
    b.repositories.workspaceGit.setState(opened, "error", lastError)

    await b.sync.start()

    expect(binding(b, opened)).toMatchObject({ state: "error", lastError })
  })
})
