import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { dirOf, headOf, remoteHead, binding, cloneText, headCommitOf, type SharedPair, sharedPair, pushFromElsewhere, type TreeBuilder, pushHandBuiltTree, ENTRY_PATH, pushEntryFromElsewhere, entryAt } from "./git_sync_devices"

describe("the sync cycle", () => {
  describe("a remote tree the merge must never write", () => {
    /** B holds a commit of its own, so the remote's next commit is merged rather than fast-forwarded over. */
    async function pairWithLocalWork(): Promise<SharedPair> {
      const pair = await sharedPair()
      pair.b.repositories.workflows.create({ workspaceId: pair.opened, name: "B local" })
      await pair.b.sync.commitLocal(pair.opened, { message: "B local" })
      return pair
    }

    it("refuses a remote commit that plants .git/config and .GIT/config, writes nothing, and runs no filter", async () => {
      const pair = await pairWithLocalWork()
      const { b, sandbox, remote, opened } = pair
      const dir = dirOf(b, opened)
      const configBefore = fs.readFileSync(path.join(dir, ".git", "config"), "utf8")
      const bHead = headOf(b, opened)
      const planted = pushHandBuiltTree(sandbox, remote, ({ blob, tree }) => {
        // A filter driver and the attributes that would run it on the next `git add`.
        const config = blob("[filter \"planted\"]\n\tclean = sh -c 'touch PLANTED_FILTER_RAN; cat'\n\tsmudge = sh -c 'touch PLANTED_FILTER_RAN; cat'\n")
        const info = tree([`100644 blob ${blob("* filter=planted\n")}\tattributes`])
        const gitFolder = tree([`100644 blob ${config}\tconfig`, `040000 tree ${info}\tinfo`])
        return [`040000 tree ${gitFolder}\t.git`, `040000 tree ${gitFolder}\t.GIT`]
      }, "Plant git's own config")

      const status = await b.sync.syncNow(opened)

      expect(status).toMatchObject({ state: "error", lastError: { code: null } })
      expect(status.lastError?.message).toMatch(/the remote copy's \.(git|GIT)\/config is not a path a repository may hold/)
      expect(fs.readFileSync(path.join(dir, ".git", "config"), "utf8")).toBe(configBefore)
      expect(fs.existsSync(path.join(dir, ".git", "info", "attributes"))).toBe(false)
      expect(fs.existsSync(path.join(dir, "PLANTED_FILTER_RAN"))).toBe(false)
      expect(headOf(b, opened)).toBe(bHead)
      expect(await b.git.status(dir)).toMatchObject({ clean: true })
      expect(binding(b, opened).integratingFrom).toBeNull()
      expect(b.repositories.workspaceGit.getMerge(opened)).toBeUndefined()
      expect(b.imports).toEqual([])
      expect(remoteHead(sandbox, remote.dir)).toBe(planted)
    })

    it.each([
      { what: "a symbolic link", kind: "a symbolic link", entry: (build: TreeBuilder) => `120000 blob ${build.blob("../../../outside")}\tlink` },
      { what: "a submodule", kind: "a submodule", entry: () => `160000 commit ${"a".repeat(40)}\tlink` },
    ])("refuses a remote commit that holds $what rather than merging it as a file", async ({ kind, entry }) => {
      const pair = await pairWithLocalWork()
      const { b, sandbox, remote, opened } = pair
      const dir = dirOf(b, opened)
      const bHead = headOf(b, opened)
      pushHandBuiltTree(sandbox, remote, (build) => [`040000 tree ${build.tree([entry(build)])}\tdocs`], "Add a link")

      const status = await b.sync.syncNow(opened)

      expect(status).toMatchObject({ state: "error", lastError: { code: null } })
      expect(status.lastError?.message).toMatch(new RegExp(`^docs/link at [0-9a-f]+ is ${kind}, not a plain file`))
      expect(fs.existsSync(path.join(dir, "docs"))).toBe(false)
      expect(headOf(b, opened)).toBe(bHead)
      expect(await b.git.status(dir)).toMatchObject({ clean: true })
      expect(b.imports).toEqual([])
    })
  })

  describe.each([
    {
      kind: "a symbolic link",
      entry: (blob: (text: string) => string) => `120000,${blob("../../../outside")}`,
      changed: (blob: (text: string) => string) => `120000,${blob("../elsewhere")}`,
      // Under core.symlinks=false git checks a link out as a plain file holding its target.
      onDisk: (file: string) => expect(fs.lstatSync(file).isFile() && fs.readFileSync(file, "utf8")).toBe("../../../outside"),
    },
    {
      kind: "a submodule",
      entry: () => `160000,${"a".repeat(40)}`,
      changed: () => `160000,${"b".repeat(40)}`,
      // And a submodule it never fetches as an empty folder.
      onDisk: (file: string) => expect(fs.readdirSync(file)).toEqual([]),
    },
  ])("$kind already in the history", ({ kind, entry, changed, onDisk }) => {
    /**
     * The remote gained the entry and B fast-forwarded over it, so it is in the
     * ancestor of every later merge; then B commits work of its own, so the
     * remote's next commit is merged rather than fast-forwarded over.
     */
    async function pairWithEntry(): Promise<SharedPair & { readonly dir: string; readonly line: string }> {
      const pair = await sharedPair()
      const { b, sandbox, remote, opened } = pair
      const dir = dirOf(b, opened)
      pushEntryFromElsewhere(sandbox, remote, entry, `Add ${kind}`)
      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "idle", lastError: null })
      const line = entryAt(dir, b.env, "HEAD")
      expect(line).toMatch(/^1[26]0000 /)
      b.repositories.workflows.create({ workspaceId: opened, name: "B local" })
      await b.sync.commitLocal(opened, { message: "B local" })
      // B's own commit staged the whole checkout and kept the entry as it was.
      expect(entryAt(dir, b.env, "HEAD")).toBe(line)
      return { ...pair, dir, line }
    }

    it("does not block a merge of other edits, and the merge commit keeps the entry unchanged", async () => {
      const pair = await pairWithEntry()
      const { b, sandbox, remote, opened, dir, line } = pair
      const bHead = headOf(b, opened)
      const theirs = pushFromElsewhere(sandbox, remote, { "README.md": "# Shared\n" }, "Add a readme")

      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "idle", lastError: null })

      const head = await headCommitOf(b, opened)
      expect(head.parents).toEqual([bHead, theirs])
      expect(entryAt(dir, b.env, "HEAD")).toBe(line)
      expect(entryAt(remote.dir, sandbox.env, "main")).toBe(line)
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
      expect(cloneText(b, opened, "README.md")).toBe("# Shared\n")
      onDisk(path.join(dir, ...ENTRY_PATH.split("/")))
      expect(await b.git.status(dir)).toMatchObject({ clean: true })
    })

    it("takes the remote's removal of it, though the ancestor still holds it", async () => {
      const pair = await pairWithEntry()
      const { b, sandbox, remote, opened, dir } = pair
      const bHead = headOf(b, opened)
      const theirs = pushEntryFromElsewhere(sandbox, remote, null, `Remove ${kind}`)

      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "idle", lastError: null })

      const head = await headCommitOf(b, opened)
      expect(head.parents).toEqual([bHead, theirs])
      expect(entryAt(dir, b.env, "HEAD")).toBe("")
      expect(remoteHead(sandbox, remote.dir)).toBe(head.sha)
      expect(fs.existsSync(path.join(dir, ...ENTRY_PATH.split("/")))).toBe(false)
      expect(await b.git.status(dir)).toMatchObject({ clean: true })
      expect(b.repositories.workflows.listByWorkspace(opened, true).items.map((workflow) => workflow.name)).toContain("B local")
    })

    it("refuses the remote's change to it, naming the path and writing nothing, until the remote removes it", async () => {
      const pair = await pairWithEntry()
      const { b, sandbox, remote, opened, dir, line } = pair
      const bHead = headOf(b, opened)
      const imports = b.imports.length
      const theirs = pushEntryFromElsewhere(sandbox, remote, changed, `Change ${kind}`)

      const refused = await b.sync.syncNow(opened)

      expect(refused).toMatchObject({ state: "error", lastError: { code: null } })
      expect(refused.lastError?.message).toMatch(new RegExp(`^${ENTRY_PATH} at ${theirs} is ${kind}, not a plain file, and the remote copy changed it`))
      expect(headOf(b, opened)).toBe(bHead)
      expect(entryAt(dir, b.env, "HEAD")).toBe(line)
      onDisk(path.join(dir, ...ENTRY_PATH.split("/")))
      expect(await b.git.status(dir)).toMatchObject({ clean: true })
      expect(b.imports).toHaveLength(imports)
      expect(remoteHead(sandbox, remote.dir)).toBe(theirs)

      // The way out is on the remote: once it drops the entry, the next sync merges.
      const removed = pushEntryFromElsewhere(sandbox, remote, null, `Remove ${kind}`)
      expect(await b.sync.syncNow(opened)).toMatchObject({ state: "idle", lastError: null })
      expect((await headCommitOf(b, opened)).parents).toEqual([bHead, removed])
      expect(entryAt(dir, b.env, "HEAD")).toBe("")
    })
  })
})
