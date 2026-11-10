import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { dirOf, headOf, remoteHead, workflowFileOf, headCommitOf, sharedPair } from "./git_sync_devices"

describe("the sync cycle", () => {
  describe("a merge that needs the user", () => {
    it.each(["ours", "theirs"] as const)("settles a delete against a change by taking %s", async (side) => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      a.repositories.workflows.delete(sharedId)
      await a.sync.syncNow(workspaceId, { message: "Delete on A" })
      const aHead = headOf(a, workspaceId)
      b.repositories.workflows.update(sharedId, { name: "Changed on B" })
      expect(await b.sync.syncNow(opened, { message: "Change on B" })).toMatchObject({ state: "merging" })
      const conflicts = (await b.sync.mergeState(opened)).conflicts
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
      const conflicts = (await b.sync.mergeState(opened)).conflicts
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
  })
})
