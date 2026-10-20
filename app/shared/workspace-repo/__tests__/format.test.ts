import { describe, expect, it } from "vitest"
import { isTreePath } from "../format"

describe("isTreePath", () => {
  it.each([
    "workspace.json",
    "workflows/login--wf_login.json",
    ".github/workflows/x.yml",
    ".gitignore",
    ".gitattributes",
    ".gitmodules",
    "docs/.gitkeep",
    "gitfoo",
    "git",
    "git~2",
    ".git.foo/x",
    ".gitx",
    "docs/my.git",
  ])("accepts %j", (path) => {
    expect(isTreePath(path)).toBe(true)
  })

  it.each([
    ["an empty path", ""],
    ["an empty segment", "a//b.json"],
    ["a trailing slash", "docs/"],
    ["a `.` segment", "./workspace.json"],
    ["a `..` segment", "workflows/../../outside.json"],
    ["an absolute path", "/etc/passwd"],
    ["a drive letter", "C:/Users/me/x.json"],
    ["a drive-relative path", "C:x.json"],
    ["a backslash", "workflows\\login.json"],
    ["a UNC path", "\\\\server\\share\\x"],
    ["a NUL", "docs/a\0b"],
    ["`.git`", ".git/config"],
    ["`.git` deeper down", "docs/.git/config"],
    ["`.git` as a file", ".git"],
    ["`.git` in another case", ".GIT/config"],
    ["`.git` in mixed case", "docs/.GiT/info/attributes"],
    ["`.git` with a trailing dot", ".git./config"],
    ["`.git` with a trailing space", ".git /config"],
    ["`.git` with trailing dots and spaces", ".git. ./config"],
    ["the NTFS short name `git~1`", "git~1/config"],
    ["`GIT~1` in another case", "GIT~1/config"],
    ["`git~1` with a trailing dot", "git~1./config"],
    ["an NTFS stream on `.git`", ".git::$INDEX_ALLOCATION/config"],
    ["an NTFS stream on any file", "README.md:hidden"],
    ["a zero-width non-joiner inside `.git`", ".g\u200Cit/config"],
    ["a zero-width joiner inside `.git`", ".\u200Dgit/config"],
    ["a byte-order mark after `.git`", ".git\uFEFF/config"],
    ["a direction mark inside `.git`", ".gi\u202Et/config"],
  ])("refuses %s", (_, path) => {
    expect(isTreePath(path)).toBe(false)
  })
})
