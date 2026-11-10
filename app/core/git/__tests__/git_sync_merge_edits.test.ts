import fs from "node:fs"
import { describe, expect, it } from "vitest"
import { passthrough } from "./git_sync_harness"
import { makeBareRemote, makeSandbox, type GitSandbox } from "./git_test_utils"
import { type Device, openDevice, dirOf, subjectsOf, headOf, remoteHead, binding, headCommitOf, type SharedPair, sharedPair, renameConflict, fakeTimers, elapse, publish, openFromRemote, nonFastForward } from "./git_sync_devices"

describe("the sync cycle", () => {
  describe("a merge that needs the user", () => {
    describe("an edit that lands while the merge commit is being made", () => {
      /** A device whose merge commits each run `during` right after git makes them: an edit there lands before the import. */
      function editingDuringMergeCommits(sandbox: GitSandbox, name: string): { device: Device; during: { run: (() => void) | undefined } } {
        const during: { run: (() => void) | undefined } = { run: undefined }
        const device = openDevice(sandbox, name, (git) => ({
          ...passthrough(git),
          commit: async (dir, message, options) => {
            const sha = await git.commit(dir, message, options)
            if (message.startsWith("Merge the remote's changes")) during.run?.()
            return sha
          },
        }))
        return { device, during }
      }

      async function pairEditingOnB(): Promise<SharedPair & { readonly during: { run: (() => void) | undefined } }> {
        const sandbox = makeSandbox()
        const a = openDevice(sandbox, "a")
        const remote = makeBareRemote(sandbox, "shared.git")
        const workspaceId = await publish(a, sandbox, remote)
        const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
        await a.sync.syncNow(workspaceId, { message: "Add shared" })
        const { device: b, during } = editingDuringMergeCommits(sandbox, "b")
        const opened = await openFromRemote(b, remote.url)
        return { sandbox, a, remote, workspaceId, b, opened, sharedId: shared.workflowId, during }
      }

      it("drops the merge commit, commits the edit as ours, and redoes the merge on top of it", async () => {
        const pair = await pairEditingOnB()
        const { b, sandbox, remote, opened, sharedId, during } = pair
        const { aHead, bHead } = await renameConflict(pair)
        let made: string | undefined
        during.run = () => {
          during.run = undefined
          made = b.repositories.workflows.create({ workspaceId: opened, name: "Typed during the commit" }).workflowId
        }

        const resolved = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])

        expect(resolved).toMatchObject({ state: "idle", lastError: null, uncommitted: false })
        const [head, edit] = await b.git.log(dirOf(b, opened), { maxCount: 2 })
        expect(head?.parents).toEqual([edit?.sha, aHead])
        expect(edit?.parents).toEqual([bHead])
        expect(edit?.subject).toMatch(/^Update workflows\/typed-during-the-commit--/)
        expect(b.repositories.workflows.getById(made!)?.name).toBe("Typed during the commit")
        expect(b.repositories.workflows.getById(sharedId)?.name).toBe("On A")
        expect(remoteHead(sandbox, remote.dir)).toBe(head?.sha)
      })

      it("gives up after MAX_MERGE_ATTEMPTS edits, keeping the merge, the picks and every edit, and the next resolve finishes it", async () => {
        const pair = await pairEditingOnB()
        const { b, sandbox, remote, opened, sharedId, during } = pair
        const { aHead } = await renameConflict(pair)
        const made: string[] = []
        during.run = () => {
          made.push(b.repositories.workflows.create({ workspaceId: opened, name: `Typed ${made.length + 1}` }).workflowId)
        }
        const picks = [{ recordId: sharedId, path: "name", side: "theirs" as const }]

        const stopped = await b.sync.resolveMerge(opened, picks)

        // Three attempts, each met by an edit: the merge waits, and says why.
        expect(made).toHaveLength(3)
        expect(stopped).toMatchObject({ state: "merging", uncommitted: true })
        expect(stopped.lastError?.message).toMatch(/changed again while the merge was being committed/)
        expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toEqual(picks)
        expect(binding(b, opened).integratingFrom).toBeNull()
        // The clone is on this device's own latest commit, not a merge, with nothing left over in the checkout.
        expect((await headCommitOf(b, opened)).parents).toHaveLength(1)
        expect(await b.git.status(dirOf(b, opened))).toMatchObject({ clean: true })
        expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
        for (const id of made) expect(b.repositories.workflows.getById(id)).toBeDefined()

        during.run = undefined
        const finished = await b.sync.resolveMerge(opened, picks)

        expect(finished).toMatchObject({ state: "idle", lastError: null, uncommitted: false })
        expect((await headCommitOf(b, opened)).parents).toContain(aHead)
        expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, opened))
        for (const id of made) expect(b.repositories.workflows.getById(id)).toBeDefined()
      })
    })

    it("starts a fresh merge with no picks when the remote moved again while the merge waited", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      const { aHead } = await renameConflict(pair)
      a.repositories.workflows.update(sharedId, { name: "On A again" })
      await a.sync.syncNow(workspaceId, { message: "Rename on A again" })
      const aAgain = headOf(a, workspaceId)

      // Keeping our name commits the merge against the remote it knew; its push finds the remote moved, and the
      // next merge conflicts on the same field again — a new merge, with none of the old picks.
      const resolved = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "ours" }])

      expect(resolved).toMatchObject({ state: "merging", lastError: null })
      const first = await headCommitOf(b, opened)
      expect(first.parents).toContain(aHead)
      expect(b.repositories.workspaceGit.getMerge(opened)).toEqual({
        workspaceId: opened,
        baseCommit: aHead,
        ourCommit: first.sha,
        theirCommit: aAgain,
        picks: [],
      })
      expect((await b.sync.mergeState(opened)).conflicts).toEqual([
        { kind: "workflow", recordId: sharedId, path: "name", name: "On B", base: "On A", ours: "On B", theirs: "On A again" },
      ])
      expect(remoteHead(sandbox, remote.dir)).toBe(aAgain)
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe("On B")
    })

    it("ends a resolve whose push the remote rejects twice as a retryable error, with the merge committed and imported", async () => {
      let rejecting = false
      let rejected = 0
      const sandbox = makeSandbox()
      const a = openDevice(sandbox, "a")
      const remote = makeBareRemote(sandbox, "shared.git")
      const workspaceId = await publish(a, sandbox, remote)
      const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
      await a.sync.syncNow(workspaceId, { message: "Add shared" })
      const b = openDevice(sandbox, "b", (git) => ({
        ...passthrough(git),
        push: async (dir, remoteName, branch, options) => {
          if (!rejecting) return git.push(dir, remoteName, branch, options)
          rejected += 1
          throw nonFastForward()
        },
      }))
      const opened = await openFromRemote(b, remote.url)
      const { aHead } = await renameConflict({ sandbox, a, remote, workspaceId, b, opened, sharedId: shared.workflowId })
      rejecting = true

      const resolved = await b.sync.resolveMerge(opened, [{ recordId: shared.workflowId, path: "name", side: "theirs" }])

      expect(rejected).toBe(2)
      expect(resolved).toMatchObject({ state: "error", lastError: { code: "non_fast_forward" }, outgoing: 2 })
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      const head = await headCommitOf(b, opened)
      expect(head.parents).toContain(aHead)
      expect(b.repositories.workflows.getById(shared.workflowId)?.name).toBe("On A")
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)

      rejecting = false
      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "idle", lastError: null, outgoing: 0 })
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
    })

    it("discards a waiting merge with the local changes: the remote's tree, no merge, no picks", async () => {
      const pair = await sharedPair()
      const { b, sandbox, remote, opened, sharedId } = pair
      const { aHead } = await renameConflict(pair)
      expect(await b.sync.resolveMerge(opened, [])).toMatchObject({ state: "merging" })
      b.repositories.workspaceGit.setMergePicks(opened, b.repositories.workspaceGit.getMerge(opened)!.baseCommit, [
        { recordId: sharedId, path: "name", side: "ours" },
      ])
      const edit = b.repositories.workflows.create({ workspaceId: opened, name: "Edit while merging" })

      const discarded = await b.sync.discardLocalChanges(opened)

      expect(discarded).toMatchObject({ state: "idle", lastError: null, uncommitted: false, incoming: 0, outgoing: 0 })
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      expect(b.db.kvStore.query("SELECT * FROM workspace_merge_pick")).toEqual([])
      expect(headOf(b, opened)).toBe(aHead)
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe("On A")
      expect(b.repositories.workflows.getById(edit.workflowId)).toBeUndefined()
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
    })

    it("drops a waiting merge with its remote on disconnect, keeping every commit and edit, and auto mode commits the edits", async () => {
      fakeTimers()
      const pair = await sharedPair()
      const { b, opened, sharedId } = pair
      const { bHead } = await renameConflict(pair)
      b.repositories.workspaceGit.setMergePicks(opened, b.repositories.workspaceGit.getMerge(opened)!.baseCommit, [
        { recordId: sharedId, path: "name", side: "theirs" },
      ])
      const edit = b.repositories.workflows.create({ workspaceId: opened, name: "Edit while merging" })

      const disconnected = await b.sync.disconnectRemote(opened)

      expect(disconnected).toMatchObject({ state: "idle", lastError: null, remoteUrl: null, uncommitted: true })
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      expect(b.db.kvStore.query("SELECT * FROM workspace_merge_pick")).toEqual([])
      expect(headOf(b, opened)).toBe(bHead)
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe("On B")

      await elapse(b, 30_000)

      expect(await b.sync.status(opened)).toMatchObject({ state: "idle", uncommitted: false })
      expect((await headCommitOf(b, opened)).parents).toEqual([bHead])
      expect(b.repositories.workflows.getById(edit.workflowId)?.name).toBe("Edit while merging")
    })

    it("shows a resolve's push as syncing, and commits an edit made during it on the auto timer", async () => {
      fakeTimers()
      let hold: (() => void) | undefined
      let holding = false
      let pushing: (() => void) | undefined
      const pushStarted = new Promise<void>((resolve) => {
        pushing = resolve
      })
      const sandbox = makeSandbox()
      const a = openDevice(sandbox, "a")
      const remote = makeBareRemote(sandbox, "shared.git")
      const workspaceId = await publish(a, sandbox, remote)
      const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
      await a.sync.syncNow(workspaceId, { message: "Add shared" })
      const b = openDevice(sandbox, "b", (git) => ({
        ...passthrough(git),
        push: async (dir, remoteName, branch, options) => {
          if (holding) {
            holding = false
            await new Promise<void>((resolve) => {
              hold = resolve
              pushing?.()
            })
          }
          return git.push(dir, remoteName, branch, options)
        },
      }))
      const opened = await openFromRemote(b, remote.url)
      await renameConflict({ sandbox, a, remote, workspaceId, b, opened, sharedId: shared.workflowId })
      holding = true

      const resolving = b.sync.resolveMerge(opened, [{ recordId: shared.workflowId, path: "name", side: "theirs" }])
      await pushStarted
      // The merge is committed and imported: what is left is a cycle's push, and the header says so.
      expect(binding(b, opened).state).toBe("syncing")
      const edit = b.repositories.workflows.create({ workspaceId: opened, name: "Typed during the push" })
      hold?.()
      const resolved = await resolving
      const merged = headOf(b, opened)

      expect(resolved).toMatchObject({ state: "idle", uncommitted: true })
      expect(remoteHead(sandbox, remote.dir)).toBe(merged)

      await elapse(b, 30_000)

      expect(await b.sync.status(opened)).toMatchObject({ state: "idle", uncommitted: false, outgoing: 0 })
      const head = await headCommitOf(b, opened)
      expect(head.parents).toEqual([merged])
      expect(head.subject).toMatch(/^Update workflows\/typed-during-the-push--/)
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
      expect(b.repositories.workflows.getById(edit.workflowId)?.name).toBe("Typed during the push")
    })

    it("keeps committing locally while diverged in auto mode, the edits made during the merge first, and pushes nothing", async () => {
      fakeTimers()
      const pair = await sharedPair()
      const { b, sandbox, remote, opened } = pair
      const { aHead } = await renameConflict(pair)
      const during = b.repositories.workflows.create({ workspaceId: opened, name: "Edit while merging" })
      const head = headOf(b, opened)

      expect(await b.sync.abandonMerge(opened)).toMatchObject({ state: "diverged", uncommitted: true })
      await elapse(b, 30_000)

      expect(await b.sync.status(opened)).toMatchObject({ state: "diverged", uncommitted: false })
      expect((await headCommitOf(b, opened)).parents).toEqual([head])
      expect((await subjectsOf(b, opened))[0]).toMatch(/^Update workflows\/edit-while-merging--/)

      const after = b.repositories.workflows.create({ workspaceId: opened, name: "Edit after abandoning" })
      await elapse(b, 30_000)

      const status = await b.sync.status(opened)
      expect(status).toMatchObject({ state: "diverged", uncommitted: false })
      expect(status.lastError?.message).toMatch(/merge was abandoned/)
      expect((await subjectsOf(b, opened))[0]).toMatch(/^Update workflows\/edit-after-abandoning--/)
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      expect(b.repositories.workflows.getById(during.workflowId)).toBeDefined()
      expect(b.repositories.workflows.getById(after.workflowId)).toBeDefined()
    })

    it("recreates a deleted history and merges it two ways with the remote's copy of the same workspace", async () => {
      const pair = await sharedPair()
      const { b, sandbox, remote, opened, sharedId } = pair
      const { aHead } = await renameConflict(pair)
      await b.restart()
      fs.rmSync(dirOf(b, opened), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

      await b.sync.reconcile()

      expect(binding(b, opened)).toMatchObject({ state: "idle", lastError: null })
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      expect(await subjectsOf(b, opened)).toEqual(["Recreate this workspace's repository from APIWeave"])

      // The recreated history shares no commit with the remote's, but it is the
      // same workspace, so the two merge with no ancestor rather than stopping.
      const synced = await b.sync.syncNow(opened)
      expect(synced).toMatchObject({ state: "merging", lastError: null, unrelatedHistory: true })
      expect(b.repositories.workspaceGit.getMerge(opened)).toMatchObject({ baseCommit: null, theirCommit: aHead })
      expect((await b.sync.mergeState(opened)).conflicts).toEqual([
        { kind: "workflow", recordId: sharedId, name: "On B", path: "name", ours: "On B", theirs: "On A" },
      ])
      // Nothing was pushed or imported while it waits.
      expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe("On B")

      const resolved = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])
      expect(resolved).toMatchObject({ state: "idle", lastError: null, unrelatedHistory: false })
      expect(b.repositories.workflows.getById(sharedId)?.name).toBe("On A")
      const head = await headCommitOf(b, opened)
      expect(head.parents).toHaveLength(2)
      expect(head.parents).toContain(aHead)
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
    })
  })
})
