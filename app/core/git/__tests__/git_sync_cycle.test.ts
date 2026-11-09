import { describe, expect, it } from "vitest"
import { SYNC_INTERVAL_MS } from "../git_sync_service"
import { passthrough } from "./git_sync_harness"
import { makeBareRemote, makeSandbox, rawGit, type GitSandbox } from "./git_test_utils"
import { type Device, openDevice, dirOf, subjectsOf, headOf, remoteHead, binding, snapshotOf, fakeTimers, elapse, publish, openFromRemote, pushFromElsewhere, NOT_A_WORKSPACE, resetRefused } from "./git_sync_devices"

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
})
