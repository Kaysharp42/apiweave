import path from "node:path"
import { describe, expect, it } from "vitest"
import { environmentDocument, fileText, presetDocument, WORKSPACE_FILE } from "@shared/workspace-repo/format"
import { readWorkspaceTree, writeWorkspaceTree } from "../workspace_tree"
import { openHarness, type Harness } from "./git_sync_harness"
import { makeBareRemote } from "./git_test_utils"

const NOT_CONNECTED = "Connect a remote before choosing a branch."

async function trackedHarness(): Promise<Harness> {
  const harness = openHarness()
  await harness.sync.track(harness.workspaceId)
  return harness
}

function binding(harness: Harness) {
  const row = harness.repositories.workspaceGit.get(harness.workspaceId)
  if (row === undefined) throw new Error("the workspace is not tracked")
  return row
}

/** A bare repository holding the workspace's `main`, connected and synced. */
async function connectedHarness(): Promise<{ readonly harness: Harness; readonly remote: { readonly dir: string; readonly url: string } }> {
  const harness = await trackedHarness()
  const remote = makeBareRemote(harness.sandbox, "branches.git")
  await harness.sync.connectRemote(harness.workspaceId, remote.url)
  return { harness, remote }
}

/**
 * Add a branch to the connected remote, from a clone of its `main`, with
 * `edit` applied to the workspace tree. The app's own clone is not touched.
 */
async function addBranch(harness: Harness, name: string, edit: (files: Map<string, string>) => void): Promise<void> {
  const remoteUrl = binding(harness).remoteUrl
  if (remoteUrl === null) throw new Error("the workspace has no remote")
  const work = path.join(harness.sandbox.root, `branch-work-${name}`)
  await harness.git.clone(remoteUrl, work)
  await harness.git.checkout(work, name, "origin/main")
  const files = await readWorkspaceTree(work)
  edit(files)
  await writeWorkspaceTree(work, files)
  await harness.git.add(work, ["."])
  await harness.git.commit(work, `Add branch ${name}`)
  await harness.git.push(work, "origin", name)
}

function editWorkspace(files: Map<string, string>, edit: (workspace: Record<string, unknown>) => void): void {
  const text = files.get(WORKSPACE_FILE)
  if (text === undefined) throw new Error("the tree holds no workspace.json")
  const workspace = JSON.parse(text) as Record<string, unknown>
  edit(workspace)
  files.set(WORKSPACE_FILE, fileText(workspace))
}

describe("GitSyncService branches", () => {
  it("lists a remote's branches and its default before any clone", async () => {
    const { harness, remote } = await connectedHarness()
    await addBranch(harness, "feature", (files) => {
      editWorkspace(files, (workspace) => {
        workspace["description"] = "Feature branch"
      })
    })

    const list = await harness.sync.listRemoteBranches(remote.url)

    expect(list).toEqual({ branches: ["feature", "main"], defaultBranch: "main" })
  })

  it("lists the branches of a connected workspace after fetching them", async () => {
    const { harness } = await connectedHarness()
    await addBranch(harness, "feature", () => undefined)

    expect(await harness.sync.listBranches(harness.workspaceId)).toEqual({ branches: ["feature", "main"], defaultBranch: null })
  })

  it("refuses to list branches without a remote", async () => {
    const harness = await trackedHarness()

    await expect(harness.sync.listBranches(harness.workspaceId)).rejects.toThrow(NOT_CONNECTED)
  })

  it("switches to another branch, imports its tree, and switching back restores the first", async () => {
    const { harness } = await connectedHarness()
    expect(harness.repositories.workspaces.getById(harness.workspaceId)?.description).toBeNull()
    await addBranch(harness, "feature", (files) => {
      files.set("environments/feature-env--env-feature.json", fileText(environmentDocument({
        environmentId: "env-feature",
        name: "Feature env",
        description: null,
        swaggerDocUrl: null,
        baseEnvironmentId: null,
        variables: { region: "us" },
      }, { isDefault: true })))
      files.set("presets/feature-delay--preset-feature.json", fileText(presetDocument({
        presetId: "preset-feature",
        name: "Feature delay",
        nodeType: "delay",
        config: { duration: 123 },
      })))
      editWorkspace(files, (workspace) => {
        workspace["description"] = "Feature branch"
      })
    })

    const status = await harness.sync.switchBranch(harness.workspaceId, "feature")

    expect(status).toMatchObject({ branch: "feature", state: "idle", lastError: null })
    expect(binding(harness).branch).toBe("feature")
    expect((await harness.git.status(harness.dir)).branch).toBe("feature")
    expect(harness.repositories.workspaces.getById(harness.workspaceId)?.description).toBe("Feature branch")
    expect(harness.repositories.environments.getById("env-feature")?.variables).toEqual({ region: "us" })
    expect(harness.repositories.presets.getById("preset-feature")?.config).toEqual({ duration: 123 })
    expect(binding(harness).lastSyncedCommit).toBe((await harness.git.revParse(harness.dir, "origin/feature")))

    const back = await harness.sync.switchBranch(harness.workspaceId, "main")

    expect(back).toMatchObject({ branch: "main", state: "idle" })
    expect(harness.repositories.workspaces.getById(harness.workspaceId)?.description).toBeNull()
    expect(harness.repositories.environments.getById("env-feature")).toBeUndefined()
    expect(harness.repositories.presets.getById("preset-feature")).toBeUndefined()
  })

  it("refuses to switch while this branch has commits the remote does not, and leaves everything where it was", async () => {
    const { harness } = await connectedHarness()
    await addBranch(harness, "feature", () => undefined)
    harness.repositories.workspaces.update(harness.workspaceId, { description: "Unpushed work" })
    await harness.sync.commitLocal(harness.workspaceId)
    const head = await harness.git.revParse(harness.dir, "HEAD")

    await expect(harness.sync.switchBranch(harness.workspaceId, "feature")).rejects.toThrow(/has 1 commit that main on the remote does not/)

    expect(binding(harness).branch).toBe("main")
    expect(await harness.git.revParse(harness.dir, "HEAD")).toBe(head)
    expect((await harness.git.status(harness.dir)).branch).toBe("main")
    expect(harness.repositories.workspaces.getById(harness.workspaceId)?.description).toBe("Unpushed work")
  })

  it("refuses a branch that holds another workspace's history", async () => {
    const { harness } = await connectedHarness()
    await addBranch(harness, "feature", (files) => {
      editWorkspace(files, (workspace) => {
        workspace["workspaceId"] = "ws-another"
      })
    })

    await expect(harness.sync.switchBranch(harness.workspaceId, "feature")).rejects.toThrow(/remote's branch holds history this workspace did not come from/)
    expect(binding(harness).branch).toBe("main")
  })
})
