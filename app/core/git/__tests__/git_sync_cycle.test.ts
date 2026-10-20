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
  /** Replaced by {@link Device.restart}, which is what a second process over the same database and clone does. */
  sync: GitSyncService
  readonly git: GitService
  readonly cloneRoot: string
  readonly env: NodeJS.ProcessEnv
  /** Every workspace the service said it imported into, in order. */
  readonly imports: string[]
  /** Quit the service and start another over this database and clone, as the app restarting does. */
  readonly restart: () => Promise<void>
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
  const start = (): GitSyncService =>
    new GitSyncService({ cloneRoot, git: wrap?.(git) ?? git, repositories, onImported: (workspaceId) => imports.push(workspaceId) })
  sync = start()
  const device: Device = {
    db,
    repositories,
    sync,
    git,
    cloneRoot,
    env: sandbox.env,
    imports,
    restart: async () => {
      await device.sync.dispose()
      sync = start()
      device.sync = sync
    },
  }
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

/** The file a workflow is written as, from the tree the database would serialize now. */
function workflowFileOf(device: Device, workspaceId: string, workflowId: string): string {
  const file = [...treeOf(device, workspaceId).keys()].find((relative) => relative.startsWith("workflows/") && relative.includes(workflowId))
  if (file === undefined) throw new Error(`no workflow file for ${workflowId}`)
  return file
}

/** A file of the device's working tree, read from disk: what the checkout holds now, not what the database would write. */
function cloneText(device: Device, workspaceId: string, relative: string): string {
  return fs.readFileSync(path.join(dirOf(device, workspaceId), ...relative.split("/")), "utf8")
}

/** The clone's HEAD commit as git knows it: subject, parents and sha. */
async function headCommitOf(device: Device, workspaceId: string) {
  const [head] = await device.git.log(dirOf(device, workspaceId), { maxCount: 1 })
  if (head === undefined) throw new Error("the clone has no commit")
  return head
}

/**
 * Two computers on one workspace, each with a "Shared" workflow both will edit.
 * A published it and pushed it; B opened it from that remote.
 */
interface SharedPair {
  readonly sandbox: GitSandbox
  readonly a: Device
  readonly remote: { readonly dir: string; readonly url: string }
  readonly workspaceId: string
  readonly b: Device
  readonly opened: string
  readonly sharedId: string
}

async function sharedPair(): Promise<SharedPair> {
  const sandbox = makeSandbox()
  const a = openDevice(sandbox, "a")
  const remote = makeBareRemote(sandbox, "shared.git")
  const workspaceId = await publish(a, sandbox, remote)
  const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
  await a.sync.syncNow(workspaceId, { message: "Add shared" })
  const b = openDevice(sandbox, "b")
  const opened = await openFromRemote(b, remote.url)
  return { sandbox, a, remote, workspaceId, b, opened, sharedId: shared.workflowId }
}

/**
 * Both computers rename the same workflow, which is a conflict the merge cannot
 * settle: A's commit is on the remote, B's is local, and B's cycle stops
 * `merging`. Returns the two heads the merge is between.
 */
async function renameConflict(pair: SharedPair, theirs = "On A", ours = "On B"): Promise<{ readonly aHead: string; readonly bHead: string }> {
  const { a, b, remote, sandbox, workspaceId, opened, sharedId } = pair
  a.repositories.workflows.update(sharedId, { name: theirs })
  await a.sync.syncNow(workspaceId, { message: "Rename on A" })
  const aHead = headOf(a, workspaceId)
  expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
  b.repositories.workflows.update(sharedId, { name: ours })
  const status = await b.sync.syncNow(opened, { message: "Rename on B" })
  expect(status.state).toBe("merging")
  return { aHead, bHead: headOf(b, opened) }
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

  it("merges diverged changes into a two-parent commit and pushes it, so neither side is lost", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
    await a.sync.syncNow(workspaceId, { message: "Add shared" })
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)

    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    const aHead = headOf(a, workspaceId)
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)

    const onB = b.repositories.workflows.create({ workspaceId: opened, name: "On B" })
    const merged = await b.sync.syncNow(opened, { message: "Add on B" })

    expect(merged).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    const bHead = headOf(b, opened)
    expect(bHead).not.toBe(aHead)
    // A real merge commit: the remote's commit and this device's are its parents.
    const [head] = await b.git.log(dirOf(b, opened), { maxCount: 1 })
    expect(head?.parents).toHaveLength(2)
    expect(head?.parents).toContain(aHead)
    expect(remoteHead(sandbox, remote.dir)).toBe(bHead)
    expect((await subjectsOf(b, opened))[0]).toBe("Merge the remote's changes")
    expect(b.imports).toEqual([opened])
    expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
    expect(b.repositories.workflows.getById(onB.workflowId)?.name).toBe("On B")
    expect(b.repositories.workflows.getById(shared.workflowId)?.name).toBe("Shared")

    // A pulls the merge commit and holds both sides too.
    await a.sync.syncNow(workspaceId)
    expect(headOf(a, workspaceId)).toBe(bHead)
    expect(a.repositories.workflows.getById(onB.workflowId)?.name).toBe("On B")
    expect(snapshotOf(a, workspaceId)).toEqual(snapshotOf(b, opened))
  })

  describe("a merge that needs the user", () => {
    it("stops a same-field conflict as merging, leaving both copies untouched until it is resolved", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      const { aHead, bHead } = await renameConflict(pair)

      expect(binding(b, opened)).toMatchObject({ state: "merging", integratingFrom: null })
      expect(binding(b, opened).lastError?.message).toMatch(/merging the remote's changes/)
      const merge = b.repositories.workspaceGit.getMerge(opened)
      expect(merge).toMatchObject({ ourCommit: bHead, theirCommit: aHead })
      expect(merge?.picks).toEqual([])

      const conflicts = await b.sync.mergeConflicts(opened)
      expect(conflicts).toEqual([
        { kind: "workflow", recordId: sharedId, path: "name", name: "On B", base: "Shared", ours: "On B", theirs: "On A" },
      ])
      // Deterministic: the same trees and picks always give the same list.
      expect(await b.sync.mergeConflicts(opened)).toEqual(conflicts)

      // The database and the checkout still hold our copy; there is no merge commit and nothing was pushed.
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe("On B")
      const file = workflowFileOf(b, opened, sharedId)
      expect((JSON.parse(cloneText(b, opened, file)) as { name: string }).name).toBe("On B")
      expect((await headCommitOf(b, opened)).sha).toBe(bHead)
      expect((await headCommitOf(b, opened)).parents).toHaveLength(1)
      expect(await b.git.status(dirOf(b, opened))).toMatchObject({ clean: true })
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)

      // A resolve that picks nothing settles nothing, and leaves the merge exactly as it was.
      expect((await b.sync.resolveMerge(opened, [])).state).toBe("merging")
      expect(headOf(b, opened)).toBe(bHead)
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      expect(await b.sync.mergeConflicts(opened)).toEqual(conflicts)
      expect(headOf(a, workspaceId)).toBe(aHead)
    })

    it("names the last commit each side made to a conflicted record, without moving either side", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, opened, sharedId } = pair
      const { aHead, bHead } = await renameConflict(pair)

      // Asking twice for the same record answers once, and reading changes nothing.
      const commits = await b.sync.mergeRecordCommits(opened, [sharedId, sharedId])

      expect(commits).toEqual([
        {
          recordId: sharedId,
          ours: expect.objectContaining({ sha: bHead, authorName: "Device B", subject: "Rename on B" }),
          theirs: expect.objectContaining({ sha: aHead, authorName: "Device A", subject: "Rename on A" }),
        },
      ])
      expect(headOf(b, opened)).toBe(bHead)
      expect(headOf(a, pair.workspaceId)).toBe(aHead)
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
    })

    it("has no commit for a side that does not hold the record", async () => {
      const pair = await sharedPair()
      const { a, b, remote, sandbox, workspaceId, opened, sharedId } = pair
      a.repositories.workflows.delete(sharedId)
      await a.sync.syncNow(workspaceId, { message: "Delete on A" })
      const aHead = headOf(a, workspaceId)
      b.repositories.workflows.update(sharedId, { name: "Kept on B" })
      expect(await b.sync.syncNow(opened, { message: "Change on B" })).toMatchObject({ state: "merging" })

      const [commits] = await b.sync.mergeRecordCommits(opened, [sharedId])

      expect(commits?.ours).toMatchObject({ sha: headOf(b, opened), subject: "Change on B" })
      // A deleted it, so A's side has no commit for it — not an error.
      expect(commits?.theirs).toBeNull()
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
    })

    it("refuses to read commit details when no merge is waiting", async () => {
      const pair = await sharedPair()

      await expect(pair.b.sync.mergeRecordCommits(pair.opened, [pair.sharedId])).rejects.toThrow(
        "This workspace has no merge in progress.",
      )
    })

    it("resolves a merge with a pick: a two-parent commit, an import, a push, and the other clone fast-forwards", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      const { aHead, bHead } = await renameConflict(pair)

      const resolved = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }], { message: "Finish the merge" })

      expect(resolved).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      const head = await headCommitOf(b, opened)
      expect(head.subject).toBe("Merge the remote's changes")
      expect(head.parents).toHaveLength(2)
      expect(head.parents).toEqual([bHead, aHead])
      // The pick is what the merge commit holds, and the import landed the same tree in the database.
      const file = workflowFileOf(b, opened, sharedId)
      expect((JSON.parse(cloneText(b, opened, file)) as { name: string }).name).toBe("On A")
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe("On A")
      expect(await b.git.status(dirOf(b, opened))).toMatchObject({ clean: true })
      expect(b.imports).toEqual([opened])
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)

      // The other clone brings the merge in as a fast-forward, and holds the same records.
      expect(await a.sync.syncNow(workspaceId)).toMatchObject({ state: "idle", lastError: null })
      expect(headOf(a, workspaceId)).toBe(head.sha)
      expect(a.repositories.workflows.getById(sharedId)?.name).toBe("On A")
      expect(snapshotOf(a, workspaceId)).toEqual(snapshotOf(b, opened))
    })

    it("settles one pick and leaves the other conflicts waiting, writing and pushing nothing", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      pair.a.repositories.workflows.update(sharedId, { name: "On A", description: "From A" })
      await a.sync.syncNow(workspaceId, { message: "Change both on A" })
      const aHead = headOf(a, workspaceId)
      b.repositories.workflows.update(sharedId, { name: "On B", description: "From B" })
      expect(await b.sync.syncNow(opened, { message: "Change both on B" })).toMatchObject({ state: "merging" })
      const bHead = headOf(b, opened)
      expect((await b.sync.mergeConflicts(opened)).map((conflict) => conflict.path)).toEqual(["description", "name"])

      const partial = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])

      expect(partial).toMatchObject({ state: "merging" })
      expect((await b.sync.mergeConflicts(opened)).map((conflict) => conflict.path)).toEqual(["description"])
      expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toEqual([{ recordId: sharedId, path: "name", side: "theirs" }])
      // Nothing was committed or pushed: the pick waits with the merge.
      expect(headOf(b, opened)).toBe(bHead)
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)

      // The rest finishes it, and both picks are honoured.
      expect(await b.sync.resolveMerge(opened, [
        { recordId: sharedId, path: "name", side: "theirs" },
        { recordId: sharedId, path: "description", side: "ours" },
      ])).toMatchObject({ state: "idle" })
      expect(b.repositories.workflows.getById(sharedId)).toMatchObject({ name: "On A", description: "From B" })
      expect((await headCommitOf(b, opened)).parents).toHaveLength(2)
      expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, opened))
    })

    it.each(["ours", "theirs"] as const)("settles a delete against a change by taking %s", async (side) => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      a.repositories.workflows.delete(sharedId)
      await a.sync.syncNow(workspaceId, { message: "Delete on A" })
      const aHead = headOf(a, workspaceId)
      b.repositories.workflows.update(sharedId, { name: "Changed on B" })
      expect(await b.sync.syncNow(opened, { message: "Change on B" })).toMatchObject({ state: "merging" })
      const conflicts = await b.sync.mergeConflicts(opened)
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]).toMatchObject({ kind: "workflow", recordId: sharedId, path: "", ours: { name: "Changed on B" } })
      expect(conflicts[0]).not.toHaveProperty("theirs")
      const file = workflowFileOf(b, opened, sharedId)
      // B's own copy still stands: the remote's deletion has not been imported over it.
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe("Changed on B")

      expect(await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "", side }])).toMatchObject({ state: "idle" })

      const head = await headCommitOf(b, opened)
      expect(head.parents).toHaveLength(2)
      expect(head.parents).toContain(aHead)
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
      // Taking our change keeps the record; taking the remote's deletion removes it here and there.
      const kept = side === "ours"
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe(kept ? "Changed on B" : undefined)
      expect(fs.existsSync(path.join(dirOf(b, opened), ...file.split("/")))).toBe(kept)
      await a.sync.syncNow(workspaceId)
      expect(headOf(a, workspaceId)).toBe(head.sha)
      expect(a.repositories.workflows.getById(sharedId)?.name).toBe(kept ? "Changed on B" : undefined)
    })

    // The opposite direction: the deletion is this device's, the change is the remote's. `ours` is B's copy
    // (deleted), `theirs` is A's (changed).
    it.each(["ours", "theirs"] as const)("settles a deletion here against a change on the remote by taking %s", async (side) => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      const file = workflowFileOf(b, opened, sharedId)
      a.repositories.workflows.update(sharedId, { name: "Changed on A" })
      await a.sync.syncNow(workspaceId, { message: "Change on A" })
      const aHead = headOf(a, workspaceId)
      b.repositories.workflows.delete(sharedId)
      expect(await b.sync.syncNow(opened, { message: "Delete on B" })).toMatchObject({ state: "merging" })
      const bHead = headOf(b, opened)
      const conflicts = await b.sync.mergeConflicts(opened)
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]).toMatchObject({ kind: "workflow", recordId: sharedId, path: "", theirs: { name: "Changed on A" } })
      expect(conflicts[0]).not.toHaveProperty("ours")
      // Nothing is pushed, and B's own decision still stands: the record is deleted here, not restored from A.
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      expect(b.repositories.workflows.getById(sharedId)).toBeUndefined()
      expect(fs.existsSync(path.join(dirOf(b, opened), ...file.split("/")))).toBe(false)

      expect(await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "", side }])).toMatchObject({ state: "idle" })

      const head = await headCommitOf(b, opened)
      expect(head.parents).toEqual([bHead, aHead])
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
      // Taking the remote's copy imports and keeps it here; taking B's deletion commits the deletion, here and there.
      const kept = side === "theirs"
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe(kept ? "Changed on A" : undefined)
      // The file B deleted is gone either way, and the remote's copy comes back under A's name.
      expect(fs.existsSync(path.join(dirOf(b, opened), ...file.split("/")))).toBe(false)
      expect(fs.readdirSync(path.join(dirOf(b, opened), "workflows"))).toHaveLength(kept ? 1 : 0)
      await a.sync.syncNow(workspaceId)
      expect(headOf(a, workspaceId)).toBe(head.sha)
      expect(a.repositories.workflows.getById(sharedId)?.name).toBe(kept ? "Changed on A" : undefined)
    })

    // fallow-ignore-next-line complexity -- the branches are optional-chaining reads in this scenario's assertions, not control flow to refactor.
    it("preserves an edit made while the merge waits: commits it, redoes the merge on top, and pushes both", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      const { aHead, bHead } = await renameConflict(pair)
      const made = b.repositories.workflows.create({ workspaceId: opened, name: "Made while merging" })

      expect(await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }], { message: "Resolve while editing" }))
        .toMatchObject({ state: "idle" })

      const [head, edit] = await b.git.log(dirOf(b, opened), { maxCount: 2 })
      expect(head?.subject).toBe("Merge the remote's changes")
      expect(head?.parents).toEqual([edit?.sha, aHead])
      // The edit landed on our own commit, not inside the merge commit, so the merge was redone against it.
      expect(edit?.parents).toEqual([bHead])
      expect(b.repositories.workflows.getById(made.workflowId)?.name).toBe("Made while merging")
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe("On A")
      expect(remoteHead(sandbox, remote.dir)).toBe(head?.sha)

      // The remote receives the edit and the merge; the other clone brings both in.
      await a.sync.syncNow(workspaceId)
      expect(headOf(a, workspaceId)).toBe(head?.sha)
      expect(a.repositories.workflows.getById(made.workflowId)?.name).toBe("Made while merging")
      expect(a.repositories.workflows.getById(sharedId)?.name).toBe("On A")
    })

    it("recomputes a merge over a restart with its persisted picks, and finishes it without losing a local commit", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      a.repositories.workflows.update(sharedId, { name: "On A", description: "From A" })
      await a.sync.syncNow(workspaceId, { message: "Change both on A" })
      b.repositories.workflows.update(sharedId, { name: "On B", description: "From B" })
      expect(await b.sync.syncNow(opened, { message: "Change both on B" })).toMatchObject({ state: "merging" })
      const bHead = headOf(b, opened)
      const picks = [{ recordId: sharedId, path: "name", side: "theirs" as const }]
      expect(await b.sync.resolveMerge(opened, picks)).toMatchObject({ state: "merging" })
      expect(await subjectsOf(b, opened)).toContain("Change both on B")

      await b.restart()

      expect(binding(b, opened)).toMatchObject({ state: "merging" })
      await b.sync.reconcile()
      expect(binding(b, opened)).toMatchObject({ state: "merging", lastError: null })
      expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toEqual(picks)
      expect((await b.sync.mergeConflicts(opened)).map((conflict) => conflict.path)).toEqual(["description"])
      // Nothing was imported in the meantime: our copy is still the database's.
      expect(b.repositories.workflows.getById(sharedId)).toMatchObject({ name: "On B", description: "From B" })

      const resolved = await b.sync.resolveMerge(opened, [...picks, { recordId: sharedId, path: "description", side: "ours" }])

      expect(resolved).toMatchObject({ state: "idle", lastError: null })
      expect(b.repositories.workflows.getById(sharedId)).toMatchObject({ name: "On A", description: "From B" })
      const head = await headCommitOf(b, opened)
      expect(head.parents).toContain(bHead)
      expect(await subjectsOf(b, opened)).toContain("Change both on B")
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
      await a.sync.syncNow(workspaceId)
      expect(headOf(a, workspaceId)).toBe(head.sha)
    })

    it("repairs a crash between the merge commit and the import: goes back, recomputes, and reverts nothing on the remote", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      const { aHead, bHead } = await renameConflict(pair)
      const merge = b.repositories.workspaceGit.getMerge(opened)!
      // What a crash there leaves: the marker set before the clone moved, the clone on a
      // two-parent commit, and the database still as it was.
      b.repositories.workspaceGit.setIntegratingFrom(opened, bHead)
      await b.git.mergeNoCommit(dirOf(b, opened), merge.theirCommit)
      await b.git.commit(dirOf(b, opened), "Merge the remote's changes")
      expect(headOf(b, opened)).not.toBe(bHead)

      await b.restart()
      await b.sync.reconcile()

      expect(binding(b, opened)).toMatchObject({ state: "merging", integratingFrom: null })
      expect(headOf(b, opened)).toBe(bHead)
      expect(await subjectsOf(b, opened)).not.toContain("Merge the remote's changes")
      expect(await b.sync.mergeConflicts(opened)).toHaveLength(1)
      // Repairing never writes to the remote, and no cycle pushes the database over it.
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)

      const resolved = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])

      expect(resolved).toMatchObject({ state: "idle", lastError: null })
      const head = await headCommitOf(b, opened)
      expect(head.parents).toEqual([bHead, aHead])
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
      expect(a.repositories.workflows.getById(sharedId)?.name).toBe("On A")
      await a.sync.syncNow(workspaceId)
      expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, opened))
      expect(a.repositories.workflows.getById(sharedId)?.name).toBe("On A")
    })

    it("abandons the merge: keeps every local commit and edit, clears the picks, and merges again on a later cycle", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      a.repositories.workflows.update(sharedId, { name: "On A", description: "From A" })
      await a.sync.syncNow(workspaceId, { message: "Change both on A" })
      const aHead = headOf(a, workspaceId)
      b.repositories.workflows.update(sharedId, { name: "On B", description: "From B" })
      expect(await b.sync.syncNow(opened, { message: "Change both on B" })).toMatchObject({ state: "merging" })
      const bHead = b.repositories.workspaceGit.getMerge(opened)!.ourCommit
      expect(await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])).toMatchObject({ state: "merging" })
      expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toHaveLength(1)
      const uncommitted = b.repositories.workflows.create({ workspaceId: opened, name: "Edit before abandoning" })
      const imports = [...b.imports]

      const abandoned = await b.sync.abandonMerge(opened)

      expect(abandoned).toMatchObject({ state: "diverged" })
      expect(abandoned.lastError?.message).toMatch(/merge was abandoned/)
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      expect(headOf(b, opened)).toBe(bHead)
      expect(await subjectsOf(b, opened)).toContain("Change both on B")
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      expect(b.imports).toEqual(imports)
      // The database is untouched: our copies and the edit made while merging are all still here.
      expect(b.repositories.workflows.getById(sharedId)).toMatchObject({ name: "On B", description: "From B" })
      expect(b.repositories.workflows.getById(uncommitted.workflowId)?.name).toBe("Edit before abandoning")
      await expect(b.sync.resolveMerge(opened, [])).rejects.toThrow(/no merge in progress/)

      // Sync now asks for the merge again, with the edit committed as ours and no picks left over.
      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "merging" })
      expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toEqual([])
      expect((await b.sync.mergeConflicts(opened)).map((conflict) => conflict.path)).toEqual(["description", "name"])
      expect(b.repositories.workflows.getById(uncommitted.workflowId)?.name).toBe("Edit before abandoning")
      expect(await subjectsOf(b, opened)).toContainEqual(expect.stringContaining("Update workflows/"))
    })

    it("resolves a merge read-only when the host refuses the push, keeping the merge commit local and nothing lost", async () => {
      const sandbox = makeSandbox()
      const a = openDevice(sandbox, "a")
      const remote = makeBareRemote(sandbox, "shared.git")
      const workspaceId = await publish(a, sandbox, remote)
      const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
      await a.sync.syncNow(workspaceId, { message: "Add shared" })
      // A real server-side refusal by author, as a host's push rules make one.
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
      const b = openDevice(sandbox, "b")
      const opened = await openFromRemote(b, remote.url)
      a.repositories.workflows.update(shared.workflowId, { name: "On A" })
      await a.sync.syncNow(workspaceId, { message: "Rename on A" })
      const aHead = headOf(a, workspaceId)
      b.repositories.workflows.update(shared.workflowId, { name: "On B" })
      expect(await b.sync.syncNow(opened, { message: "Rename on B" })).toMatchObject({ state: "merging" })

      const resolved = await b.sync.resolveMerge(opened, [{ recordId: shared.workflowId, path: "name", side: "theirs" }])

      expect(resolved).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" } })
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      const head = await headCommitOf(b, opened)
      expect(head.parents).toHaveLength(2)
      expect(head.parents).toContain(aHead)
      expect(headOf(b, opened)).not.toBe(aHead)
      // The merge commit and the imported records stay; nothing was lost to the refusal.
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      expect(b.repositories.workflows.getById(shared.workflowId)?.name).toBe("On A")
      expect(await subjectsOf(b, opened)).toContain("Merge the remote's changes")

      // A later successful push sends it, and is what clears read-only.
      fs.rmSync(hook)
      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "idle", readOnly: false, lastError: null })
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
    })

    it("leaves a waiting merge alone through Sync now and the periodic pass, committing nothing over it", async () => {
      fakeTimers()
      const pair = await sharedPair()
      const { b, sandbox, remote, opened } = pair
      await renameConflict(pair)
      const head = headOf(b, opened)
      const remoteAt = remoteHead(sandbox, remote.dir)
      const subjects = await subjectsOf(b, opened)
      const edit = b.repositories.workflows.create({ workspaceId: opened, name: "While merging" })

      const during = await b.sync.syncNow(opened)

      expect(during).toMatchObject({ state: "merging" })
      expect(headOf(b, opened)).toBe(head)
      expect(await subjectsOf(b, opened)).toEqual(subjects)
      expect(remoteHead(sandbox, remote.dir)).toBe(remoteAt)
      await expect(b.sync.commitLocal(opened, { message: "Not now" })).rejects.toThrow(/Resolve or abandon the merge/)
      expect((await b.sync.status(opened)).uncommitted).toBe(true)
      expect(b.repositories.workflows.getById(edit.workflowId)?.name).toBe("While merging")

      // Startup and a pass leave the merge, its clone and the database's edit alone: no cycle, no resolve.
      await b.sync.start()
      await elapse(b, SYNC_INTERVAL_MS)

      expect(headOf(b, opened)).toBe(head)
      expect(await subjectsOf(b, opened)).toEqual(subjects)
      expect(remoteHead(sandbox, remote.dir)).toBe(remoteAt)
      expect(binding(b, opened).state).toBe("merging")
      expect(await b.sync.mergeConflicts(opened)).toHaveLength(1)
      expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toEqual([])
      expect(b.repositories.workflows.getById(edit.workflowId)?.name).toBe("While merging")
    })

    it("rolls a merge back and reports an error when the importer refuses its tree, pushing nothing", async () => {
      const sandbox = makeSandbox()
      const a = openDevice(sandbox, "a")
      const remote = makeBareRemote(sandbox, "shared.git")
      const workspaceId = await publish(a, sandbox, remote)
      const b = openDevice(sandbox, "b")
      const opened = await openFromRemote(b, remote.url)
      // Another workspace here already holds the id the remote is about to add, so the
      // importer refuses the merged tree.
      const other = b.repositories.workspaces.create({ name: "Other", slug: "other" })
      b.repositories.workflows.create({ workspaceId: other.workspaceId, workflowId: "wf-collide", name: "Elsewhere" })
      const collide = a.repositories.workflows.create({ workspaceId, workflowId: "wf-collide", name: "Remote collide" })
      await a.sync.syncNow(workspaceId, { message: "Add a colliding workflow" })
      const aHead = headOf(a, workspaceId)
      b.repositories.workflows.create({ workspaceId: opened, name: "B local" })

      const failed = await b.sync.syncNow(opened, { message: "Add B local" })

      expect(failed).toMatchObject({ state: "error", lastError: { message: expect.stringMatching(/already belong outside workspace/) } })
      const bHead = headOf(b, opened)
      expect(bHead).not.toBe(aHead)
      expect((await subjectsOf(b, opened))[0]).toMatch(/^Add B local$/)
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      // Back on our own commit, with no merge state left behind and nothing imported.
      expect(binding(b, opened)).toMatchObject({ state: "error", integratingFrom: null })
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      expect(await b.git.status(dirOf(b, opened))).toMatchObject({ clean: true })
      expect(b.imports).toEqual([])

      // The same cycle fails the same way: without the rollback it would push our tree over the remote's.
      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "error", lastError: { message: expect.stringMatching(/already belong outside workspace/) } })
      expect(headOf(b, opened)).toBe(bHead)
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)

      // Once the id is free, the same merge imports and pushes; nothing was damaged by the refusal.
      b.repositories.workflows.delete(collide.workflowId)
      b.repositories.workspaces.delete(other.workspaceId)
      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "idle", lastError: null })
      expect(b.repositories.workflows.getById(collide.workflowId)?.name).toBe("Remote collide")
      expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, opened))
    })
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

  it("commits an edit that lands while an automatic cycle is fetching, and merges it rather than importing over it", async () => {
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
    expect(status).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    // The edit was committed and then merged with the remote's tree, not imported over.
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .toEqual(expect.arrayContaining(["On A", "On B while fetching"]))
    expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
    expect(await subjectsOf(b, opened)).toContainEqual(expect.stringMatching(/^Update workflows\/on-b-while-fetching--/))
    expect((await subjectsOf(b, opened))[0]).toBe("Merge the remote's changes")
    const [head] = await b.git.log(dirOf(b, opened), { maxCount: 1 })
    expect(head?.parents).toContain(aHead)
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, opened))
  })

  it("commits an edit that lands while a manual cycle is fetching, and merges it rather than importing over it", async () => {
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

    expect(status).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .toEqual(expect.arrayContaining(["On A", "On B while fetching"]))
    expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
    expect(await subjectsOf(b, opened)).toContainEqual(expect.stringMatching(/^Update workflows\/on-b-while-fetching--/))
    expect((await subjectsOf(b, opened))[0]).toBe("Merge the remote's changes")
    const [head] = await b.git.log(dirOf(b, opened), { maxCount: 1 })
    expect(head?.parents).toContain(aHead)
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, opened))
  })

  it("catches an edit that lands while the clone is fast-forwarding: the clone goes back, and the edit is merged after the remote's", async () => {
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

    expect(status).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .toEqual(expect.arrayContaining(["On A", "On B while moving"]))
    expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
    // The edit is committed on the commit the clone was on before it moved, and the merge builds on that.
    expect((await subjectsOf(b, opened))[1]).toMatch(/^Update workflows\/on-b-while-moving--/)
    expect(rawGit(dirOf(b, opened), sandbox.env, "rev-parse", "HEAD~2").trim()).toBe(tip)
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, opened))
    expect(await b.git.log(dirOf(b, opened), { maxCount: 1 }).then(([head]) => head?.parents)).toContain(aHead)
  })

  it("keeps an edit that lands while the cycle is writing its own commit, and merges it after the commit that read the database before it", async () => {
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
    editDuringAdd = () => {
      b.repositories.workflows.create({ workspaceId: opened, name: "On B while committing" })
    }

    const status = await b.sync.syncNow(opened)

    expect(status).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .toEqual(expect.arrayContaining(["On A", "On B while committing"]))
    expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
    expect(await subjectsOf(b, opened)).toContainEqual(expect.stringMatching(/^Update workflows\/on-b-while-committing--/))
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, opened))
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

    // The local commits are still here, and the remote's tree is unreadable, so the cycle reports
    // that as an error rather than a history relationship: it pushes nothing over the remote.
    const later = await b.sync.syncNow(opened)
    expect(later).toMatchObject({ state: "error", lastError: { message: expect.stringMatching(/workspace\.json is not valid JSON/) } })
    expect(headOf(b, opened)).toBe(localTip)
    expect(await subjectsOf(b, opened)).not.toContain("Merge the remote's changes")
    expect(remoteHead(sandbox, remote.dir)).toBe(broken)
    expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
    expect(binding(b, opened).integratingFrom).toBeNull()
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
    const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
    await a.sync.syncNow(workspaceId, { message: "Add shared" })
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
    // A diverged workspace in this model is one whose merge the user gave up on: the two
    // histories still stand apart, and only Sync now asks for the merge again.
    a.repositories.workflows.update(shared.workflowId, { name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Rename on A" })
    b.repositories.workflows.update(shared.workflowId, { name: "On B" })
    expect(await b.sync.syncNow(opened, { message: "Rename on B" })).toMatchObject({ state: "merging" })
    expect(await b.sync.abandonMerge(opened)).toMatchObject({ state: "diverged" })

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
    expect(await b.sync.mergeConflicts(opened)).toEqual([])
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
    const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
    await a.sync.syncNow(workspaceId, { message: "Add shared" })
    let failFetch = false
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remoteName) => {
        if (failFetch) throw networkDown()
        return git.fetch(dir, remoteName)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    // A genuinely diverged workspace: the merge could not settle the two names, and was given up on.
    a.repositories.workflows.update(shared.workflowId, { name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Rename on A" })
    b.repositories.workflows.update(shared.workflowId, { name: "On B" })
    expect(await b.sync.syncNow(opened, { message: "Rename on B" })).toMatchObject({ state: "merging" })
    expect(await b.sync.abandonMerge(opened)).toMatchObject({ state: "diverged" })

    failFetch = true
    expect(await b.sync.syncNow(opened)).toMatchObject({ state: "diverged", lastError: { code: "network_error", message: NETWORK_DOWN } })

    // Startup runs a cycle for an automatic workspace, and this one fails before integrating too.
    await b.sync.reconcile()
    expect(binding(b, opened)).toMatchObject({ state: "diverged", lastError: { code: "network_error", message: NETWORK_DOWN } })

    // The periodic pass does not offer the merge an abandoned workspace waits for; Sync now does.
    failFetch = false
    await b.sync.start()
    expect(await b.sync.status(opened)).toMatchObject({ state: "diverged" })
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
