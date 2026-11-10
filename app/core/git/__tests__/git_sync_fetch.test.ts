import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SYNC_INTERVAL_MS } from "../git_sync_service"
import { passthrough } from "./git_sync_harness"
import { makeBareRemote, makeSandbox, rawGit } from "./git_test_utils"
import { openDevice, subjectsOf, headOf, remoteHead, binding, treeOf, cloneText, headCommitOf, sharedPair, fakeTimers, elapse, publish, openFromRemote, pushFromElsewhere, pushNewRootFromElsewhere, withWorkspace, nonFastForward, NETWORK_DOWN, networkDown } from "./git_sync_devices"

describe("the sync cycle", () => {
  it("keeps pulling while read-only: the remote's commits still come in, and the refusal's message stays", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    let pushes = 0
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      push: async (dir, remoteName, branch, options) => {
        pushes += 1
        return git.push(dir, remoteName, branch, options)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    // What a refused push leaves behind.
    b.repositories.workspaceGit.setReadOnly(opened, true)
    b.repositories.workspaceGit.setState(opened, "idle", { code: "permission_denied", message: "the host refused the push" })

    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Add on A" })
    const aHead = remoteHead(sandbox, remote.dir)

    await b.sync.start()

    expect(pushes).toBe(0)
    expect(await b.sync.status(opened)).toMatchObject({
      state: "idle",
      readOnly: true,
      incoming: 0,
      outgoing: 0,
      lastError: { code: "permission_denied", message: "the host refused the push" },
    })
    expect(headOf(b, opened)).toBe(aHead)
    expect(b.repositories.workflows.getById(onA.workflowId)?.name).toBe("On A")
    expect(binding(b, opened).lastSyncedCommit).toBe(aHead)
  })

  it("keeps a read-only workspace's refusal through manual fetches, but not a failed fetch's message past the next good one", async () => {
    fakeTimers()
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    await publish(a, sandbox, remote)
    let failFetch = false
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remoteName) => {
        if (failFetch) throw networkDown()
        return git.fetch(dir, remoteName)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    await b.sync.setMode(opened, "manual")
    const refusal = { code: "permission_denied" as const, message: "the host refused the push" }
    b.repositories.workspaceGit.setReadOnly(opened, true)
    b.repositories.workspaceGit.setState(opened, "idle", refusal)

    await b.sync.start()
    expect(await b.sync.status(opened)).toMatchObject({ state: "idle", readOnly: true, lastError: refusal })

    failFetch = true
    await elapse(b, SYNC_INTERVAL_MS)
    expect(await b.sync.status(opened)).toMatchObject({ state: "error", readOnly: true, lastError: { code: "network_error", message: NETWORK_DOWN } })

    // The failure was about one fetch; the next good one clears it. The workspace is still read-only.
    failFetch = false
    await elapse(b, SYNC_INTERVAL_MS)
    expect(await b.sync.status(opened)).toMatchObject({ state: "idle", readOnly: true, lastError: null })
  })

  it("leaves a diverged workspace diverged when its periodic fetch fails, and the fetch's reason as the message", async () => {
    fakeTimers()
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const shared = a.repositories.workflows.create({ workspaceId, name: "Shared" })
    await a.sync.syncNow(workspaceId, { message: "Add shared" })
    let failFetch = false
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remoteName) => {
        if (failFetch) throw new Error("network down")
        return git.fetch(dir, remoteName)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    await b.sync.setMode(opened, "manual")
    // A diverged workspace in this model is one whose merge the user gave up on: the two
    // histories still stand apart, and only Sync now asks for the merge again.
    a.repositories.workflows.update(shared.workflowId, { name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Rename on A" })
    b.repositories.workflows.update(shared.workflowId, { name: "On B" })
    expect(await b.sync.syncNow(opened, { message: "Rename on B" })).toMatchObject({ state: "merging" })
    expect(await b.sync.abandonMerge(opened)).toMatchObject({ state: "diverged" })

    // The periodic pass in manual mode only fetches, and this one fails. Where the histories
    // stand has not changed, so the state stays diverged and the message is the fetch's.
    failFetch = true
    await b.sync.start()
    expect(await b.sync.status(opened)).toMatchObject({
      state: "diverged",
      incoming: 1,
      outgoing: 1,
      lastError: { code: null, message: "network down" },
    })

    // A fetch that succeeds does not settle it either: only integrating can, and a fetch is not that.
    failFetch = false
    await elapse(b, SYNC_INTERVAL_MS)
    expect(await b.sync.status(opened)).toMatchObject({ state: "diverged", incoming: 1, outgoing: 1 })
    expect((await b.sync.mergeState(opened)).conflicts).toEqual([])
  })

  it("ends a retried push the remote raced again as a retryable error, and the next pass merges and pushes", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    await publish(a, sandbox, remote)
    let pushes = 0
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      push: async (dir, remoteName, branch, options) => {
        pushes += 1
        if (pushes === 1) throw nonFastForward()
        // Between the retry's fetch and its push, the remote gains a sibling commit: git itself rejects this push.
        if (pushes === 2) pushFromElsewhere(sandbox, remote, { "note.txt": "someone else's work\n" }, "Someone else's commit")
        return git.push(dir, remoteName, branch, options)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    b.repositories.workflows.create({ workspaceId: opened, name: "B's work" })

    const status = await b.sync.syncNow(opened, { message: "Add B's work" })

    // No merge was abandoned, so this is not `diverged`: it is the race, classified, for the next cycle to retry.
    expect(status).toMatchObject({ state: "error", lastError: { code: "non_fast_forward" }, outgoing: 1 })
    expect(pushes).toBe(2)
    expect(await subjectsOf(b, opened)).toContain("Add B's work")
    expect(await subjectsOf(b, opened)).not.toContain("Someone else's commit")
    const someoneElse = remoteHead(sandbox, remote.dir)
    expect(someoneElse).not.toBe(headOf(b, opened))

    // The next automatic pass fetches, merges the sibling commit in, and pushes.
    await b.sync.start()

    expect(await b.sync.status(opened)).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    const head = await headCommitOf(b, opened)
    expect(head.parents).toHaveLength(2)
    expect(head.parents).toContain(someoneElse)
    expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
    expect(cloneText(b, opened, "note.txt")).toBe("someone else's work\n")
  })

  it("stops on a remote whose branch shares no history with this workspace as an error saying what to do, not diverged", async () => {
    fakeTimers()
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    await publish(a, sandbox, remote)
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    // Someone replaces the remote's branch with a history of its own.
    const scratch = path.join(sandbox.root, "unrelated")
    rawGit(sandbox.root, sandbox.env, "init", "--initial-branch=main", scratch)
    fs.writeFileSync(path.join(scratch, "README.md"), "another project\n")
    rawGit(scratch, sandbox.env, "add", "-A")
    rawGit(scratch, sandbox.env, "-c", "user.name=Someone Else", "-c", "user.email=someone@example.invalid", "commit", "-m", "Another project")
    rawGit(scratch, sandbox.env, "push", "--force", remote.url, "main")
    const replaced = remoteHead(sandbox, remote.dir)
    b.repositories.workflows.create({ workspaceId: opened, name: "B's work" })

    const status = await b.sync.syncNow(opened, { message: "Add B's work" })

    expect(status).toMatchObject({ state: "error", lastError: { code: null } })
    expect(status.lastError?.message).toMatch(/^The remote's branch holds history this workspace did not come from.*Discard local changes/)
    expect(await subjectsOf(b, opened)).toContain("Add B's work")
    expect(remoteHead(sandbox, remote.dir)).toBe(replaced)
    expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()

    // An error, so the automatic pass tries again rather than waiting on Sync now, and stops the same way.
    await b.sync.start()
    expect(binding(b, opened)).toMatchObject({ state: "error", lastError: { message: status.lastError?.message } })
    expect(remoteHead(sandbox, remote.dir)).toBe(replaced)
  })

  it("refuses a remote whose branch now holds another workspace's tree, and pushes nothing", async () => {
    const pair = await sharedPair()
    const { b, sandbox, remote, opened } = pair
    // A readable, valid tree — of a different workspace.
    const theirs = pushNewRootFromElsewhere(sandbox, remote, withWorkspace(treeOf(b, opened), { workspaceId: "ws_other", name: "Other" }), "Another workspace")
    b.repositories.workflows.create({ workspaceId: opened, name: "B's work" })

    const status = await b.sync.syncNow(opened, { message: "Add B's work" })

    expect(status).toMatchObject({ state: "error", lastError: { code: null } })
    expect(status.lastError?.message).toMatch(/^The remote's branch holds history this workspace did not come from.*Discard local changes/)
    expect(await subjectsOf(b, opened)).toContain("Add B's work")
    expect(remoteHead(sandbox, remote.dir)).toBe(theirs)
    expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
  })
})
