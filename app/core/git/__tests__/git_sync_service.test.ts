import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { parseWorkspace, serializeWorkspace } from "../../services/workspace_repo_format"
import { WorkspaceRepoImporter } from "../../services/workspace_repo_import"
import { AUTO_COMMIT_DELAY_MS, GitSyncService, SYNC_INTERVAL_MS, type GitSyncGit } from "../git_sync_service"
import { GitIdentityMissingError } from "../git_errors"
import type { GitService } from "../git_service"
import { writeWorkspaceTree } from "../workspace_tree"
import { openHarness, passthrough, subjects, type Harness } from "./git_sync_harness"
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

/** The real git, except that every commit fails as a full disk would. */
function failingCommits(git: GitService): GitSyncGit {
  return {
    ...passthrough(git),
    commit: () => Promise.reject(new Error("disk full")),
  }
}

/** The one fetch the holder asked to block on, and how the test says it is inside it. */
const hold: { on: boolean; entered?: () => void; release?: () => void } = { on: false }

/** A git whose next fetch waits for `hold.release`: a cycle a test can hold open across a dispose. */
function heldFetch(git: GitService): GitSyncGit {
  return {
    ...passthrough(git),
    fetch: async (dir, remote) => {
      if (hold.on) {
        hold.on = false
        await new Promise<void>((resolve) => {
          hold.release = resolve
          hold.entered?.()
        })
      }
      return git.fetch(dir, remote)
    },
  }
}

/** Auto commits wait on `setTimeout`; git's own process timers are faked too, but never advanced while git runs. */
function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
}

async function elapse(harness: Harness, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  await harness.sync.settled()
}

describe("GitSyncService", () => {
  it("track writes the format tree and makes exactly one commit", async () => {
    const harness = openHarness()
    const workflow = harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })

    const status = await harness.sync.track(harness.workspaceId)

    const log = await harness.git.log(harness.dir)
    expect(log).toHaveLength(1)
    expect(status).toEqual({
      workspaceId: harness.workspaceId,
      tracked: true,
      mode: "auto",
      remoteUrl: null,
      branch: "main",
      account: null,
      state: "idle",
      lastError: null,
      readOnly: false,
      incoming: 0,
      outgoing: 0,
      uncommitted: false,
      lastSyncedAt: null,
      lastCommit: { sha: log[0]!.sha, subject: log[0]!.subject, authorDate: log[0]!.authorDate },
    })
    const tree = readTree(harness.dir)
    expect([...tree.keys()].sort()).toEqual([
      ".apiweave/format.json",
      ".gitattributes",
      `workflows/login--${workflow.workflowId}.json`,
      "workspace.json",
    ])
    expect(parseWorkspace(tree).workspace.name).toBe("Acme QA")
    expect((await harness.git.status(harness.dir)).clean).toBe(true)

    await harness.sync.track(harness.workspaceId)
    expect(await harness.git.log(harness.dir)).toHaveLength(1)
  })

  it("untrack removes the clone and the row", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)

    const status = await harness.sync.untrack(harness.workspaceId)

    expect(status).toMatchObject({ tracked: false, lastCommit: null })
    expect(fs.existsSync(harness.dir)).toBe(false)
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)).toBeUndefined()
  })

  it("a track that fails undoes only what it created: no row, and no clone it made", async () => {
    const harness = openHarness({ wrap: failingCommits })

    await expect(harness.sync.track(harness.workspaceId)).rejects.toThrow("disk full")

    expect(harness.repositories.workspaceGit.get(harness.workspaceId)).toBeUndefined()
    expect(fs.existsSync(harness.dir)).toBe(false)
  })

  it("a track that fails leaves a clone that was already there as it was", async () => {
    const tracking = openHarness()
    await tracking.sync.track(tracking.workspaceId)
    const failing = new GitSyncService({ cloneRoot: tracking.cloneRoot, git: failingCommits(tracking.git), repositories: tracking.repositories })
    tracking.repositories.workspaceGit.delete(tracking.workspaceId)
    tracking.repositories.workflows.create({ workspaceId: tracking.workspaceId, name: "Login" })

    await expect(failing.track(tracking.workspaceId)).rejects.toThrow("disk full")

    expect(await subjects(tracking)).toEqual(["Start tracking this workspace in APIWeave"])
  })

  it("track adopts a clone a restored database no longer knows about, keeping its history", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await harness.sync.commitLocal(harness.workspaceId, { message: "Add login" })
    // What a database restored from backups/ looks like: it predates the row.
    harness.repositories.workspaceGit.delete(harness.workspaceId)
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Orders" })

    await harness.sync.reconcile()
    const status = await harness.sync.track(harness.workspaceId)

    expect(status.tracked).toBe(true)
    expect(await subjects(harness)).toEqual([
      "Start tracking this workspace in APIWeave",
      "Add login",
      "Start tracking this workspace in APIWeave",
    ])
  })

  it("in auto mode, commits once, 30 s after an edit", async () => {
    fakeTimers()
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)

    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await elapse(harness, AUTO_COMMIT_DELAY_MS - 1)
    expect(await subjects(harness)).toHaveLength(1)

    await elapse(harness, 1)
    expect(await subjects(harness)).toHaveLength(2)
    expect((await harness.git.status(harness.dir)).clean).toBe(true)
  })

  it("in auto mode, makes one commit for two edits inside the window", async () => {
    fakeTimers()
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)

    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await elapse(harness, 20_000)
    harness.repositories.environments.create({ workspaceId: harness.workspaceId, name: "Staging" })
    await elapse(harness, 20_000)
    // The second edit restarted the wait: 40 s after the first, 20 s after the second.
    expect(await subjects(harness)).toHaveLength(1)

    await elapse(harness, AUTO_COMMIT_DELAY_MS - 20_000)
    expect(await subjects(harness)).toEqual(["Update 2 files", "Start tracking this workspace in APIWeave"])
  })

  it("in manual mode, an edit schedules nothing", async () => {
    fakeTimers()
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    await harness.sync.setMode(harness.workspaceId, "manual")

    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await elapse(harness, AUTO_COMMIT_DELAY_MS * 2)
    expect(await subjects(harness)).toHaveLength(1)

    const status = await harness.sync.syncNow(harness.workspaceId, { message: "Add the login flow" })
    expect(status.lastCommit?.subject).toBe("Add the login flow")
  })

  it("an import of what the repository already holds makes no commit", async () => {
    fakeTimers()
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    // What a fast-forward leaves in the clone: a tree another device committed.
    const incoming = parseWorkspace(readTree(harness.dir))
    const changed = {
      ...incoming,
      workspace: { ...incoming.workspace, description: "Edited on another device" },
      workflows: [{
        workflowId: "wf-remote",
        projectId: null,
        name: "Remote flow",
        description: "",
        selectedEnvironmentId: null,
        tags: [],
        variables: {},
        nodes: [],
        edges: [],
        nodeTemplates: [],
      }],
    }
    await writeWorkspaceTree(harness.dir, serializeWorkspace(changed))
    await harness.git.add(harness.dir, ["."])
    await harness.git.commit(harness.dir, "Edit on another device")
    const { workspaces, collections, workflows, environments } = harness.repositories

    new WorkspaceRepoImporter(workspaces, collections, workflows, environments).apply(harness.workspaceId, changed)

    expect(workflows.getById("wf-remote")?.name).toBe("Remote flow")
    await elapse(harness, AUTO_COMMIT_DELAY_MS)
    expect(await subjects(harness)).toHaveLength(2)
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)).toMatchObject({ state: "idle", lastError: null })

    // The trigger itself is live: a local edit after the import does commit.
    workspaces.update(harness.workspaceId, { name: "Acme" })
    await elapse(harness, AUTO_COMMIT_DELAY_MS)
    expect(await subjects(harness)).toEqual(["Update workspace.json", "Edit on another device", "Start tracking this workspace in APIWeave"])
  })

  it("serializes commits per workspace: an overlapping call waits for the one before it", async () => {
    const events: string[] = []
    let duringFirstAdd: (() => void) | undefined
    const harness = openHarness({ wrap: (git) => ({
      ...passthrough(git),
      add: async (dir, paths) => {
        events.push("add:start")
        const edit = duringFirstAdd
        duringFirstAdd = undefined
        edit?.()
        await new Promise((resolve) => setTimeout(resolve, 50))
        await git.add(dir, paths)
        events.push("add:end")
      },
      commit: async (dir, message) => {
        events.push("commit:start")
        const sha = await git.commit(dir, message)
        events.push("commit:end")
        return sha
      },
    }) })
    await harness.sync.track(harness.workspaceId)
    await harness.sync.setMode(harness.workspaceId, "manual")
    events.length = 0
    const { workflows } = harness.repositories
    workflows.create({ workspaceId: harness.workspaceId, name: "First" })
    // Made after the first call has read the database, so only the second can commit it.
    duringFirstAdd = () => workflows.create({ workspaceId: harness.workspaceId, name: "Second" })

    const [first, second] = await Promise.all([
      harness.sync.commitLocal(harness.workspaceId, { message: "first" }),
      harness.sync.commitLocal(harness.workspaceId, { message: "second" }),
    ])

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(events).toEqual(["add:start", "add:end", "commit:start", "commit:end", "add:start", "add:end", "commit:start", "commit:end"])
    expect(await subjects(harness)).toEqual(["second", "first", "Start tracking this workspace in APIWeave"])
  })

  it("a clean tree is not an empty commit", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)

    expect(await harness.sync.commitLocal(harness.workspaceId, { message: "nothing" })).toBeUndefined()
    expect(await subjects(harness)).toHaveLength(1)
  })

  it("startup reconcile recreates a deleted clone from the database", async () => {
    const harness = openHarness()
    const workflow = harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await harness.sync.track(harness.workspaceId)
    await harness.sync.setMode(harness.workspaceId, "manual")
    fs.rmSync(harness.dir, { recursive: true, force: true })

    await harness.sync.reconcile()

    expect(await subjects(harness)).toEqual(["Recreate this workspace's repository from APIWeave"])
    expect(parseWorkspace(readTree(harness.dir)).workflows.map((file) => file.workflowId)).toEqual([workflow.workflowId])
  })

  it("startup reconcile leaves a clone no row claims exactly as it is", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await harness.sync.commitLocal(harness.workspaceId, { message: "Add login" })
    // Restoring a database from backups/ drops the row; the clone holds the only copy of this history.
    harness.repositories.workspaceGit.delete(harness.workspaceId)
    const unknown = path.join(harness.cloneRoot, "not-a-workspace-here")
    fs.mkdirSync(unknown)
    fs.writeFileSync(path.join(unknown, "notes.txt"), "keep me")

    await harness.sync.reconcile()

    expect(await subjects(harness)).toEqual(["Add login", "Start tracking this workspace in APIWeave"])
    expect(fs.readFileSync(path.join(unknown, "notes.txt"), "utf8")).toBe("keep me")
  })

  it("startup reconcile clears a lock a crash left, so the next commit goes through", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    await harness.sync.setMode(harness.workspaceId, "manual")
    const lock = path.join(harness.dir, ".git", "index.lock")
    fs.writeFileSync(lock, "")
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await expect(harness.sync.commitLocal(harness.workspaceId)).rejects.toThrow(/index\.lock/)

    await harness.sync.reconcile()

    expect(fs.existsSync(lock)).toBe(false)
    expect(await harness.sync.commitLocal(harness.workspaceId, { message: "Add login" })).toBeDefined()
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)?.lastError).toBeNull()
  })

  it("with no author configured, track fails typed, and a commit naming one completes it", async () => {
    const harness = openHarness({ anonymous: true })

    const failure = await harness.sync.track(harness.workspaceId).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(GitIdentityMissingError)
    const asking = await harness.sync.status(harness.workspaceId)
    expect(asking).toMatchObject({ tracked: true, state: "error", lastCommit: null })
    expect(asking.lastError?.code).toBe("identity_missing")

    const status = await harness.sync.syncNow(harness.workspaceId, { identity: { name: "Ada Lovelace", email: "ada@example.invalid" } })

    expect(status).toMatchObject({ state: "idle", lastError: null })
    const [commit] = await harness.git.log(harness.dir)
    expect(commit).toMatchObject({ authorName: "Ada Lovelace", authorEmail: "ada@example.invalid" })
    // Written to this clone only: the next commit needs no identity passed.
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    expect(await harness.sync.commitLocal(harness.workspaceId)).toBeDefined()
  })

  it("a commit with no author resolves to a status that says identity_missing, not to text to parse", async () => {
    const harness = openHarness({ anonymous: true })
    await harness.sync.track(harness.workspaceId).catch(() => undefined)

    const status = await harness.sync.syncNow(harness.workspaceId)

    expect(status.lastError?.code).toBe("identity_missing")
    expect(status.lastCommit).toBeNull()
  })

  it("startup reconcile commits what auto mode had pending when the app quit", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    await harness.sync.dispose()
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })

    const restarted = new GitSyncService({ cloneRoot: harness.cloneRoot, git: harness.git, repositories: harness.repositories })
    await restarted.reconcile()

    expect(await subjects(harness)).toHaveLength(2)
  })

  it("deleting a tracked workspace deletes its clone", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)

    harness.repositories.workspaces.delete(harness.workspaceId)
    await harness.sync.settled()

    expect(fs.existsSync(harness.dir)).toBe(false)
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)).toBeUndefined()
  })

  it("with no remote, syncNow commits and never fetches or pushes", async () => {
    let fetches = 0
    let pushes = 0
    const harness = openHarness({
      wrap: (git) => ({
        ...passthrough(git),
        fetch: async (dir, remote) => {
          fetches += 1
          return git.fetch(dir, remote)
        },
        push: async (dir, remote, branch, options) => {
          pushes += 1
          return git.push(dir, remote, branch, options)
        },
      }),
    })
    await harness.sync.track(harness.workspaceId)
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })

    const status = await harness.sync.syncNow(harness.workspaceId)

    expect(status).toMatchObject({ state: "idle", remoteUrl: null, incoming: 0, outgoing: 0 })
    expect(fetches).toBe(0)
    expect(pushes).toBe(0)
    expect(await subjects(harness)).toHaveLength(2)
  })

  it("startup reconcile clears a stale syncing row without committing in manual mode", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    await harness.sync.setMode(harness.workspaceId, "manual")
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Pending" })
    harness.repositories.workspaceGit.setState(harness.workspaceId, "syncing", { code: null, message: "a cycle was running" })

    await harness.sync.reconcile()

    expect(harness.repositories.workspaceGit.get(harness.workspaceId)).toMatchObject({ state: "idle", lastError: null })
    expect(await subjects(harness)).toEqual(["Start tracking this workspace in APIWeave"])
  })

  it("start runs a pass and then polls at the sync interval", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    const interval = vi.spyOn(globalThis, "setInterval")

    try {
      await harness.sync.start()
      expect(interval).toHaveBeenCalledWith(expect.any(Function), SYNC_INTERVAL_MS)
    } finally {
      interval.mockRestore()
    }
  })

  it("a dispose during the running pass leaves no interval behind", async () => {
    const harness = openHarness({ wrap: heldFetch })
    await harness.sync.track(harness.workspaceId)
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    const interval = vi.spyOn(globalThis, "setInterval")

    try {
      const started = new Promise<void>((resolve) => {
        hold.entered = resolve
      })
      hold.on = true
      const starting = harness.sync.start()
      await started

      // The app quits while the pass is still running: no timer may survive it.
      const disposing = harness.sync.dispose()
      hold.release?.()
      await starting
      await disposing

      expect(interval).not.toHaveBeenCalledWith(expect.any(Function), SYNC_INTERVAL_MS)
    } finally {
      interval.mockRestore()
    }
  })

  it("dispose clears the auto commit that was waiting", async () => {
    fakeTimers()
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)

    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await harness.sync.dispose()
    await elapse(harness, AUTO_COMMIT_DELAY_MS * 2)

    expect(await subjects(harness)).toHaveLength(1)
  })

  it("dispose gives up on a cycle that will not settle instead of holding the app open", async () => {
    const harness = openHarness({ disposeWaitMs: 50, wrap: heldFetch })
    await harness.sync.track(harness.workspaceId)
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)

    const started = new Promise<void>((resolve) => {
      hold.entered = resolve
    })
    let settled = false
    hold.on = true
    const cycle = harness.sync.syncNow(harness.workspaceId).then((status) => {
      settled = true
      return status
    })
    await started

    await harness.sync.dispose()
    // The cycle is still blocked on the network; dispose returned anyway.
    expect(settled).toBe(false)

    hold.release?.()
    await cycle
    expect(settled).toBe(true)
  })

  it("counts every local commit as outgoing when the clone has no remote-tracking branch", async () => {
    const harness = openHarness()
    await harness.sync.track(harness.workspaceId)
    const remote = makeBareRemote(harness.sandbox)
    await harness.sync.connectRemote(harness.workspaceId, remote.url)
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })
    await harness.sync.commitLocal(harness.workspaceId, { message: "Add login" })
    // The remote's branch is not in this clone: a fetch that never ran, or a branch that went away.
    rawGit(harness.dir, harness.sandbox.env, "update-ref", "-d", "refs/remotes/origin/main")

    const status = await harness.sync.status(harness.workspaceId)

    expect(status).toMatchObject({ incoming: 0, outgoing: 2 })
    expect(await harness.git.log(harness.dir)).toHaveLength(2)
  })

  it("reports 0/0 for a connected workspace with no commit, without asking git to count", async () => {
    let counts = 0
    const harness = openHarness({
      wrap: (git) => ({
        ...passthrough(git),
        countCommits: async (dir, rev) => {
          counts += 1
          return git.countCommits(dir, rev)
        },
      }),
    })
    harness.repositories.workspaceGit.insert(harness.workspaceId, "auto")
    harness.repositories.workspaceGit.setRemote(harness.workspaceId, "file:///nowhere.git", "main", null)
    await harness.git.init(harness.dir, { initialBranch: "main" })

    const status = await harness.sync.status(harness.workspaceId)

    expect(status).toMatchObject({ tracked: true, incoming: 0, outgoing: 0, lastCommit: null })
    expect(counts).toBe(0)
  })

  it("lists every tracked workspace's status for the switcher, and no untracked one", async () => {
    const harness = openHarness()
    const second = harness.repositories.workspaces.create({ name: "Second", slug: "second" }).workspaceId
    harness.repositories.workspaces.create({ name: "Untracked", slug: "untracked" })
    await harness.sync.track(harness.workspaceId)
    await harness.sync.track(second)

    const statuses = await harness.sync.statusAll()

    expect(statuses.map((status) => status.workspaceId).sort()).toEqual([harness.workspaceId, second].sort())
    expect(statuses.every((status) => status.tracked)).toBe(true)
  })

  it("asks for one workspace's status at a time, not all of them at once", async () => {
    let reading = 0
    let peak = 0
    const harness = openHarness({
      wrap: (git) => ({
        ...passthrough(git),
        log: async (dir: string) => {
          reading += 1
          peak = Math.max(peak, reading)
          try {
            return await git.log(dir)
          } finally {
            reading -= 1
          }
        },
      }),
    })
    const second = harness.repositories.workspaces.create({ name: "Second", slug: "second" }).workspaceId
    await harness.sync.track(harness.workspaceId)
    await harness.sync.track(second)

    expect(await harness.sync.statusAll()).toHaveLength(2)

    // A status runs git; a list of statuses must not start one per workspace at once.
    expect(peak).toBe(1)
  })

  it("leaves out a workspace that is untracked while the list is being read", async () => {
    const harness = openHarness()
    const second = harness.repositories.workspaces.create({ name: "Second", slug: "second" }).workspaceId
    await harness.sync.track(harness.workspaceId)
    await harness.sync.track(second)
    const [first, other] = harness.repositories.workspaceGit.listAll()
    if (first === undefined || other === undefined) throw new Error("harness did not track both workspaces")

    const get = harness.repositories.workspaceGit.get.bind(harness.repositories.workspaceGit)
    let reads = 0
    vi.spyOn(harness.repositories.workspaceGit, "get").mockImplementation((workspaceId) => {
      // The first read belongs to the first workspace, which is still tracked; by the
      // time the list reaches the other one, it has been untracked.
      if (++reads === 1) harness.repositories.workspaceGit.delete(other.workspaceId)
      return get(workspaceId)
    })

    const statuses = await harness.sync.statusAll()

    expect(statuses.map((status) => status.workspaceId)).toEqual([first.workspaceId])
    expect(statuses.every((status) => status.tracked)).toBe(true)
  })

  it("syncNow rejects only a request it cannot run: an id that is not a workspace, or one that is not tracked", async () => {
    const harness = openHarness()

    await expect(harness.sync.syncNow("../escape")).rejects.toThrow("is not a workspace id")
    await expect(harness.sync.syncNow(harness.workspaceId)).rejects.toThrow("track it first")
  })

  it("syncNow rejects a failure that is not git's, and still records it; the auto commit's timer only logs it", async () => {
    fakeTimers()
    let failCommits = false
    const harness = openHarness({
      wrap: (git) => ({
        ...passthrough(git),
        // Not a GitError: what a bug in the cycle itself looks like.
        commit: (dir, message) => (failCommits ? Promise.reject(new TypeError("a bug")) : git.commit(dir, message)),
      }),
    })
    await harness.sync.track(harness.workspaceId)
    failCommits = true
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Login" })

    await expect(harness.sync.syncNow(harness.workspaceId)).rejects.toThrow("a bug")
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)).toMatchObject({ state: "error", lastError: { code: null, message: "a bug" } })

    // Out of a timer there is no caller to reject to: an unhandled rejection would fail this test.
    harness.repositories.workflows.create({ workspaceId: harness.workspaceId, name: "Orders" })
    await elapse(harness, AUTO_COMMIT_DELAY_MS)
    expect(harness.repositories.workspaceGit.get(harness.workspaceId)).toMatchObject({ state: "error", lastError: { message: "a bug" } })
    expect(await subjects(harness)).toHaveLength(1)
  })

  it("refuses an id that could name a path, and a mode change for an untracked workspace", async () => {
    const harness = openHarness()

    await expect(harness.sync.track("../escape")).rejects.toThrow("is not a workspace id")
    await expect(harness.sync.setMode(harness.workspaceId, "manual")).rejects.toThrow("track it first")
  })
})
