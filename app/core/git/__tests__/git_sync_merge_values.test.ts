import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { JsonValue } from "@shared/types/JsonValue"
import { dirOf, headOf, remoteHead, workflowFileOf, cloneText, headCommitOf, sharedPair, renameConflict, pushFromElsewhere } from "./git_sync_devices"

describe("the sync cycle", () => {
  describe("a merge that needs the user", () => {
    describe("a value of the user's own", () => {
      it("resolves with a copy pick for one conflict and a value of the user's own for another", async () => {
        const pair = await sharedPair()
        const { a, b, sandbox, remote, workspaceId, opened, sharedId } = pair
        a.repositories.workflows.update(sharedId, { name: "On A", description: "From A" })
        await a.sync.syncNow(workspaceId, { message: "Change two on A" })
        const aHead = headOf(a, workspaceId)
        b.repositories.workflows.update(sharedId, { name: "On B", description: "From B" })
        expect(await b.sync.syncNow(opened, { message: "Change two on B" })).toMatchObject({ state: "merging" })
        const bHead = headOf(b, opened)
        expect(((await b.sync.mergeState(opened)).conflicts).map((conflict) => conflict.path)).toEqual(["description", "name"])

        const resolved = await b.sync.resolveMerge(opened, [
          { recordId: sharedId, path: "description", value: "Written by hand" },
          { recordId: sharedId, path: "name", side: "theirs" },
        ])

        expect(resolved).toMatchObject({ state: "idle", lastError: null })
        expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
        expect(b.repositories.workflows.getById(sharedId)).toMatchObject({ name: "On A", description: "Written by hand" })
        const head = await headCommitOf(b, opened)
        expect(head.parents).toEqual([bHead, aHead])
        expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
        expect(cloneText(b, opened, workflowFileOf(b, opened, sharedId))).toMatch(/"description": "Written by hand"/)
        expect(cloneText(b, opened, workflowFileOf(b, opened, sharedId))).toMatch(/"name": "On A"/)
      })

      it("drops a value that names no conflict while another keeps the merge waiting", async () => {
        const pair = await sharedPair()
        const { a, b, workspaceId, opened, sharedId } = pair
        a.repositories.workflows.update(sharedId, { name: "On A", description: "From A" })
        await a.sync.syncNow(workspaceId, { message: "Change two on A" })
        b.repositories.workflows.update(sharedId, { name: "On B", description: "From B" })
        expect(await b.sync.syncNow(opened, { message: "Change two on B" })).toMatchObject({ state: "merging" })

        const stopped = await b.sync.resolveMerge(opened, [
          { recordId: sharedId, path: "selectedEnvironmentId", value: "env_typed" },
          { recordId: sharedId, path: "name", side: "theirs" },
        ])

        expect(stopped).toMatchObject({ state: "merging" })
        // The stale value is gone from what the merge stored, and the conflict it never named is still waiting.
        expect((await b.sync.mergeState(opened)).picks).toEqual([{ recordId: sharedId, path: "name", side: "theirs" }])
        expect(((await b.sync.mergeState(opened)).conflicts).map((conflict) => conflict.path)).toEqual(["description", "name"])
      })

      it("refuses a whole-record value that renames the record, rather than writing it under another id's file", async () => {
        const pair = await sharedPair()
        const { a, b, workspaceId, opened, sharedId } = pair
        a.repositories.workflows.delete(sharedId)
        await a.sync.syncNow(workspaceId, { message: "Delete on A" })
        b.repositories.workflows.update(sharedId, { name: "Kept on B" })
        expect(await b.sync.syncNow(opened, { message: "Change on B" })).toMatchObject({ state: "merging" })
        expect(((await b.sync.mergeState(opened)).conflicts).map((conflict) => conflict.path)).toEqual([""])

        const file = workflowFileOf(b, opened, sharedId)
        const theirs = JSON.parse(cloneText(b, opened, file)) as Record<string, JsonValue>
        const stopped = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "", value: { ...theirs, workflowId: "wf_other" } }])

        expect(stopped).toMatchObject({ state: "merging" })
        expect(stopped.lastError?.message).toMatch(/must keep the record's own id/)
        expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toEqual([])
      })

      it("refuses values that add up to more than one request may carry, and keeps the merge waiting", async () => {
        const pair = await sharedPair()
        const { b, opened, sharedId } = pair
        await renameConflict(pair)

        const stopped = await b.sync.resolveMerge(
          opened,
          Array.from({ length: 20 }, () => ({ recordId: sharedId, path: "name", value: "x".repeat(230 * 1024) })),
        )

        expect(stopped).toMatchObject({ state: "merging" })
        expect(stopped.lastError?.message).toMatch(/add up to \d+ bytes, and one merge request may carry at most 4194304/)
        expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toEqual([])
      })

      it("refuses a value holding secret storage, and keeps the merge waiting", async () => {
        const pair = await sharedPair()
        const { b, opened, sharedId } = pair
        await renameConflict(pair)

        const stopped = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", value: { ciphertext: "c2VjcmV0" } }])

        expect(stopped).toMatchObject({ state: "merging" })
        expect(stopped.lastError?.message).toMatch(/holds secret storage/)
        expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toEqual([])
      })

      it("refuses a value larger than one decision may carry, and keeps the merge waiting", async () => {
        const pair = await sharedPair()
        const { b, opened, sharedId } = pair
        await renameConflict(pair)

        const stopped = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", value: "x".repeat(256 * 1024 + 1) }])

        expect(stopped).toMatchObject({ state: "merging" })
        expect(stopped.lastError?.message).toMatch(/may carry at most 262144/)
      })

      it("stores a value no file may hold, keeps the merge waiting, and lets a copy settle it", async () => {
        const pair = await sharedPair()
        const { b, opened, sharedId } = pair
        await renameConflict(pair)

        const stopped = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", value: "" }])

        expect(stopped).toMatchObject({ state: "merging", lastError: null })
        // The conflict list is computed with no picks, so it stays the merge's own.
        const state = await b.sync.mergeState(opened)
        expect(state.conflicts.map((conflict) => conflict.path)).toEqual(["name"])
        expect(state.picks).toEqual([{ recordId: sharedId, path: "name", value: "" }])

        // Keeping one copy is the way out, as the invalid path says.
        const resolved = await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])
        expect(resolved).toMatchObject({ state: "idle", lastError: null })
      })

      it("settles a whole-file conflict with text of the user's own, and refuses a value that is not text", async () => {
        const pair = await sharedPair()
        const { b, sandbox, remote, opened } = pair
        // The remote gains a README; this device takes it, edits it and commits it.
        pushFromElsewhere(sandbox, remote, { "README.md": "# Shared\n" }, "Add a readme")
        expect(await b.sync.syncNow(opened)).toMatchObject({ state: "idle" })
        fs.writeFileSync(path.join(dirOf(b, opened), "README.md"), "# Mine\n")
        await b.sync.commitLocal(opened, { message: "Edit the readme here" })
        // Another device changes it on the remote too.
        pushFromElsewhere(sandbox, remote, { "README.md": "# Remote\n" }, "Edit the readme there")
        expect(await b.sync.syncNow(opened)).toMatchObject({ state: "merging" })
        expect((await b.sync.mergeState(opened)).conflicts).toEqual([
          { kind: "file", recordId: "README.md", name: "README.md", path: "", base: "# Shared\n", ours: "# Mine\n", theirs: "# Remote\n" },
        ])

        const refused = await b.sync.resolveMerge(opened, [{ recordId: "README.md", path: "", value: { not: "text" } }])
        expect(refused).toMatchObject({ state: "merging" })
        expect(refused.lastError?.message).toMatch(/is not text/)

        const resolved = await b.sync.resolveMerge(opened, [{ recordId: "README.md", path: "", value: "# Together\n" }])
        expect(resolved).toMatchObject({ state: "idle", lastError: null })
        expect(cloneText(b, opened, "README.md")).toBe("# Together\n")
        expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, opened))
      })
    })
  })
})
