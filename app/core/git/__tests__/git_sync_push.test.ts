import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { passthrough } from "./git_sync_harness"
import { closedPortUrl, listen, makeBareRemote, makeSandbox, rawGit } from "./git_test_utils"
import { openDevice, subjectsOf, headOf, remoteHead, binding, snapshotOf, treeOf, publish, openFromRemote, nonFastForward, NETWORK_DOWN, networkDown } from "./git_sync_devices"

describe("the sync cycle", () => {
  it("discard removes a deletion and an addition from this device, restoring the remote's tree", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const kept = a.repositories.workflows.create({ workspaceId, name: "Kept" })
    const removed = a.repositories.workflows.create({ workspaceId, name: "Removed" })
    await a.sync.syncNow(workspaceId, { message: "Add two" })
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    const remoteSha = remoteHead(sandbox, remote.dir)

    b.repositories.workflows.delete(removed.workflowId)
    b.repositories.workflows.create({ workspaceId: opened, name: "B only" })
    expect(await b.sync.commitLocal(opened, { message: "Edit on B" })).toBeDefined()
    expect(headOf(b, opened)).not.toBe(remoteSha)

    const discarded = await b.sync.discardLocalChanges(opened)

    expect(discarded.state).toBe("idle")
    expect(headOf(b, opened)).toBe(remoteSha)
    expect(b.repositories.workflows.getById(removed.workflowId)?.name).toBe("Removed")
    expect(b.repositories.workflows.getById(kept.workflowId)?.name).toBe("Kept")
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name))
      .not.toContain("B only")
    expect(treeOf(b, opened)).toEqual(treeOf(a, workspaceId))
  })

  it("refuses to discard without a remote, or when the remote has no branch for the workspace yet", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const workspaceId = a.repositories.workspaces.create({ name: "Local only", slug: "local-only" }).workspaceId
    await a.sync.track(workspaceId)
    await expect(a.sync.discardLocalChanges(workspaceId)).rejects.toThrow("not connected to a remote")

    const b = openDevice(sandbox, "b")
    const remote = makeBareRemote(sandbox, "shared.git")
    const published = await publish(b, sandbox, remote)
    rawGit(remote.dir, sandbox.env, "update-ref", "-d", "refs/heads/main")

    await expect(b.sync.discardLocalChanges(published)).rejects.toThrow("does not have this workspace's branch yet")
    expect(binding(b, published).remoteUrl).toBe(remote.url)
  })

  it("marks the workspace read-only when the host refuses a push, keeps committing locally, and pushes nothing by itself", async () => {
    const sandbox = makeSandbox()
    const refusing = await listen((_request, response) => {
      response.writeHead(403, { "Content-Type": "text/plain" })
      response.end("Forbidden\n")
    })
    let refusePush = false
    let pushes = 0
    const b = openDevice(sandbox, "b", (git) => ({
      ...passthrough(git),
      push: async (dir, remote, branch, options) => {
        pushes += 1
        if (!refusePush) return git.push(dir, remote, branch, options)
        // The clone keeps its real remote: one push is answered by a host that refuses this user, as GitHub does with a 403.
        const original = rawGit(dir, sandbox.env, "remote", "get-url", "origin").trim()
        try {
          await git.remoteSetUrl(dir, "origin", refusing.url)
          return await git.push(dir, remote, branch, options)
        } finally {
          await git.remoteSetUrl(dir, "origin", original)
        }
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(b, sandbox, remote)
    const remoteSha = remoteHead(sandbox, remote.dir)
    b.repositories.workflows.create({ workspaceId, name: "B's work" })
    pushes = 0
    refusePush = true

    const refused = await b.sync.syncNow(workspaceId)

    expect(refused).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" } })
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)
    const localHead = headOf(b, workspaceId)
    expect(localHead).not.toBe(remoteSha)

    // Local commits continue, and the refusal's message survives them: only a successful push clears it.
    b.repositories.workflows.create({ workspaceId, name: "More of B's work" })
    expect(await b.sync.commitLocal(workspaceId, { message: "Keep working" })).toBeDefined()
    expect(headOf(b, workspaceId)).not.toBe(localHead)
    expect(await b.sync.status(workspaceId)).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" } })

    // An automatic pass fetches and integrates, but does not push — and still does not clear the message.
    await b.sync.start()
    expect(await b.sync.status(workspaceId)).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" } })
    expect(pushes).toBe(1)
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)

    // Sync now still tries, and success is what proves the host accepts this user again.
    refusePush = false
    const accepted = await b.sync.syncNow(workspaceId)
    expect(accepted).toMatchObject({ state: "idle", readOnly: false, lastError: null, incoming: 0, outgoing: 0 })
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(b, workspaceId))
    expect(binding(b, workspaceId).lastSyncedCommit).toBe(headOf(b, workspaceId))

    // And A, which pushed the workspace, pulls all of it.
    const a = openDevice(sandbox, "a")
    const openedOnA = await openFromRemote(a, remote.url)
    expect(openedOnA).toBe(workspaceId)
    expect(snapshotOf(a, openedOnA)).toEqual(snapshotOf(b, workspaceId))
  })

  it("makes B read-only when the remote's pre-receive hook declines B's commits, while A keeps pushing", async () => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    // A real server-side refusal by author, as a host's push rules make one. Git for Windows
    // runs the hook through its bundled sh; elsewhere the file must be executable.
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
    const remoteSha = remoteHead(sandbox, remote.dir)

    b.repositories.workflows.create({ workspaceId: opened, name: "On B" })
    const refused = await b.sync.syncNow(opened, { message: "Add on B" })

    expect(refused).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" }, outgoing: 1 })
    expect(refused.lastError?.message).toMatch(/pre-receive hook declined/)
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)

    // The hook refuses B, not the branch: A's push goes through.
    const onA = a.repositories.workflows.create({ workspaceId, name: "On A" })
    expect(await a.sync.syncNow(workspaceId, { message: "Add on A" })).toMatchObject({ state: "idle", readOnly: false, lastError: null })
    const aHead = remoteHead(sandbox, remote.dir)
    expect(aHead).toBe(headOf(a, workspaceId))

    // The read-only offer: B drops its commit and takes A's, and stays read-only.
    const discarded = await b.sync.discardLocalChanges(opened)
    expect(discarded).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" }, incoming: 0, outgoing: 0 })
    expect(headOf(b, opened)).toBe(aHead)
    expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name)).toEqual(["On A"])
    expect(b.repositories.workflows.getById(onA.workflowId)).toBeDefined()

    // Retry with nothing to send: git would answer "Everything up-to-date" without asking the
    // hook, which proves nothing about the host. Nothing is pushed, and B stays read-only.
    const retried = await b.sync.syncNow(opened)
    expect(retried).toMatchObject({ state: "idle", readOnly: true, lastError: { code: "permission_denied" }, incoming: 0, outgoing: 0 })
    expect(remoteHead(sandbox, remote.dir)).toBe(aHead)
  })

  it("surfaces a network loss mid-push as an error, keeps the commit, and retries on the next cycle", async () => {
    const sandbox = makeSandbox()
    const deadUrl = await closedPortUrl()
    let failNextPush = false
    const a = openDevice(sandbox, "a", (git) => ({
      ...passthrough(git),
      push: async (dir, remote, branch, options) => {
        if (!failNextPush) return git.push(dir, remote, branch, options)
        failNextPush = false
        const original = rawGit(dir, sandbox.env, "remote", "get-url", "origin").trim()
        try {
          await git.remoteSetUrl(dir, "origin", deadUrl)
          return await git.push(dir, remote, branch, options)
        } finally {
          await git.remoteSetUrl(dir, "origin", original)
        }
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    const remoteSha = remoteHead(sandbox, remote.dir)
    a.repositories.workflows.create({ workspaceId, name: "While offline" })
    failNextPush = true

    const failed = await a.sync.syncNow(workspaceId, { message: "Add while offline" })

    expect(failed).toMatchObject({ state: "error", lastError: { code: "network_error" } })
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)
    expect(remoteHead(sandbox, remote.dir)).not.toBe(headOf(a, workspaceId))
    expect(await subjectsOf(a, workspaceId)).toContain("Add while offline")

    const retried = await a.sync.syncNow(workspaceId)
    expect(retried).toMatchObject({ state: "idle", lastError: null, incoming: 0, outgoing: 0 })
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(a, workspaceId))
    expect(binding(a, workspaceId).lastSyncedCommit).toBe(headOf(a, workspaceId))
  })

  it("retries a non-fast-forward once from a fresh fetch, and succeeds when the remote had not really moved", async () => {
    const sandbox = makeSandbox()
    let armed = false
    let pushes = 0
    let fetches = 0
    const a = openDevice(sandbox, "a", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remote) => {
        fetches += 1
        return git.fetch(dir, remote)
      },
      push: async (dir, remote, branch, options) => {
        pushes += 1
        return armed && pushes === 1 ? Promise.reject(nonFastForward()) : git.push(dir, remote, branch, options)
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    // The connection's own push and fetch are the baseline.
    pushes = 0
    fetches = 0
    armed = true
    a.repositories.workflows.create({ workspaceId, name: "Retried" })

    const status = await a.sync.syncNow(workspaceId, { message: "Add retried" })

    expect(status).toMatchObject({ state: "idle", lastError: null })
    expect(pushes).toBe(2)
    // The retry fetches again before pushing: the one from the first cycle, the one from the retry.
    expect(fetches).toBe(2)
    expect(remoteHead(sandbox, remote.dir)).toBe(headOf(a, workspaceId))
  })

  it("ends the second non-fast-forward honestly: error, with the classified failure and the local commits", async () => {
    const sandbox = makeSandbox()
    let armed = false
    let pushes = 0
    const a = openDevice(sandbox, "a", (git) => ({
      ...passthrough(git),
      push: async (dir, remote, branch, options) => {
        pushes += 1
        return armed && pushes <= 2 ? Promise.reject(nonFastForward()) : git.push(dir, remote, branch, options)
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    pushes = 0
    armed = true
    const remoteSha = remoteHead(sandbox, remote.dir)
    a.repositories.workflows.create({ workspaceId, name: "Never lands" })

    const status = await a.sync.syncNow(workspaceId, { message: "Add never lands" })

    // Only this workspace's side holds a new commit: a race, not the diverged state.
    expect(status).toMatchObject({ state: "error", lastError: { code: "non_fast_forward" }, incoming: 0, outgoing: 1 })
    expect(pushes).toBe(2)
    expect(remoteHead(sandbox, remote.dir)).toBe(remoteSha)
    expect(await subjectsOf(a, workspaceId)).toContain("Add never lands")
  })

  it("records a fetch the host refuses as an error: only a refused push makes a workspace read-only", async () => {
    const sandbox = makeSandbox()
    const refusing = await listen((_request, response) => {
      response.writeHead(403, { "Content-Type": "text/plain" })
      response.end("Forbidden\n")
    })
    let refuseFetch = false
    const a = openDevice(sandbox, "a", (git) => ({
      ...passthrough(git),
      fetch: async (dir, remoteName) => {
        if (!refuseFetch) return git.fetch(dir, remoteName)
        const original = rawGit(dir, sandbox.env, "remote", "get-url", "origin").trim()
        try {
          await git.remoteSetUrl(dir, "origin", refusing.url)
          return await git.fetch(dir, remoteName)
        } finally {
          await git.remoteSetUrl(dir, "origin", original)
        }
      },
    }))
    const remote = makeBareRemote(sandbox, "shared.git")
    const workspaceId = await publish(a, sandbox, remote)
    refuseFetch = true

    const status = await a.sync.syncNow(workspaceId)

    expect(status).toMatchObject({ state: "error", readOnly: false, lastError: { code: "permission_denied" } })
  })

  it("keeps an automatic workspace diverged through a cycle that fails before integrating, and through reconcile", async () => {
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
        if (failFetch) throw networkDown()
        return git.fetch(dir, remoteName)
      },
    }))
    const opened = await openFromRemote(b, remote.url)
    // A genuinely diverged workspace: the merge could not settle the two names, and was given up on.
    a.repositories.workflows.update(shared.workflowId, { name: "On A" })
    await a.sync.syncNow(workspaceId, { message: "Rename on A" })
    b.repositories.workflows.update(shared.workflowId, { name: "On B" })
    expect(await b.sync.syncNow(opened, { message: "Rename on B" })).toMatchObject({ state: "merging" })
    expect(await b.sync.abandonMerge(opened)).toMatchObject({ state: "diverged" })

    failFetch = true
    expect(await b.sync.syncNow(opened)).toMatchObject({ state: "diverged", lastError: { code: "network_error", message: NETWORK_DOWN } })

    // Startup runs a cycle for an automatic workspace, and this one fails before integrating too.
    await b.sync.reconcile()
    expect(binding(b, opened)).toMatchObject({ state: "diverged", lastError: { code: "network_error", message: NETWORK_DOWN } })

    // The periodic pass does not offer the merge an abandoned workspace waits for; Sync now does.
    failFetch = false
    await b.sync.start()
    expect(await b.sync.status(opened)).toMatchObject({ state: "diverged" })
  })

  it.each([
    { cause: "a missing author", lastError: { code: "identity_missing" as const, message: "git does not know who you are" } },
    { cause: "a push the remote kept rejecting", lastError: { code: "non_fast_forward" as const, message: "git push failed: (non-fast-forward)" } },
  ])("keeps an error a fetch did not cause, $cause, through a good manual fetch", async ({ lastError }) => {
    const sandbox = makeSandbox()
    const a = openDevice(sandbox, "a")
    const remote = makeBareRemote(sandbox, "shared.git")
    await publish(a, sandbox, remote)
    const b = openDevice(sandbox, "b")
    const opened = await openFromRemote(b, remote.url)
    await b.sync.setMode(opened, "manual")
    b.repositories.workspaceGit.setState(opened, "error", lastError)

    await b.sync.start()

    expect(binding(b, opened)).toMatchObject({ state: "error", lastError })
  })
})
