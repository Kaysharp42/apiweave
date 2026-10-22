import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readWorkspaceTree, treeTarget, writeWorkspaceTree } from "../workspace_tree"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-tree-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function put(relative: string, text: string): void {
  const file = path.join(dir, ...relative.split("/"))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

describe("readWorkspaceTree", () => {
  it("reads the format's root files and everything under the record folders, leaving the rest of the root alone", async () => {
    put(".apiweave/format.json", "format")
    put(".apiweave/cache.json", "not the format's")
    put(".gitattributes", "attributes")
    put("workspace.json", "workspace")
    put("projects/shop--p1.json", "project")
    put("workflows/login--w1.json", "workflow")
    put("workflows/notes.txt", "not json")
    put("workflows/archive/old--w2.json", "in a subfolder")
    put("environments/ci--e1.json", "environment")
    put("README.md", "docs")
    put(".git/config", "git")
    put("package.json", "someone else's")

    const files = await readWorkspaceTree(dir)

    // What the format does not know is read too, so that parseWorkspace refuses it by name.
    expect([...files.keys()]).toEqual([
      ".apiweave/format.json",
      ".gitattributes",
      "environments/ci--e1.json",
      "projects/shop--p1.json",
      "workflows/archive/old--w2.json",
      "workflows/login--w1.json",
      "workflows/notes.txt",
      "workspace.json",
    ])
  })

  it("refuses a file over the size limit before reading it, naming the path", async () => {
    put("workflows/big--w1.json", "x".repeat(10 * 1024 * 1024 + 1))

    await expect(readWorkspaceTree(dir)).rejects.toThrow(/workflows\/big--w1\.json is 10485761 bytes; a repository file may be at most 10485760/)
  })

  it("refuses a tree over its byte limit while it reads, naming the file that crossed it", async () => {
    put("projects/a--p1.json", "x".repeat(30))
    put("workflows/b--w1.json", "y".repeat(30))

    await expect(readWorkspaceTree(dir, { maxTotalBytes: 50 })).rejects.toThrow(
      /workflows\/b--w1\.json pushes the repository over its 50-byte limit \(60 bytes in total\); at most 50 are read/,
    )
  })

  it("refuses a tree with more files than the limit, naming the file past it", async () => {
    put("projects/a--p1.json", "1")
    put("projects/b--p2.json", "1")
    put("workflows/c--w1.json", "1")

    await expect(readWorkspaceTree(dir, { maxFiles: 2 })).rejects.toThrow(
      /workflows\/c--w1\.json pushes the repository over its 2-file limit; at most 2 files are read/,
    )
  })

  it("names a root file that is a folder, instead of failing with EISDIR", async () => {
    fs.mkdirSync(path.join(dir, "workspace.json"))

    await expect(readWorkspaceTree(dir)).rejects.toThrow(/^workspace\.json: must be a plain file/)
  })

  it("does not follow a link out of the tree", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-outside-"))
    try {
      fs.writeFileSync(path.join(outside, "staging--e9.json"), "elsewhere")
      fs.symlinkSync(outside, path.join(dir, "environments"), "junction")
      await expect(readWorkspaceTree(dir)).rejects.toThrow(/^environments: must be a plain folder/)

      fs.unlinkSync(path.join(dir, "environments"))
      fs.mkdirSync(path.join(dir, "environments"))
      fs.symlinkSync(outside, path.join(dir, "environments", "linked"), "junction")
      await expect(readWorkspaceTree(dir)).rejects.toThrow(/^environments\/linked: must be a plain file/)
      expect(fs.existsSync(path.join(outside, "staging--e9.json"))).toBe(true)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
  it("returns what is there when files are missing, and nothing for an empty folder", async () => {
    expect(await readWorkspaceTree(dir)).toEqual(new Map())
    put("workspace.json", "workspace")
    expect([...(await readWorkspaceTree(dir)).keys()]).toEqual(["workspace.json"])
  })

  it("writeWorkspaceTree refuses a path into .git or out of the tree before writing anything", async () => {
    for (const bad of [".git/config", ".GIT/config", "../outside.json"]) {
      await expect(writeWorkspaceTree(dir, new Map([["workspace.json", "{}\n"], [bad, "[core]\n"]]))).rejects.toThrow(
        `${bad}: is not a path a repository may hold`,
      )
    }

    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("treeTarget resolves a path inside the tree, and refuses one into .git in any spelling or out of the tree", () => {
    expect(treeTarget(dir, "docs/notes.md")).toBe(path.join(path.resolve(dir), "docs", "notes.md"))
    for (const bad of [".git/config", ".GIT/config", ".git./info/attributes", "git~1/config", "docs/.git/hooks/x", "../outside.json", "a/../../outside.json"]) {
      expect(() => treeTarget(dir, bad)).toThrow(`${bad}: is not a path a repository may hold`)
    }
  })

  it("reads back what writeWorkspaceTree wrote", async () => {
    const files = new Map([
      [".apiweave/format.json", "{}\n"],
      [".gitattributes", "* text eol=lf\n"],
      ["projects/shop--p1.json", "{}\n"],
      ["workspace.json", "{}\n"],
    ])

    await writeWorkspaceTree(dir, files)

    expect(await readWorkspaceTree(dir)).toEqual(files)
  })
})
