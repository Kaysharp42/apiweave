import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { SYNC_INTERVAL_MS } from "../git_sync_service"
import { passthrough } from "./git_sync_harness"
import { makeBareRemote, makeSandbox, rawGit } from "./git_test_utils"
import { openDevice, dirOf, subjectsOf, headOf, remoteHead, binding, snapshotOf, fakeTimers, deferredFetch, publish, openFromRemote, pushFromElsewhere, NOT_A_WORKSPACE, REMOTE_WORKFLOW_ID, REMOTE_WORKFLOW_FILE, remoteWorkflowFile } from "./git_sync_devices"

describe("the sync cycle", () => {
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
})
