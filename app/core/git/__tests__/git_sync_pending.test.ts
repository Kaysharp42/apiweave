import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus"
import { GitSyncService, type GitSyncGit } from "../git_sync_service"
import type { GitService } from "../git_service"
import { openHarness, passthrough, type Harness, type HarnessOptions } from "./git_sync_harness"
import { makeBareRemote, rawGit } from "./git_test_utils"

/** Every file in a clone but git's own, by '/'-separated path. */
function readTree(dir: string): Map<string, string> {
  const files = new Map<string, string>()
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const full = path.join(entry.parentPath, entry.name)
    const relative = path.relative(dir, full).split(path.sep).join("/")
    if (!entry.isFile() || relative.startsWith(".git/")) continue
    files.set(relative, fs.readFileSync(full, "utf8"))
  }
  return files
}

/** The real git, except that every call is counted by method name. */
function counting(calls: string[]): (git: GitService) => GitSyncGit {
  return (git) => {
    const base = passthrough(git)
    const counted = (Object.keys(base) as (keyof GitSyncGit)[]).map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push(name)
        return (base[name] as (...inner: unknown[]) => unknown)(...args)
      },
    ])
    return Object.fromEntries(counted) as unknown as GitSyncGit
  }
}

/** A tracked manual workspace holding one of each kind of record, committed: the base the changes below are made against. */
async function committedBase(options: HarnessOptions = {}) {
  const harness = openHarness(options)
  const { workspaces, collections, workflows, environments } = harness.repositories
  const { workspaceId } = harness
  const checkout = workflows.create({ workspaceId, name: "Checkout" })
  const legacy = workflows.create({ workspaceId, name: "Legacy flow!" })
  const billing = collections.create({ workspaceId, name: "Billing" })
  const retired = collections.create({ workspaceId, name: "Retired (2025)" })
  const prod = environments.create({ workspaceId, name: "Prod", variables: { host: "a" }, isDefault: true })
  const staging = environments.create({ workspaceId, name: "Staging (old)" })
  await harness.sync.track(workspaceId)
  await harness.sync.setMode(workspaceId, "manual")
  await harness.sync.commitLocal(workspaceId)
  return { harness, workspaces, collections, workflows, environments, checkout, legacy, billing, retired, prod, staging }
}

async function headSubjects(harness: Harness): Promise<string[]> {
  return (await harness.git.log(harness.dir)).map((entry) => entry.subject)
}

describe("GitSyncService pending changes", () => {
  it("names what a commit would add, change and delete, for every kind of record", async () => {
    const base = await committedBase()
    const { harness, workspaces, collections, workflows, environments } = base
    const { workspaceId } = harness
    workspaces.update(workspaceId, { name: "Acme QA v2" })
    const login = workflows.create({ workspaceId, name: "Login" })
    workflows.update(base.checkout.workflowId, { name: "Checkout v2" })
    workflows.delete(base.legacy.workflowId)
    const extra = collections.create({ workspaceId, name: "Extra" })
    collections.update(base.billing.collectionId, { name: "Billing v2" })
    collections.delete(base.retired.collectionId)
    const qa = environments.create({ workspaceId, name: "QA" })
    environments.update(base.prod.environmentId, { variables: { host: "b" } })
    environments.delete(base.staging.environmentId)

    const changes = await harness.sync.pendingChanges(workspaceId)

    expect(changes).toEqual([
      { kind: "workspace", change: "changed", name: "Acme QA v2", path: "workspace.json" },
      { kind: "project", change: "changed", name: "Billing v2", path: `projects/billing-v2--${base.billing.collectionId}.json` },
      { kind: "project", change: "added", name: "Extra", path: `projects/extra--${extra.collectionId}.json` },
      // Named from the last commit, where the record still is: the slug is not the name.
      { kind: "project", change: "deleted", name: "Retired (2025)", path: `projects/retired-2025--${base.retired.collectionId}.json` },
      { kind: "workflow", change: "changed", name: "Checkout v2", path: `workflows/checkout-v2--${base.checkout.workflowId}.json` },
      { kind: "workflow", change: "deleted", name: "Legacy flow!", path: `workflows/legacy-flow--${base.legacy.workflowId}.json` },
      { kind: "workflow", change: "added", name: "Login", path: `workflows/login--${login.workflowId}.json` },
      { kind: "environment", change: "changed", name: "Prod", path: `environments/prod--${base.prod.environmentId}.json` },
      { kind: "environment", change: "added", name: "QA", path: `environments/qa--${qa.environmentId}.json` },
      { kind: "environment", change: "deleted", name: "Staging (old)", path: `environments/staging-old--${base.staging.environmentId}.json` },
    ])
  })

  it("reports a renamed record once, as changed, whether or not git would detect the rename", async () => {
    const { harness, workflows, checkout } = await committedBase()
    workflows.update(checkout.workflowId, { name: "A completely different name", description: "and nothing else alike" })

    const changes = await harness.sync.pendingChanges(harness.workspaceId)

    expect(changes).toEqual([
      {
        kind: "workflow",
        change: "changed",
        name: "A completely different name",
        path: `workflows/a-completely-different-name--${checkout.workflowId}.json`,
      },
    ])
  })

  it("is empty when nothing changed, and after the changes are committed", async () => {
    const { harness, workflows } = await committedBase()
    expect(await harness.sync.pendingChanges(harness.workspaceId)).toEqual([])

    workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    expect(await harness.sync.pendingChanges(harness.workspaceId)).toHaveLength(1)
    await harness.sync.commitLocal(harness.workspaceId, { message: "Add login" })

    expect(await harness.sync.pendingChanges(harness.workspaceId)).toEqual([])
  })

  it("leaves the clone byte for byte as it was: no commit, nothing staged, nothing written", async () => {
    const { harness, workflows, checkout } = await committedBase()
    const before = await headSubjects(harness)
    const status = (): string => rawGit(harness.dir, harness.sandbox.env, "status", "--porcelain", "--untracked-files=all")
    workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    workflows.delete(checkout.workflowId)
    const files = readTree(harness.dir)
    expect(status()).toBe("")

    expect(await harness.sync.pendingChanges(harness.workspaceId)).toHaveLength(2)

    expect(status()).toBe("")
    expect(readTree(harness.dir)).toEqual(files)
    expect(await headSubjects(harness)).toEqual(before)
    expect(rawGit(harness.dir, harness.sandbox.env, "diff", "--cached", "--name-only")).toBe("")
  })

  it("reads HEAD with a fixed number of git calls however many records were deleted", async () => {
    const calls: string[] = []
    const { harness, workflows } = await committedBase({ wrap: counting(calls) })
    const { workspaceId } = harness
    const created = Array.from({ length: 300 }, (_, index) => workflows.create({ workspaceId, name: `Bulk ${index}` }))
    await harness.sync.commitLocal(workspaceId)
    for (const workflow of created) workflows.delete(workflow.workflowId)
    calls.length = 0

    const changes = await harness.sync.pendingChanges(workspaceId)

    expect(changes.filter((change) => change.change === "deleted" && change.name.startsWith("Bulk "))).toHaveLength(300)
    // One listing of HEAD's files and one batch for the names of the deleted ones, whatever the count.
    expect(calls.filter((name) => name === "lsTree" || name === "readBlobs").sort()).toEqual(["lsTree", "readBlobs"])
    expect(calls.length).toBeLessThanOrEqual(4)
  })

  it("lists every record as added before the first commit", async () => {
    const harness = openHarness({ anonymous: true })
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "First" })
    await expect(harness.sync.track(harness.workspaceId)).rejects.toThrow()

    const changes = await harness.sync.pendingChanges(harness.workspaceId)

    expect(changes.map(({ kind, change, name }) => `${change} ${kind} ${name}`)).toEqual(["added workspace Acme QA", "added workflow First"])
  })

  it("leaves the following cycle as it would have been: one commit with the message, and a clean status", async () => {
    const { harness, workflows } = await committedBase()
    const before = await headSubjects(harness)
    workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    expect(await harness.sync.status(harness.workspaceId)).toMatchObject({ uncommitted: true })

    await harness.sync.pendingChanges(harness.workspaceId)
    await harness.sync.pendingChanges(harness.workspaceId)
    // Reading what is pending does not make it committed.
    expect(await harness.sync.status(harness.workspaceId)).toMatchObject({ uncommitted: true })
    const status = await harness.sync.syncNow(harness.workspaceId, { message: "Add login" })

    expect(status).toMatchObject({ state: "idle", uncommitted: false, lastError: null, lastCommit: { subject: "Add login" } })
    expect(await headSubjects(harness)).toEqual(["Add login", ...before])
    const files = rawGit(harness.dir, harness.sandbox.env, "show", "--name-only", "--format=", "HEAD").trim().split("\n")
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^workflows\/login--/)
    expect((await harness.git.status(harness.dir)).clean).toBe(true)
    expect(await harness.sync.pendingChanges(harness.workspaceId)).toEqual([])
  })

  it("moves a clone an import never caught up with back to the database first, instead of reporting the inverse of the import", async () => {
    const { harness, workflows } = await committedBase()
    const base = await harness.git.revParse(harness.dir, "HEAD")
    const arrived = workflows.create({ workspaceId: harness.workspaceId, name: "Arrived from the remote" })
    await harness.sync.commitLocal(harness.workspaceId)
    // What a fast-forward leaves when the app quits before its import commits: the clone holds a record the database does not.
    workflows.delete(arrived.workflowId)
    harness.repositories.workspaceGit.setIntegratingFrom(harness.workspaceId, base ?? null)

    const changes = await harness.sync.pendingChanges(harness.workspaceId)

    expect(changes).toEqual([])
    expect(await harness.git.revParse(harness.dir, "HEAD")).toBe(base)
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)?.integratingFrom).toBeNull()
  })

  it("rejects for a workspace with no version history", async () => {
    const harness = openHarness()

    await expect(harness.sync.pendingChanges(harness.workspaceId)).rejects.toThrow(/no version history/)
  })
})

describe("GitSyncService uncommitted status", () => {
  it("is false when tracked, true after an edit — announced at the first edit only — and false after a commit", async () => {
    const statuses: WorkspaceGitStatus[] = []
    const { harness, workflows } = await committedBase({ onStatusChanged: (status) => statuses.push(status) })
    expect(await harness.sync.status(harness.workspaceId)).toMatchObject({ uncommitted: false })
    statuses.length = 0

    workflows.create({ workspaceId: harness.workspaceId, name: "One" })
    await vi.waitFor(() => expect(statuses.some((status) => status.uncommitted)).toBe(true))
    const announced = statuses.length
    workflows.create({ workspaceId: harness.workspaceId, name: "Two" })
    await harness.sync.settled()
    expect(statuses).toHaveLength(announced)
    expect(await harness.sync.status(harness.workspaceId)).toMatchObject({ uncommitted: true })

    await harness.sync.commitLocal(harness.workspaceId)
    expect(await harness.sync.status(harness.workspaceId)).toMatchObject({ uncommitted: false })
  })

  it("is true after a restart for a manual workspace that had edits waiting, and false for one that had none", async () => {
    const { harness, workflows } = await committedBase()
    await harness.sync.dispose()
    const clean = new GitSyncService({ cloneRoot: harness.cloneRoot, git: harness.git, repositories: harness.repositories })
    await clean.reconcile()
    expect(await clean.status(harness.workspaceId)).toMatchObject({ uncommitted: false })
    await clean.dispose()

    workflows.create({ workspaceId: harness.workspaceId, name: "Waiting" })
    const restarted = new GitSyncService({ cloneRoot: harness.cloneRoot, git: harness.git, repositories: harness.repositories })
    await restarted.reconcile()

    expect(await restarted.status(harness.workspaceId)).toMatchObject({ uncommitted: true })
    expect(await restarted.pendingChanges(harness.workspaceId)).toMatchObject([{ kind: "workflow", change: "added", name: "Waiting" }])
    await restarted.dispose()
  })

  it("is false after a restart for an auto workspace, whose waiting edits startup commits", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    await harness.sync.dispose()
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Waiting" })
    const restarted = new GitSyncService({ cloneRoot: harness.cloneRoot, git: harness.git, repositories: harness.repositories })

    await restarted.reconcile()

    expect(await restarted.status(harness.workspaceId)).toMatchObject({ uncommitted: false })
    await restarted.dispose()
  })

  it("is false for an untracked workspace, whatever it holds", async () => {
    const harness = openHarness()
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })

    expect(await harness.sync.status(harness.workspaceId)).toMatchObject({ tracked: false, uncommitted: false })
  })
})

describe("GitSyncService discard after reading what is pending", () => {
  /** A manual workspace on a remote that holds its one commit: what "the remote's version" is. */
  async function connected() {
    const base = await committedBase()
    const remote = makeBareRemote(base.harness.sandbox)
    await base.harness.sync.connectRemote(base.harness.workspaceId, remote.url)
    return base
  }

  const namesOf = (harness: Harness): string[] =>
    harness.repositories.workflows.listByWorkspace(harness.workspaceId, true).items.map((item) => item.name).sort()

  it("drops a record added here after the dialog listed it and was cancelled", async () => {
    const { harness, workflows } = await connected()
    workflows.create({ workspaceId: harness.workspaceId, name: "Local only" })
    await harness.sync.pendingChanges(harness.workspaceId)

    const status = await harness.sync.discardLocalChanges(harness.workspaceId)

    expect(namesOf(harness)).toEqual(["Checkout", "Legacy flow!"])
    expect((await harness.git.status(harness.dir)).clean).toBe(true)
    expect(status).toMatchObject({ state: "idle", uncommitted: false })
    expect(await harness.sync.pendingChanges(harness.workspaceId)).toEqual([])
  })

  it("drops a record added before a restart, which the startup check must not have written into the clone", async () => {
    const { harness, workflows } = await connected()
    workflows.create({ workspaceId: harness.workspaceId, name: "Local only" })
    await harness.sync.dispose()
    const restarted = new GitSyncService({ cloneRoot: harness.cloneRoot, git: harness.git, repositories: harness.repositories })
    await restarted.reconcile()
    expect(await restarted.status(harness.workspaceId)).toMatchObject({ uncommitted: true })
    expect((await harness.git.status(harness.dir)).clean).toBe(true)

    const status = await restarted.discardLocalChanges(harness.workspaceId)

    expect(namesOf(harness)).toEqual(["Checkout", "Legacy flow!"])
    expect((await harness.git.status(harness.dir)).clean).toBe(true)
    expect(status).toMatchObject({ state: "idle", uncommitted: false })
    await restarted.dispose()
  })

  it("drops a record file a cycle wrote and never staged, which a reset leaves behind", async () => {
    const { harness, workflows } = await connected()
    workflows.create({ workspaceId: harness.workspaceId, name: "Stray" })
    // A crash between a cycle's tree write and its `git add`: the file is on disk, untracked, and the commit never happened.
    await harness.sync.commitLocal(harness.workspaceId)
    rawGit(harness.dir, harness.sandbox.env, "reset", "--mixed", "HEAD~1")
    expect(rawGit(harness.dir, harness.sandbox.env, "status", "--porcelain")).toMatch(/^\?\? workflows\/stray--/m)

    await harness.sync.discardLocalChanges(harness.workspaceId)

    expect(namesOf(harness)).toEqual(["Checkout", "Legacy flow!"])
    expect((await harness.git.status(harness.dir)).clean).toBe(true)
  })
})

describe("GitSyncService status announcements", () => {
  /**
   * A local-only workspace asks git for one thing when it reports a status:
   * its last commit. Once `stubbed`, that call answers from memory, and the
   * first one is held — with the commit it saw — until `release`. So an
   * announce can be held mid-way while another is asked for and has nothing
   * left to wait on but the first.
   */
  async function heldLastCommit() {
    const statuses: WorkspaceGitStatus[] = []
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const reached = new Promise<void>((resolve) => {
      entered = resolve
    })
    const control = { stubbed: false, holdFirst: false, subject: "one" }
    const { harness, workflows } = await committedBase({
      onStatusChanged: (status) => statuses.push(status),
      wrap: (git) => ({
        ...passthrough(git),
        log: async (dir, options) => {
          if (!control.stubbed) return git.log(dir, options)
          const entry = { sha: "1".repeat(40), parents: [], authorName: "a", authorEmail: "a@b.c", authorDate: "2026-10-20T10:00:00Z", subject: control.subject, body: "" }
          if (control.holdFirst) {
            control.holdFirst = false
            entered()
            await released
          }
          return [entry]
        },
      }),
    })
    statuses.length = 0
    control.stubbed = true
    control.holdFirst = true
    return { harness, workflows, statuses, control, reached, release }
  }

  it("emits in the order it was asked: a slow announce cannot land after a later one with the older picture", async () => {
    const { harness, workflows, statuses, control, reached, release } = await heldLastCommit()

    // The first edit's announce asks for the last commit, sees "one", and is held there.
    workflows.create({ workspaceId: harness.workspaceId, name: "First edit" })
    await reached
    control.subject = "two"
    const reannounced = harness.sync.setMode(harness.workspaceId, "manual")
    // A tick yield, not a delay: with nothing but memory left to do, an announce that did not wait would have finished.
    await new Promise((resolve) => setImmediate(resolve))
    release()
    await reannounced
    await harness.sync.settled()

    expect(statuses.map((status) => status.lastCommit?.subject)).toEqual(["one", "two"])
  })

  it("reports the row as it is when git has answered, not as it was when the announce began", async () => {
    const { harness, workflows, statuses, reached, release } = await heldLastCommit()

    workflows.create({ workspaceId: harness.workspaceId, name: "First edit" })
    await reached
    // An operation finishes while the announce is held at git.
    harness.repositories.workspaceGit.setState(harness.workspaceId, "error", { code: "command_failed", message: "late" })
    release()
    await harness.sync.settled()

    expect(statuses[statuses.length - 1]).toMatchObject({ state: "error", lastError: { message: "late" } })
  })
})

describe("GitSyncService uncommitted status after a failed startup commit", () => {
  it("stays true for an automatic workspace whose commit at startup failed", async () => {
    const harness = openHarness({ anonymous: true })
    await expect(harness.sync.track(harness.workspaceId)).rejects.toThrow()
    await harness.sync.dispose()
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Waiting" })
    const statuses: WorkspaceGitStatus[] = []
    const restarted = new GitSyncService({
      cloneRoot: harness.cloneRoot,
      git: harness.git,
      repositories: harness.repositories,
      onStatusChanged: (status) => statuses.push(status),
    })

    await restarted.reconcile()

    expect(await restarted.status(harness.workspaceId)).toMatchObject({ mode: "auto", state: "error", uncommitted: true })
    expect(statuses[statuses.length - 1]).toMatchObject({ uncommitted: true })
    await restarted.dispose()
  })
})
