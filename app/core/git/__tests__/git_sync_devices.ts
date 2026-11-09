import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { afterEach, expect, vi } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { CollectionRepository, EnvironmentRepository, NodePresetRepository, WorkflowRepository, WorkspaceGitRepository, WorkspaceRepository } from "../../repositories"
import { serializeWorkspace, workspaceSnapshot, type WorkspaceSnapshot } from "../../services/workspace_repo_format"
import { GitCommandError, GitNetworkError, GitNonFastForwardError, type GitFailureDetails } from "../git_errors"
import { GitService } from "../git_service"
import { GitSyncService, type GitSyncGit, type GitSyncRepositories } from "../git_sync_service"
import { passthrough } from "./git_sync_harness"
import { makeBareRemote, makeSandbox, rawGit, type GitSandbox } from "./git_test_utils"

/**
 * Two devices syncing one workspace through a bare remote, over real git: the
 * fixtures the git_sync_* cycle tests share. Split across files so vitest runs
 * them in parallel — each test spawns dozens of git processes.
 */

/**
 * One device: its own database and clone root, against a sandbox shared by
 * both. A device is created before it has a workspace — A makes one, B opens
 * the one A pushed, which is what two computers do.
 */
export interface Device {
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

export function openDevice(sandbox: GitSandbox, name: string, wrap?: (git: GitService) => GitSyncGit): Device {
  const db = initDatabase({ databasePath: ":memory:" })
  let sync: GitSyncService | undefined
  const note = (workspaceId: string): void => sync?.workspaceChanged(workspaceId)
  const repositories: GitSyncRepositories = {
    workspaces: new WorkspaceRepository(db.kvStore, note),
    collections: new CollectionRepository(db.kvStore, note),
    workflows: new WorkflowRepository(db.kvStore, (event) => sync?.workflowChanged(event)),
    environments: new EnvironmentRepository(db.kvStore, note),
    presets: new NodePresetRepository(db.kvStore),
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

export function dirOf(device: Device, workspaceId: string): string {
  return path.join(device.cloneRoot, workspaceId)
}

export async function subjectsOf(device: Device, workspaceId: string): Promise<string[]> {
  return (await device.git.log(dirOf(device, workspaceId))).map((entry) => entry.subject)
}

export function headOf(device: Device, workspaceId: string): string {
  return rawGit(dirOf(device, workspaceId), device.env, "rev-parse", "HEAD").trim()
}

export function remoteHead(sandbox: GitSandbox, remoteDir: string): string {
  return rawGit(remoteDir, sandbox.env, "rev-parse", "main").trim()
}

export function binding(device: Device, workspaceId: string) {
  const row = device.repositories.workspaceGit.get(workspaceId)
  if (row === undefined) throw new Error("the workspace is not tracked")
  return row
}

export function snapshotOf(device: Device, workspaceId: string): WorkspaceSnapshot {
  const { workspaces, collections, workflows, environments, presets } = device.repositories
  return workspaceSnapshot({
    workspace: workspaces.getById(workspaceId)!,
    projects: collections.listByWorkspace(workspaceId).items,
    workflows: workflows.listByWorkspace(workspaceId, true).items,
    environments: environments.listByWorkspace(workspaceId).items,
    presets: presets.listByWorkspace(workspaceId).items,
  })
}

/** The device's clone as a path-to-text map, the way the format writes it. */
export function treeOf(device: Device, workspaceId: string): Map<string, string> {
  return serializeWorkspace(workspaceSnapshot({
    workspace: device.repositories.workspaces.getById(workspaceId)!,
    projects: device.repositories.collections.listByWorkspace(workspaceId).items,
    workflows: device.repositories.workflows.listByWorkspace(workspaceId, true).items,
    environments: device.repositories.environments.listByWorkspace(workspaceId).items,
    presets: device.repositories.presets.listByWorkspace(workspaceId).items,
  }))
}

/** The file a workflow is written as, from the tree the database would serialize now. */
export function workflowFileOf(device: Device, workspaceId: string, workflowId: string): string {
  const file = [...treeOf(device, workspaceId).keys()].find((relative) => relative.startsWith("workflows/") && relative.includes(workflowId))
  if (file === undefined) throw new Error(`no workflow file for ${workflowId}`)
  return file
}

/** A file of the device's working tree, read from disk: what the checkout holds now, not what the database would write. */
export function cloneText(device: Device, workspaceId: string, relative: string): string {
  return fs.readFileSync(path.join(dirOf(device, workspaceId), ...relative.split("/")), "utf8")
}

/** The clone's HEAD commit as git knows it: subject, parents and sha. */
export async function headCommitOf(device: Device, workspaceId: string) {
  const [head] = await device.git.log(dirOf(device, workspaceId), { maxCount: 1 })
  if (head === undefined) throw new Error("the clone has no commit")
  return head
}

/**
 * Two computers on one workspace, each with a "Shared" workflow both will edit.
 * A published it and pushed it; B opened it from that remote.
 */
export interface SharedPair {
  readonly sandbox: GitSandbox
  readonly a: Device
  readonly remote: { readonly dir: string; readonly url: string }
  readonly workspaceId: string
  readonly b: Device
  readonly opened: string
  readonly sharedId: string
}

export async function sharedPair(): Promise<SharedPair> {
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
export async function renameConflict(pair: SharedPair, theirs = "On A", ours = "On B"): Promise<{ readonly aHead: string; readonly bHead: string }> {
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

export function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
}

export async function elapse(device: Device, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  await device.sync.settled()
}

export interface FetchGate {
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
export function deferredFetch(): FetchGate {
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
export async function publish(device: Device, sandbox: GitSandbox, remote?: { dir: string; url: string }): Promise<string> {
  const workspaceId = device.repositories.workspaces.create({ name: "Acme QA", slug: "acme-qa" }).workspaceId
  await device.sync.track(workspaceId)
  await device.sync.connectRemote(workspaceId, (remote ?? makeBareRemote(sandbox)).url)
  return workspaceId
}

/** A second device, which opens the workspace the first pushed. */
export async function openFromRemote(device: Device, url: string): Promise<string> {
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

export function pushFromElsewhere(
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

/**
 * A brand-new root history holding `files`, force-pushed over the remote's
 * branch: what stopping and restarting tracking on another device leaves — the
 * same workspace with no commit in common.
 */
export function pushNewRootFromElsewhere(
  sandbox: GitSandbox,
  remote: { dir: string; url: string },
  files: ReadonlyMap<string, string>,
  message: string,
): string {
  const scratch = path.join(sandbox.root, `new-root-${++elsewhereCount}`)
  rawGit(sandbox.root, sandbox.env, "init", "--initial-branch=main", scratch)
  for (const [name, content] of files) {
    const full = path.join(scratch, ...name.split("/"))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  rawGit(scratch, sandbox.env, "add", "-A")
  rawGit(scratch, sandbox.env, "-c", "user.name=Someone Else", "-c", "user.email=someone@example.invalid", "commit", "-m", message)
  rawGit(scratch, sandbox.env, "push", "--force", remote.url, "main")
  return rawGit(scratch, sandbox.env, "rev-parse", "HEAD").trim()
}

/** `files` with the workspace record's fields replaced, as another device would have written it. */
export function withWorkspace(
  files: ReadonlyMap<string, string>,
  fields: { readonly workspaceId?: string; readonly name?: string },
): Map<string, string> {
  const tree = new Map(files)
  const text = tree.get("workspace.json")
  if (text === undefined) throw new Error("the tree holds no workspace.json")
  tree.set("workspace.json", JSON.stringify({ ...(JSON.parse(text) as Record<string, unknown>), ...fields }))
  return tree
}

/** Plain git fed `input` on stdin, for the plumbing that reads it: `hash-object --stdin`, `mktree`. */
export function rawGitInput(cwd: string, env: NodeJS.ProcessEnv, input: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
}

/** Plumbing inside a bare scratch clone: store a blob, or build a tree from `ls-tree` lines (`<mode> <type> <oid>\t<name>`). */
export interface TreeBuilder {
  readonly blob: (text: string) => string
  readonly tree: (entries: readonly string[]) => string
}

/**
 * A commit pushed to the remote that git's own commands would never make: the
 * remote's tip with `entries` added to its root tree by `mktree`, which checks
 * no path. This is how a hostile repository plants `.git/config` or a link.
 */
export function pushHandBuiltTree(
  sandbox: GitSandbox,
  remote: { dir: string; url: string },
  entries: (build: TreeBuilder) => readonly string[],
  message: string,
): string {
  const scratch = path.join(sandbox.root, `elsewhere-${++elsewhereCount}.git`)
  rawGit(sandbox.root, sandbox.env, "clone", "--bare", remote.url, scratch)
  const build: TreeBuilder = {
    blob: (text) => rawGitInput(scratch, sandbox.env, text, "hash-object", "-w", "--stdin"),
    tree: (lines) => rawGitInput(scratch, sandbox.env, `${lines.join("\n")}\n`, "mktree"),
  }
  const root = rawGit(scratch, sandbox.env, "ls-tree", "main").split("\n").filter((line) => line !== "")
  const tree = build.tree([...root, ...entries(build)])
  const commit = rawGit(
    scratch,
    sandbox.env,
    "-c", "user.name=Someone Else", "-c", "user.email=someone@example.invalid",
    "commit-tree", tree, "-p", "main", "-m", message,
  ).trim()
  rawGit(scratch, sandbox.env, "push", remote.url, `${commit}:refs/heads/main`)
  return commit
}

/** Where the entry {@link pushEntryFromElsewhere} sets lives. */
export const ENTRY_PATH = "docs/link"

/**
 * A commit pushed from elsewhere that sets {@link ENTRY_PATH} to `cacheinfo`
 * (`<mode>,<oid>`, made with the blob store it is handed), or removes it with
 * null — through the index alone, so the scratch clone never checks a link out.
 */
export function pushEntryFromElsewhere(
  sandbox: GitSandbox,
  remote: { dir: string; url: string },
  cacheinfo: ((blob: (text: string) => string) => string) | null,
  message: string,
): string {
  const scratch = path.join(sandbox.root, `elsewhere-${++elsewhereCount}`)
  rawGit(sandbox.root, sandbox.env, "-c", "core.symlinks=false", "clone", remote.url, scratch)
  if (cacheinfo === null) rawGit(scratch, sandbox.env, "rm", "--cached", "-q", "--", ENTRY_PATH)
  else {
    const info = cacheinfo((text) => rawGitInput(scratch, sandbox.env, text, "hash-object", "-w", "--stdin"))
    rawGit(scratch, sandbox.env, "update-index", "--add", "--cacheinfo", `${info},${ENTRY_PATH}`)
  }
  rawGit(scratch, sandbox.env, "-c", "user.name=Someone Else", "-c", "user.email=someone@example.invalid", "commit", "-m", message)
  rawGit(scratch, sandbox.env, "push", "origin", "main")
  return rawGit(scratch, sandbox.env, "rev-parse", "HEAD").trim()
}

/** The `ls-tree` line for {@link ENTRY_PATH} at `rev`: its mode, type and oid, or "" when `rev` has none. */
export function entryAt(dir: string, env: NodeJS.ProcessEnv, rev: string): string {
  return rawGit(dir, env, "ls-tree", rev, "--", ENTRY_PATH).trim()
}

/** A `workspace.json` no build can parse: what a hand-edited or conflicted file pushed from elsewhere looks like. */
export const NOT_A_WORKSPACE = "{ this is not a workspace\n"

/** A workflow file the format accepts, under an id no test has yet: proof that an import happened. */
export const REMOTE_WORKFLOW_ID = "wf-fixed-on-remote"
export const REMOTE_WORKFLOW_FILE = `workflows/fixed--${REMOTE_WORKFLOW_ID}.json`
export function remoteWorkflowFile(): string {
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
export function nonFastForward(): GitNonFastForwardError {
  const details: GitFailureDetails = { args: ["push"], exitCode: 1, stdout: "", stderr: "! [rejected] main -> main (non-fast-forward)" }
  return new GitNonFastForwardError("git push failed: (non-fast-forward)", details)
}

export const NETWORK_DOWN = "git fetch failed: fatal: unable to access the remote: Could not resolve host"

/** A fetch that cannot reach the remote, as git classifies it. */
export function networkDown(): GitNetworkError {
  return new GitNetworkError(NETWORK_DOWN, { args: ["fetch"], exitCode: 128, stdout: "", stderr: NETWORK_DOWN })
}

/** A reset that fails, as one would on a clone a crashed git left locked. */
export function resetRefused(): GitCommandError {
  const stderr = "fatal: Unable to create '.git/index.lock': File exists."
  return new GitCommandError(`git reset failed: ${stderr}`, { args: ["reset"], exitCode: 128, stdout: "", stderr })
}
