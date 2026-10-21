import { describe, expect, it } from "vitest"
import { ValidationError } from "../../ipc/errors"
import type { GitTreeContents, GitTreeListing } from "../git_types"
import { settleTreeEntries, withoutPaths } from "../tree_entries"

const COMMITS = { baseCommit: "b".repeat(40), ourCommit: "0".repeat(40), theirCommit: "f".repeat(40) }

function link(target: string, at = "docs/link"): GitTreeListing {
  return { path: at, oid: target.padEnd(40, "0"), mode: "120000", type: "blob", size: target.length }
}

/** A tree holding `entry` (a link or submodule), or `file` as a plain file's text, or nothing at `docs/link`; `README.md` always. */
function tree(slot: { entry?: GitTreeListing; file?: string } = {}): GitTreeContents {
  const files = new Map([["README.md", "# Shared\n"]])
  if (slot.file !== undefined) files.set("docs/link", slot.file)
  return { files, otherEntries: new Map(slot.entry === undefined ? [] : [[slot.entry.path, slot.entry]]) }
}

function settle(base: GitTreeContents, ours: GitTreeContents, theirs: GitTreeContents) {
  return settleTreeEntries({ base, ours, theirs }, COMMITS)
}

describe("settleTreeEntries", () => {
  const a = link("aaaa")
  const changed = link("cccc")

  it.each([
    ["held alike by all three", tree({ entry: a }), tree({ entry: a }), tree({ entry: a })],
    ["changed alike by both copies", tree({ entry: a }), tree({ entry: changed }), tree({ entry: changed })],
    ["removed by both copies", tree({ entry: a }), tree(), tree()],
    ["changed by your copy only", tree({ entry: a }), tree({ entry: changed }), tree({ entry: a })],
    ["replaced with a file by your copy only", tree({ entry: a }), tree({ file: "text\n" }), tree({ entry: a })],
    ["added by your copy only", tree(), tree({ entry: a }), tree()],
  ])("leaves out a link %s: your commit's entry stands", (_what, base, ours, theirs) => {
    expect(settle(base, ours, theirs)).toEqual({ paths: new Set(["docs/link"]), removals: [] })
  })

  it("removes one the remote removed and your copy left as it was", () => {
    expect(settle(tree({ entry: a }), tree({ entry: a }), tree())).toEqual({ paths: new Set(["docs/link"]), removals: ["docs/link"] })
  })

  it.each([
    ["added by the remote", tree(), tree(), tree({ entry: a }), COMMITS.theirCommit],
    ["changed by the remote", tree({ entry: a }), tree({ entry: a }), tree({ entry: changed }), COMMITS.theirCommit],
    ["changed differently by both copies", tree({ entry: a }), tree({ entry: link("dddd") }), tree({ entry: changed }), COMMITS.theirCommit],
    ["replaced with a file by the remote", tree({ entry: a }), tree({ entry: a }), tree({ file: "text\n" }), COMMITS.ourCommit],
    ["removed by the remote and changed by your copy", tree({ entry: a }), tree({ entry: changed }), tree(), COMMITS.ourCommit],
  ])("refuses a link %s, naming the path and a commit that holds it", (_what, base, ours, theirs, rev) => {
    expect(() => settle(base, ours, theirs)).toThrow(new RegExp(`^docs/link at ${rev} is a symbolic link, not a plain file`))
  })

  it("refuses an entry under git's own folder even where every copy holds it alike", () => {
    const planted = tree({ entry: link("aaaa", ".git/hooks/pre-commit") })
    expect(() => settle(planted, planted, planted)).toThrow(ValidationError)
    expect(() => settle(planted, planted, planted)).toThrow(/^\.git\/hooks\/pre-commit at f+ is not a path a repository may hold/)
  })

  it("leaves the plain files alone where no copy holds anything else", () => {
    expect(settle(tree(), tree(), tree({ file: "text\n" }))).toEqual({ paths: new Set(), removals: [] })
  })

  it("drops the settled paths from a copy's files", () => {
    expect(withoutPaths(new Map([["README.md", "x"], ["docs/link", "y"]]), new Set(["docs/link"]))).toEqual(new Map([["README.md", "x"]]))
  })
})
