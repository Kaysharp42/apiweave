import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SYNC_INTERVAL_MS } from "../git_sync_service"
import { makeBareRemote, makeSandbox } from "./git_test_utils"
import { openDevice, dirOf, subjectsOf, headOf, remoteHead, binding, headCommitOf, sharedPair, renameConflict, fakeTimers, elapse, publish, openFromRemote } from "./git_sync_devices"

describe("the sync cycle", () => {
  describe("a merge that needs the user", () => {
    // fallow-ignore-next-line complexity -- the branches are optional-chaining reads in this scenario's assertions, not control flow to refactor.
    it("preserves an edit made while the merge waits: commits it, redoes the merge on top, and pushes both", async () => {
      const pair = await sharedPair()
      const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
      const { aHead, bHead } = await renameConflict(pair)
      const made = b.repositories.workflows.create({ workspaceId: opened, name: "Made while merging" })

      expect(await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }], { message: "Resolve while editing" }))
        .toMatchObject({ state: "idle" })

      const [head, edit] = await b.git.log(dirOf(b, opened), { maxCount: 2 })
      // The resolve's message names the merge; the edits' commit says what it changed.
      expect(head?.subject).toBe("Resolve while editing")
      expect(edit?.subject).toMatch(/^Update workflows\/made-while-merging--/)
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
      expect(((await b.sync.mergeState(opened)).conflicts).map((conflict) => conflict.path)).toEqual(["description", "name"])
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
      expect((await b.sync.mergeState(opened)).conflicts).toHaveLength(1)
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
      expect(((await b.sync.mergeState(opened)).conflicts).map((conflict) => conflict.path)).toEqual(["description", "name"])
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
      expect((await b.sync.mergeState(opened)).conflicts).toHaveLength(1)
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
})
