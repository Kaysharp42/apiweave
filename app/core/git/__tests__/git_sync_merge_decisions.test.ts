import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { makeBareRemote, makeSandbox, rawGit } from "./git_test_utils"
import { openDevice, dirOf, subjectsOf, headOf, remoteHead, binding, treeOf, workflowFileOf, cloneText, headCommitOf, sharedPair, renameConflict, publish, openFromRemote, pushFromElsewhere, pushNewRootFromElsewhere } from "./git_sync_devices"

describe("the sync cycle", () => {
  describe("a merge that needs the user", () => {
    it("reads the merge in one call: every conflict, the decisions, and the notes with them", async () => {
      const pair = await sharedPair()
      const { a, b, workspaceId, opened, sharedId } = pair
      const node = (x: number) => [{ nodeId: "n1", type: "delay", position: { x, y: 0 }, config: { duration: 1 } }]
      a.repositories.workflows.update(sharedId, { name: "On A", nodes: node(0) })
      await a.sync.syncNow(workspaceId, { message: "Move on A" })
      b.repositories.workflows.update(sharedId, { name: "On B", nodes: node(100) })
      expect(await b.sync.syncNow(opened, { message: "Move on B" })).toMatchObject({ state: "merging" })

      const before = await b.sync.mergeState(opened)
      expect(before.conflicts.map((conflict) => conflict.path)).toEqual(["name"])
      expect(before.picks).toEqual([])
      expect(before.notes).toEqual([
        { type: "positions", recordId: sharedId, name: "On B", nodeIds: ["n1"] },
      ])

      const head = headOf(b, opened)
      const saved = await b.sync.saveMergePicks(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])

      // Storing a decision changes neither the conflict list nor where the merge stands.
      expect(saved.conflicts.map((conflict) => conflict.path)).toEqual(["name"])
      expect(saved.picks).toEqual([{ recordId: sharedId, path: "name", side: "theirs" }])
      expect(binding(b, opened)).toMatchObject({ state: "merging", lastError: null })
      expect(headOf(b, opened)).toBe(head)
      // The notes asked about with those picks are the merge's with them.
      expect((await b.sync.mergeState(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])).notes).toEqual(
        before.notes,
      )
      // A workspace with no merge waiting has nothing to report, and reads nothing.
      expect(await a.sync.mergeState(workspaceId)).toEqual({ conflicts: [], picks: [], notes: [] })
    })

    it("computes the notes with the decisions it is asked about, and checks them first", async () => {
      const pair = await sharedPair()
      const { a, b, workspaceId, opened, sharedId } = pair
      const node = (nodeId: string, duration = 1) => ({ nodeId, type: "delay", position: { x: 0, y: 0 }, config: { duration } })
      a.repositories.workflows.update(sharedId, {
        nodes: [node("n1"), node("n2")],
        edges: [{ edgeId: "e1", source: "n1", target: "n2" }],
      })
      await a.sync.syncNow(workspaceId, { message: "Add a graph on A" })
      await b.sync.syncNow(opened)
      // The remote changes the node the edge comes from and relabels the edge;
      // this device removes both, so the node is a real conflict.
      a.repositories.workflows.update(sharedId, {
        nodes: [node("n1", 5), node("n2")],
        edges: [{ edgeId: "e1", source: "n1", target: "n2", label: "go" }],
      })
      await a.sync.syncNow(workspaceId, { message: "Change n1 on A" })
      b.repositories.workflows.update(sharedId, { nodes: [node("n2")], edges: [] })
      expect(await b.sync.syncNow(opened, { message: "Remove n1 on B" })).toMatchObject({ state: "merging" })

      const stored = await b.sync.mergeState(opened)
      expect(stored.conflicts.map((conflict) => conflict.path).sort()).toEqual(["edges.e1", "nodes.n1"])
      expect(stored.notes).toEqual([])

      // Keeping this device's deletion makes the edge dangle, which the merge notes.
      const dryRun = await b.sync.mergeState(opened, [{ recordId: sharedId, path: "nodes.n1", side: "ours" }])
      expect(dryRun.notes).toEqual([
        { type: "droppedEdge", recordId: sharedId, name: "Shared", edgeId: "e1", end: "source", nodeId: "n1" },
      ])

      // A dry run is checked as a save is: a value no file may hold is refused.
      await expect(
        b.sync.mergeState(opened, [{ recordId: sharedId, path: "nodes.n1", value: { ciphertext: "c2VjcmV0" } }]),
      ).rejects.toThrow(/holds secret storage/)
      // And nothing was stored by either read.
      expect((await b.sync.mergeState(opened)).picks).toEqual([])
    })

    it("saves decisions with the same checks a resolve makes, and refuses a secret one", async () => {
      const pair = await sharedPair()
      const { b, opened, sharedId } = pair
      await renameConflict(pair)

      expect(
        await b.sync.saveMergePicks(opened, [
          { recordId: sharedId, path: "name", side: "theirs" },
          { recordId: sharedId, path: "selectedEnvironmentId", value: "stale" },
        ]),
      ).toMatchObject({ picks: [{ recordId: sharedId, path: "name", side: "theirs" }] })

      await expect(
        b.sync.saveMergePicks(opened, [{ recordId: sharedId, path: "name", value: { ciphertext: "c2VjcmV0" } }]),
      ).rejects.toThrow(/holds secret storage/)
      // The refused save left the earlier decision as it was.
      expect((await b.sync.mergeState(opened)).picks).toEqual([
        { recordId: sharedId, path: "name", side: "theirs" },
      ])
    })

    it("survives a restart with no base: the row and its picks are kept, the conflicts recomputed, and Resolve finishes it", async () => {
      const pair = await sharedPair()
      const { b, sandbox, remote, opened, sharedId } = pair
      // A fresh root of this same workspace, differing in two fields.
      const files = treeOf(b, opened)
      const file = workflowFileOf(b, opened, sharedId)
      const workflow = JSON.parse(files.get(file)!) as { name: string; description: string }
      files.set(file, JSON.stringify({ ...workflow, name: "Remote name", description: "Remote description" }))
      const theirs = pushNewRootFromElsewhere(sandbox, remote, files, "Restart tracking elsewhere")

      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "merging", unrelatedHistory: true })
      expect(b.repositories.workspaceGit.getMerge(opened)).toMatchObject({ baseCommit: null, theirCommit: theirs })
      // One decision is made; the other conflict keeps the merge waiting.
      expect(await b.sync.resolveMerge(opened, [{ recordId: sharedId, path: "name", side: "theirs" }])).toMatchObject({ state: "merging" })
      const picks = [{ recordId: sharedId, path: "name", side: "theirs" as const }]
      expect(b.repositories.workspaceGit.getMerge(opened)?.picks).toEqual(picks)
      expect(((await b.sync.mergeState(opened)).conflicts).map((conflict) => conflict.path)).toEqual(["description", "name"])

      await b.restart()
      await b.sync.reconcile()

      // The merge the app quit under is repaired from its row, not dropped.
      expect(binding(b, opened)).toMatchObject({ state: "merging", lastError: null })
      expect(b.repositories.workspaceGit.getMerge(opened)).toMatchObject({ baseCommit: null, theirCommit: theirs, picks })
      expect(((await b.sync.mergeState(opened)).conflicts).map((conflict) => conflict.path)).toEqual(["description", "name"])

      const resolved = await b.sync.resolveMerge(opened, [...picks, { recordId: sharedId, path: "description", side: "theirs" }])

      expect(resolved).toMatchObject({ state: "idle", lastError: null })
      const head = await headCommitOf(b, opened)
      expect(head.parents).toHaveLength(2)
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
      expect(b.repositories.workflows.getById(sharedId)).toMatchObject({ name: "Remote name", description: "Remote description" })
    })

    it("takes the author Sync now names while merging, and clears the missing-author error a resolve left", async () => {
      const pair = await sharedPair()
      const { b, opened } = pair
      await renameConflict(pair)
      b.repositories.workspaceGit.setState(opened, "merging", { code: "identity_missing", message: "Author identity unknown" })
      const head = headOf(b, opened)

      const named = await b.sync.syncNow(opened, { identity: { name: "Ada Lovelace", email: "ada@example.invalid" } })

      expect(named).toMatchObject({ state: "merging", lastError: null })
      expect(rawGit(dirOf(b, opened), b.env, "config", "--local", "user.name").trim()).toBe("Ada Lovelace")
      expect(headOf(b, opened)).toBe(head)
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeDefined()
    })

    it("cleans what a merge wrote and never staged before a crash, so the startup commit does not claim the remote's files", async () => {
      const sandbox = makeSandbox()
      const a = openDevice(sandbox, "a")
      const remote = makeBareRemote(sandbox, "shared.git")
      await publish(a, sandbox, remote)
      const b = openDevice(sandbox, "b")
      const opened = await openFromRemote(b, remote.url)
      b.repositories.workflows.create({ workspaceId: opened, name: "B local" })
      await b.sync.commitLocal(opened, { message: "B local" })
      const bHead = headOf(b, opened)
      const subjects = await subjectsOf(b, opened)
      const theirs = pushFromElsewhere(sandbox, remote, { "README.md": "# Shared\n", "docs/notes.md": "notes\n" }, "Add docs")
      // What a crash between writing the merged tree and staging it leaves: the marker set, git merging,
      // the remote's files written into the checkout and not staged, the database as it was.
      const dir = dirOf(b, opened)
      rawGit(dir, b.env, "fetch", "origin")
      b.repositories.workspaceGit.setIntegratingFrom(opened, bHead)
      rawGit(dir, b.env, "-c", "user.name=Device B", "-c", "user.email=b@example.invalid", "merge", "--no-commit", "--no-ff", "-s", "ours", theirs)
      fs.writeFileSync(path.join(dir, "README.md"), "# Shared\n")
      fs.mkdirSync(path.join(dir, "docs"))
      fs.writeFileSync(path.join(dir, "docs", "notes.md"), "notes\n")

      await b.restart()
      await b.sync.reconcile()

      // Back on B's commit with nothing left over: the startup commit found nothing to claim as B's.
      expect(headOf(b, opened)).toBe(bHead)
      expect(await subjectsOf(b, opened)).toEqual(subjects)
      expect(await b.git.status(dir)).toMatchObject({ clean: true })
      expect(fs.existsSync(path.join(dir, "README.md"))).toBe(false)
      expect(binding(b, opened).integratingFrom).toBeNull()

      // The files arrive the honest way: in the merge, as the remote's.
      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "idle", lastError: null })
      const head = await headCommitOf(b, opened)
      expect(head.parents).toEqual([bHead, theirs])
      expect(cloneText(b, opened, "docs/notes.md")).toBe("notes\n")
      expect(await subjectsOf(b, opened)).not.toContainEqual(expect.stringMatching(/^Update (README\.md|2 files)$/))
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
    })
  })
})
