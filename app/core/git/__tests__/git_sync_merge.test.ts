import { describe, expect, it } from "vitest"
import { dirOf, headOf, remoteHead, binding, snapshotOf, workflowFileOf, cloneText, headCommitOf, sharedPair, renameConflict } from "./git_sync_devices"

describe("the sync cycle", () => {
  describe("a merge that needs the user", () => {
    it("stops a same-field conflict as merging, leaving both copies untouched until it is resolved", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      const { aHead, bHead } = await renameConflict(pair)

      // Waiting for a decision is not a failure: no error rides with it.
      expect(binding(b, opened)).toMatchObject({ state: "merging", integratingFrom: null, lastError: null })
      const merge = b.repositories.workspaceGit.getMerge(opened)
      expect(merge).toMatchObject({ ourCommit: bHead, theirCommit: aHead })
      expect(merge?.picks).toEqual([])

      const conflicts = (await b.sync.mergeState(opened)).conflicts
      expect(conflicts).toEqual([
        { kind: "workflow", recordId: sharedId, path: "name", name: "On B", base: "Shared", ours: "On B", theirs: "On A" },
      ])
      // Deterministic: the same trees and picks always give the same list.
      expect((await b.sync.mergeState(opened)).conflicts).toEqual(conflicts)

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
      expect((await b.sync.mergeState(opened)).conflicts).toEqual(conflicts)
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

    it("reads back the decisions stored for the waiting merge, and none when it is not merging", async () => {
      const pair = await sharedPair()
      const { a, b, workspaceId, opened, sharedId } = pair
      await renameConflict(pair)
      const merge = b.repositories.workspaceGit.getMerge(opened)
      if (merge === undefined) throw new Error("the merge did not start")
      const stored = [
        { recordId: sharedId, path: "", side: "ours" as const },
        { recordId: sharedId, path: "name", side: "theirs" as const },
      ]
      b.repositories.workspaceGit.setMergePicks(opened, merge.baseCommit, stored)

      // The set a reopened picker seeds from, in the merge's own order.
      expect((await b.sync.mergeState(opened)).picks).toEqual(stored)
      // The other device is on the same remote, but it is not the one merging.
      expect((await a.sync.mergeState(workspaceId)).picks).toEqual([])
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
      // The message the resolve names is the merge commit's.
      expect(head.subject).toBe("Finish the merge")
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
      expect(((await b.sync.mergeState(opened)).conflicts).map((conflict) => conflict.path)).toEqual(["description", "name"])

      const partial = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])

      expect(partial).toMatchObject({ state: "merging" })
      // The list is every conflict the merge has, whatever the picks settle.
      expect(((await b.sync.mergeState(opened)).conflicts).map((conflict) => conflict.path)).toEqual(["description", "name"])
      expect((await b.sync.mergeState(opened)).picks).toEqual([{ recordId: sharedId, path: "name", side: "theirs" }])
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
  })
})
