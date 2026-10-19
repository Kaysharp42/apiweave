import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it, vi } from "vitest"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import { serializeWorkspace, workspaceSnapshot, type WorkspaceSnapshot } from "../../services/workspace_repo_format"
import { openHarness, passthrough, type Harness } from "./git_sync_harness"
import { makeBareRemote, rawGit } from "./git_test_utils"

const NOT_A_WORKSPACE = /\.apiweave\/format\.json is missing: this is not an APIWeave workspace repository/

function seed(harness: Harness): void {
  const { workspaceId, repositories } = harness
  const project = repositories.collections.create({
    collectionId: "proj-main",
    workspaceId,
    name: "Main",
    workflowOrder: [{ workflowId: "wf-member", order: 0, enabled: false, continueOnFail: true }],
  })
  repositories.environments.create({ environmentId: "env-main", workspaceId, name: "Main env", isDefault: true, variables: { baseUrl: "https://api.example.test" } })
  const start = { nodeId: "start", type: "start", position: { x: 0, y: 0 } } as WorkflowNode
  repositories.workflows.create({ workflowId: "wf-member", workspaceId, collectionId: project.collectionId, name: "Member", nodes: [start] })
  repositories.workflows.create({ workflowId: "wf-free", workspaceId, name: "Free workflow", nodes: [start] })
}

function snapshotOf(harness: Harness, workspaceId = harness.workspaceId): WorkspaceSnapshot {
  const { workspaces, collections, workflows, environments } = harness.repositories
  return workspaceSnapshot({
    workspace: workspaces.getById(workspaceId)!,
    projects: collections.listByWorkspace(workspaceId).items,
    workflows: workflows.listByWorkspace(workspaceId, true).items,
    environments: environments.listByWorkspace(workspaceId).items,
  })
}

/** A tracked, seeded workspace, pushed to an empty bare repository. */
async function publishedWorkspace(): Promise<{ readonly source: Harness; readonly url: string; readonly bare: string }> {
  const source = openHarness()
  seed(source)
  await source.sync.track(source.workspaceId)
  const remote = makeBareRemote(source.sandbox)
  await source.sync.connectRemote(source.workspaceId, remote.url)
  return { source, url: remote.url, bare: remote.dir }
}

/** A bare repository whose `main` holds exactly `files`. */
async function publishFiles(harness: Harness, name: string, files: ReadonlyMap<string, string>): Promise<string> {
  const remote = makeBareRemote(harness.sandbox, `${name}.git`)
  const work = path.join(harness.sandbox.root, `work-${name}`)
  await harness.git.init(work, { initialBranch: "main" })
  for (const [relative, text] of files) {
    const target = path.join(work, ...relative.split("/"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  await harness.git.add(work, ["."])
  await harness.git.commit(work, "initial")
  await harness.git.remoteAdd(work, "origin", remote.url)
  await harness.git.push(work, "origin", "main")
  return remote.url
}

function entries(directory: string): string[] {
  return fs.readdirSync(directory).sort()
}

function binding(harness: Harness, workspaceId: string) {
  const row = harness.repositories.workspaceGit.get(workspaceId)
  if (row === undefined) throw new Error("the workspace is not tracked")
  return row
}

/** Nothing was created: the store has only its own workspace, and the clone root holds no clone and no scratch. */
function expectNothingCreated(harness: Harness): void {
  expect(harness.repositories.workspaces.listAll().map((workspace) => workspace.workspaceId)).toEqual([harness.workspaceId])
  expect(entries(harness.cloneRoot)).toEqual([])
}

describe("GitSyncService.openFromGit", () => {
  it("opens a repository pushed by connectRemote as a tracked, non-personal workspace with an identical snapshot", async () => {
    const { source, url } = await publishedWorkspace()
    const target = openHarness()

    const result = await target.sync.openFromGit(url)

    expect(result).toEqual({ kind: "opened", workspaceId: source.workspaceId, slug: "acme-qa-2", name: "Acme QA", warnings: [] })
    const clone = path.join(target.cloneRoot, source.workspaceId)
    expect(fs.existsSync(path.join(clone, ".git"))).toBe(true)
    expect(entries(target.cloneRoot)).toEqual([source.workspaceId])
    expect(binding(target, source.workspaceId)).toMatchObject({
      mode: "auto",
      remoteUrl: url,
      branch: "main",
      state: "idle",
      lastError: null,
      readOnly: false,
    })
    expect(snapshotOf(target, source.workspaceId)).toEqual(snapshotOf(source))
    expect(target.repositories.workspaces.getById(source.workspaceId)).toMatchObject({ isPersonal: false, slug: "acme-qa-2" })
    // What the clone holds is what the database now serializes to, so the first auto commit has nothing to write.
    expect(await target.sync.commitLocal(source.workspaceId)).toBeUndefined()
    const status = await target.sync.status(source.workspaceId)
    expect(status.lastCommit?.sha).toBe(rawGit(source.dir, source.sandbox.env, "rev-parse", "HEAD").trim())
  })

  it("trims the URL it is given, and gives the opened workspace a slug of its own when the name's is taken", async () => {
    const { source, url } = await publishedWorkspace()
    const target = openHarness()
    target.repositories.workspaces.create({ workspaceId: "ws-other", name: "Acme QA", slug: "acme-qa-2", isPersonal: false })

    const result = await target.sync.openFromGit(`  ${url}  `)

    expect(result).toMatchObject({ kind: "opened", workspaceId: source.workspaceId, slug: "acme-qa-3" })
    expect(binding(target, source.workspaceId).remoteUrl).toBe(url)
  })

  it("resolves duplicate, and touches nothing, when the repository's workspace is already here", async () => {
    const { source, url } = await publishedWorkspace()
    const head = rawGit(source.dir, source.sandbox.env, "rev-parse", "HEAD").trim()
    fs.writeFileSync(path.join(source.dir, "marker.txt"), "local\n")

    const result = await source.sync.openFromGit(url)

    expect(result).toEqual({ kind: "duplicate", workspaceId: source.workspaceId, slug: "acme-qa", name: "Acme QA" })
    expect(entries(source.cloneRoot)).toEqual([source.workspaceId])
    expect(rawGit(source.dir, source.sandbox.env, "rev-parse", "HEAD").trim()).toBe(head)
    expect(fs.readFileSync(path.join(source.dir, "marker.txt"), "utf8")).toBe("local\n")
    expect(source.repositories.workspaces.listAll()).toHaveLength(1)
    expect(snapshotOf(source).workflows).toHaveLength(2)
  })

  it("resolves duplicate for a second open of the same repository and leaves the first open's clone and data alone", async () => {
    const { source, url } = await publishedWorkspace()
    const target = openHarness()
    await target.sync.openFromGit(url)
    const clone = path.join(target.cloneRoot, source.workspaceId)
    fs.writeFileSync(path.join(clone, "marker.txt"), "local\n")
    const before = snapshotOf(target, source.workspaceId)

    const result = await target.sync.openFromGit(url)

    expect(result).toEqual({ kind: "duplicate", workspaceId: source.workspaceId, slug: "acme-qa-2", name: "Acme QA" })
    expect(entries(target.cloneRoot)).toEqual([source.workspaceId])
    expect(fs.readFileSync(path.join(clone, "marker.txt"), "utf8")).toBe("local\n")
    expect(snapshotOf(target, source.workspaceId)).toEqual(before)
    expect(target.repositories.workspaces.listAll()).toHaveLength(2)
  })

  it("runs opens one at a time: two opens of one repository give one workspace and a duplicate", async () => {
    const { url } = await publishedWorkspace()
    const target = openHarness()

    const results = await Promise.all([target.sync.openFromGit(url), target.sync.openFromGit(url)])

    expect(results.map((result) => result.kind)).toEqual(["opened", "duplicate"])
    expect(target.repositories.workspaces.listAll()).toHaveLength(2)
    expect(entries(target.cloneRoot)).toHaveLength(1)
  })

  it("refuses a clone no workspace claims, and leaves the commits it holds alone", async () => {
    const { source, url } = await publishedWorkspace()
    const target = openHarness()
    // A clone with a commit that is not on the remote, exactly as a database restored from a backup that predates the row leaves behind.
    const unclaimed = path.join(target.cloneRoot, source.workspaceId)
    await target.git.clone(url, unclaimed)
    fs.writeFileSync(path.join(unclaimed, "local-only.txt"), "not on the remote\n")
    await target.git.add(unclaimed, ["."])
    await target.git.commit(unclaimed, "local only")
    const head = rawGit(unclaimed, target.sandbox.env, "rev-parse", "HEAD").trim()

    await expect(target.sync.openFromGit(url)).rejects.toThrow(/no workspace in this app claims it/)

    expect(rawGit(unclaimed, target.sandbox.env, "rev-parse", "HEAD").trim()).toBe(head)
    expect(fs.readFileSync(path.join(unclaimed, "local-only.txt"), "utf8")).toBe("not on the remote\n")
    expect(entries(target.cloneRoot)).toEqual([source.workspaceId])
    expect(target.repositories.workspaces.listAll().map((workspace) => workspace.workspaceId)).toEqual([target.workspaceId])
    expect(target.repositories.workspaceGit.get(source.workspaceId)).toBeUndefined()
  })

  it("refuses a repository whose id differs from a workspace here only in letter case, naming both", async () => {
    const flyer = openHarness()
    seed(flyer)
    const files = serializeWorkspace(snapshotOf(flyer))
    files.set("workspace.json", `${JSON.stringify({ ...(JSON.parse(files.get("workspace.json")!) as object), workspaceId: "abc" }, null, 2)}\n`)
    const target = openHarness()
    // On Windows and default macOS `abc` and `ABC` resolve to one directory, so the two must never both exist.
    target.repositories.workspaces.create({ workspaceId: "ABC", name: "Upper", slug: "upper", isPersonal: false })
    const upperClone = path.join(target.cloneRoot, "ABC")
    fs.mkdirSync(upperClone, { recursive: true })
    fs.writeFileSync(path.join(upperClone, "keep.txt"), "mine\n")

    await expect(target.sync.openFromGit(await publishFiles(target, "case", files))).rejects.toThrow(
      /Workspace ABC is already here and differs from abc only in letter case/,
    )

    expect(fs.readFileSync(path.join(upperClone, "keep.txt"), "utf8")).toBe("mine\n")
    expect(entries(target.cloneRoot)).toEqual(["ABC"])
    expect(target.repositories.workspaces.listAll().map((workspace) => workspace.workspaceId).sort()).toEqual(["ABC", target.workspaceId].sort())
  })

  it("returns the import's warnings with the opened workspace, for the caller to show", async () => {
    const source = openHarness()
    seed(source)
    // The import must repair the missing default, and says so.
    const [environment] = source.repositories.environments.listByWorkspace(source.workspaceId).items
    source.repositories.environments.update(environment!.environmentId, { isDefault: false })
    await source.sync.track(source.workspaceId)
    const remote = makeBareRemote(source.sandbox)
    await source.sync.connectRemote(source.workspaceId, remote.url)
    const target = openHarness()

    const result = await target.sync.openFromGit(remote.url)

    expect(result.kind).toBe("opened")
    expect(result.kind === "opened" ? result.warnings : []).toEqual([
      expect.stringContaining("No default environment was set"),
    ])
  })

  it("refuses to replace a clone when the database holds a binding for a workspace that is not there", async () => {
    const { source, url } = await publishedWorkspace()
    const target = openHarness()
    const orphan = path.join(target.cloneRoot, source.workspaceId)
    fs.mkdirSync(orphan, { recursive: true })
    fs.writeFileSync(path.join(orphan, "history.txt"), "the only copy\n")
    vi.spyOn(target.repositories.workspaceGit, "get").mockReturnValue({ ...binding(source, source.workspaceId) })

    await expect(target.sync.openFromGit(url)).rejects.toThrow(/refusing to replace its repository/)

    expect(fs.readFileSync(path.join(orphan, "history.txt"), "utf8")).toBe("the only copy\n")
    expect(entries(target.cloneRoot)).toEqual([source.workspaceId])
    expect(target.repositories.workspaces.listAll()).toHaveLength(1)
  })

  it("removes the clone it moved into place when the import fails, and creates no workspace", async () => {
    const { source, url } = await publishedWorkspace()
    const target = openHarness()
    vi.spyOn(target.repositories.workspaceGit, "setRemote").mockImplementation(() => {
      throw new Error("disk full")
    })

    await expect(target.sync.openFromGit(url)).rejects.toThrow("disk full")

    expectNothingCreated(target)
    expect(target.repositories.workspaceGit.get(source.workspaceId)).toBeUndefined()
    expect(target.repositories.collections.listByWorkspace(source.workspaceId).items).toEqual([])
  })

  it("removes the clone when the repository's records belong to another workspace here", async () => {
    const { url } = await publishedWorkspace()
    const target = openHarness()
    target.repositories.collections.create({ collectionId: "proj-main", workspaceId: target.workspaceId, name: "Mine" })

    await expect(target.sync.openFromGit(url)).rejects.toThrow(/already belong outside workspace/)

    expect(target.repositories.workspaces.listAll().map((workspace) => workspace.workspaceId)).toEqual([target.workspaceId])
    expect(entries(target.cloneRoot)).toEqual([])
  })

  describe("a repository that is not a workspace this build can open", () => {
    function validTree(): Map<string, string> {
      const source = openHarness()
      seed(source)
      return serializeWorkspace(snapshotOf(source))
    }

    it("refuses a newer format version, saying so", async () => {
      const files = validTree()
      files.set(".apiweave/format.json", `${JSON.stringify({ format: "apiweave-workspace", version: 2 })}\n`)
      const target = openHarness()

      await expect(target.sync.openFromGit(await publishFiles(target, "newer", files))).rejects.toThrow(
        /\.apiweave\/format\.json: version: this repository was written by a newer APIWeave/,
      )

      expectNothingCreated(target)
    })

    it.each([
      ["invalid JSON in workspace.json", "workspace.json", "{ not json", /^workspace\.json is not valid JSON/],
      ["a project file that fails its schema", "projects/main--proj-main.json", `${JSON.stringify({ projectId: "proj-main" })}\n`, /^projects\/main--proj-main\.json: /],
      ["a workflow file that fails its schema", "workflows/free-workflow--wf-free.json", "{}", /^workflows\/free-workflow--wf-free\.json: /],
    ])("refuses %s, naming the file", async (_label, file, text, message) => {
      const files = validTree()
      expect(files.has(file)).toBe(true)
      files.set(file, text)
      const target = openHarness()

      await expect(target.sync.openFromGit(await publishFiles(target, "malformed", files))).rejects.toThrow(message)

      expectNothingCreated(target)
    })

    it("refuses a repository with files but no .apiweave/format.json, as not a workspace", async () => {
      const target = openHarness()
      const url = await publishFiles(target, "readme-only", new Map([["README.md", "# Notes\n"]]))

      await expect(target.sync.openFromGit(url)).rejects.toThrow(NOT_A_WORKSPACE)

      expectNothingCreated(target)
    })

    it("refuses a repository with no commits at all, as not a workspace", async () => {
      const target = openHarness()

      await expect(target.sync.openFromGit(makeBareRemote(target.sandbox, "empty.git").url)).rejects.toThrow(NOT_A_WORKSPACE)

      expectNothingCreated(target)
    })

    it("refuses a repository whose default branch is not the one holding the workspace, and says what to change", async () => {
      const { bare, source } = await publishedWorkspace()
      rawGit(bare, source.sandbox.env, "symbolic-ref", "HEAD", "refs/heads/master")
      const target = openHarness()

      await expect(target.sync.openFromGit(pathToFileURL(bare).href)).rejects.toThrow(/default branch has nothing to check out/)

      expectNothingCreated(target)
    })

    // A fresh clone is always on a branch (git picks one even when the remote's HEAD is detached), so only a git that says otherwise reaches this.
    it("refuses a clone with no branch checked out, because the binding needs one", async () => {
      const { url } = await publishedWorkspace()
      const target = openHarness({
        wrap: (git) => ({ ...passthrough(git), status: async (directory) => ({ ...(await git.status(directory)), branch: undefined }) }),
      })

      await expect(target.sync.openFromGit(url)).rejects.toThrow("The repository has no branch checked out.")

      expectNothingCreated(target)
    })
  })

  it.each([
    ["a path that does not exist", (root: string) => pathToFileURL(path.join(root, "missing.git")).href],
    ["a folder that is not a repository", (root: string) => {
      const folder = path.join(root, "plain-folder")
      fs.mkdirSync(folder)
      return pathToFileURL(folder).href
    }],
  ])("rejects %s and leaves nothing behind", async (_label, urlFor) => {
    const target = openHarness()

    await expect(target.sync.openFromGit(urlFor(target.sandbox.root))).rejects.toThrow(/git clone failed/)

    expectNothingCreated(target)
  })

  it("refuses a URL that is not an accepted form before any git runs", async () => {
    const clone = vi.fn()
    const target = openHarness({ wrap: (git) => ({ ...passthrough(git), clone }) })

    await expect(target.sync.openFromGit("http://example.com/repo.git")).rejects.toThrow(/Plain http:\/\/ is not accepted/)
    await expect(target.sync.openFromGit("--upload-pack=touch x")).rejects.toThrow()

    expect(clone).not.toHaveBeenCalled()
    expect(fs.existsSync(target.cloneRoot)).toBe(false)
  })

  it("lets reconcile sweep the scratch clone of an open that crashed, and nothing else in the clone root", async () => {
    const target = openHarness()
    const stale = path.join(target.cloneRoot, ".open-0123abcd")
    fs.mkdirSync(path.join(stale, ".git"), { recursive: true })
    fs.writeFileSync(path.join(stale, "workspace.json"), "{}")
    const adopted = path.join(target.cloneRoot, "orphan-clone")
    fs.mkdirSync(adopted, { recursive: true })

    await target.sync.reconcile()

    expect(entries(target.cloneRoot)).toEqual(["orphan-clone"])
  })

  it("reconciles when there is no clone root yet", async () => {
    const target = openHarness()

    await expect(target.sync.reconcile()).resolves.toBeUndefined()

    expect(fs.existsSync(target.cloneRoot)).toBe(false)
  })
})
