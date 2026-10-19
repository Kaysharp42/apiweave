import { describe, expect, it } from "vitest"
import { parseAheadBehind, parseCommitCount, parseLog, parseStatus, parseVersion } from "../git_parse"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const MODE = "100644 100644 100644"
const HASHES = `${SHA_A} ${SHA_B}`

function record(...parts: string[]): string {
  return parts.map((part) => `${part}\0`).join("")
}

describe("parseStatus", () => {
  it("reads the branch header", () => {
    const status = parseStatus(
      record(
        `# branch.oid ${SHA_A}`,
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +3 -2",
      ),
    )
    expect(status).toMatchObject({ branch: "main", oid: SHA_A, upstream: "origin/main", ahead: 3, behind: 2, clean: true })
  })

  it("has no oid before the first commit and no branch when detached", () => {
    const unborn = parseStatus(record("# branch.oid (initial)", "# branch.head main"))
    expect(unborn).toMatchObject({ oid: undefined, branch: "main", upstream: undefined, ahead: 0, behind: 0 })
    expect(parseStatus(record(`# branch.oid ${SHA_A}`, "# branch.head (detached)")).branch).toBeUndefined()
  })

  it("parses changed, renamed, unmerged and untracked entries", () => {
    const status = parseStatus(
      record(
        "# branch.oid (initial)",
        "# branch.head main",
        `1 .M N... ${MODE} ${HASHES} workflows/get user--01.json`,
        `1 A. N... 000000 100644 100644 ${HASHES} added.json`,
        `2 R. N... ${MODE} ${HASHES} R100 new name.json`,
        "old name.json",
        `u UU N... 100644 100644 100644 100644 ${SHA_A} ${SHA_B} ${SHA_A} both.json`,
        "? untracked/dir/file.json",
      ),
    )
    expect(status.clean).toBe(false)
    expect(status.entries).toEqual([
      { kind: "changed", path: "workflows/get user--01.json", origPath: undefined, index: ".", worktree: "M" },
      { kind: "changed", path: "added.json", origPath: undefined, index: "A", worktree: "." },
      { kind: "renamed", path: "new name.json", origPath: "old name.json", index: "R", worktree: "." },
      { kind: "unmerged", path: "both.json", origPath: undefined, index: "U", worktree: "U" },
      { kind: "untracked", path: "untracked/dir/file.json", origPath: undefined, index: "?", worktree: "?" },
    ])
  })

  it("does not read a rename's original path as an entry of its own", () => {
    const status = parseStatus(record(`2 R. N... ${MODE} ${HASHES} R100 b.json`, "? a.json", "? c.json"))
    expect(status.entries.map((entry) => entry.path)).toEqual(["b.json", "c.json"])
  })

  it("keeps a path with a newline whole", () => {
    expect(parseStatus(record("? odd\nname.json")).entries[0]?.path).toBe("odd\nname.json")
  })
})

describe("parseLog", () => {
  /** Fields are NUL-separated inside a record; `-z` terminates each record with the same byte. */
  const log = (...fields: string[]) => `${fields.join("\x00")}\0`

  it("splits commits and fields, keeping a multiline body whole", () => {
    const entries = parseLog(
      log(SHA_A, SHA_B, "Ada", "ada@example.com", "2026-01-02T03:04:05+00:00", "Second", "Body line 1\nBody line 2\n") +
        log(SHA_B, "", "Bob", "bob@example.com", "2026-01-01T00:00:00+00:00", "First", ""),
    )
    expect(entries).toEqual([
      {
        sha: SHA_A,
        parents: [SHA_B],
        authorName: "Ada",
        authorEmail: "ada@example.com",
        authorDate: "2026-01-02T03:04:05+00:00",
        subject: "Second",
        body: "Body line 1\nBody line 2\n",
      },
      {
        sha: SHA_B,
        parents: [],
        authorName: "Bob",
        authorEmail: "bob@example.com",
        authorDate: "2026-01-01T00:00:00+00:00",
        subject: "First",
        body: "",
      },
    ])
  })

  it("lists every parent of a merge and ignores empty output", () => {
    expect(parseLog(log(SHA_A, HASHES, "A", "a@x", "d", "Merge", ""))[0]?.parents).toEqual([SHA_A, SHA_B])
    expect(parseLog("")).toEqual([])
  })

  it("keeps a subject and an author that carry the old separator", () => {
    const subject = `fix${"\x1f"}the unit separator`
    const authorName = `Ada${"\x1f"}Lovelace`
    const [entry] = parseLog(log(SHA_A, "", authorName, "ada@example.com", "d", subject, "body"))
    expect(entry).toMatchObject({ authorName, subject, body: "body" })
  })

  it("keeps a body's trailing spaces and blank lines", () => {
    const body = "line one  \n\n\nline two \n\n"
    expect(parseLog(log(SHA_A, "", "A", "a@x", "d", "S", body))[0]?.body).toBe(body)
  })

  it("keeps a body's unicode", () => {
    const body = "héllo 🌍 — naïve\n"
    expect(parseLog(log(SHA_A, "", "A", "a@x", "d", "S", body))[0]?.body).toBe(body)
  })
})

describe("parseVersion", () => {
  it("reads Git for Windows and Apple git", () => {
    expect(parseVersion("git version 2.55.0.windows.4\n")).toEqual({ raw: "2.55.0.windows.4", major: 2, minor: 55, patch: 0 })
    expect(parseVersion("git version 2.39.5 (Apple Git-154)\n")).toMatchObject({ raw: "2.39.5 (Apple Git-154)", major: 2, minor: 39, patch: 5 })
  })

  it("refuses anything else", () => {
    expect(parseVersion("command not found")).toBeUndefined()
  })
})

describe("parseAheadBehind", () => {
  it("reads the left and right counts", () => {
    expect(parseAheadBehind("3\t2\n")).toEqual({ ahead: 3, behind: 2 })
    expect(parseAheadBehind("0\t0\n")).toEqual({ ahead: 0, behind: 0 })
  })

  it("refuses anything else", () => {
    expect(parseAheadBehind("3 2\n")).toBeUndefined()
    expect(parseAheadBehind("")).toBeUndefined()
  })
})

describe("parseCommitCount", () => {
  it("reads one count", () => {
    expect(parseCommitCount("1\n")).toBe(1)
    expect(parseCommitCount("12")).toBe(12)
  })

  it("refuses anything else", () => {
    expect(parseCommitCount("1\t2\n")).toBeUndefined()
    expect(parseCommitCount("many\n")).toBeUndefined()
    expect(parseCommitCount("")).toBeUndefined()
  })
})
