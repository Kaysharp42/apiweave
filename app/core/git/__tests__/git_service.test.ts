import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  GitAuthFailedError,
  GitCommandError,
  GitError,
  GitIdentityMissingError,
  GitInvalidArgumentError,
  GitNetworkError,
  GitNonFastForwardError,
  GitNotARepositoryError,
  GitNotInstalledError,
  GitPermissionDeniedError,
  GitTimeoutError,
  isNoSuchRemote,
} from "../git_errors"
import { GitService } from "../git_service"
import {
  anonymousService,
  closedPortUrl,
  listen,
  makeBareRemote,
  makeSandbox,
  makeTempDir,
  rawGit,
  writeFile,
  type GitSandbox,
} from "./git_test_utils"

/** Identity for the raw git commands that set up and prove things outside the service. */
const WHO = ["-c", "user.name=t", "-c", "user.email=t@e.invalid"]

/** A repository on `main` with one commit, and the path it lives at. */
async function repoWithCommit(sandbox: GitSandbox, name = "repo"): Promise<string> {
  const dir = path.join(sandbox.root, name)
  await sandbox.service.init(dir, { initialBranch: "main" })
  writeFile(dir, "a.json", '{"v":1}\n')
  await sandbox.service.add(dir, ["a.json"])
  await sandbox.service.commit(dir, "first")
  return dir
}

describe("version", () => {
  it("reports the installed git", async () => {
    const version = await makeSandbox().service.version()
    expect(version.major).toBeGreaterThanOrEqual(2)
    expect(version.raw).toMatch(/^\d+\.\d+/)
  })

  it("throws GitNotInstalledError, with an install link, when the PATH has no git", async () => {
    const empty = makeTempDir()
    const service = new GitService({ hooksDir: empty, env: { PATH: empty }, platform: "win32" })
    const error = await service.version().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitNotInstalledError)
    expect(error).toMatchObject({ code: "git_not_installed", installUrl: "https://git-scm.com/download/win" })
  })

  it("reports a missing binary the same way for every command", async () => {
    const empty = makeTempDir()
    const service = new GitService({ hooksDir: empty, env: { PATH: empty }, platform: "darwin" })
    const error = await service.status(empty).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitNotInstalledError)
    expect(error).toMatchObject({ installUrl: "https://git-scm.com/download/mac" })
  })

  it("does not mistake a missing working directory for a missing git", async () => {
    const sandbox = makeSandbox()
    await expect(sandbox.service.status(path.join(sandbox.root, "nowhere"))).rejects.toBeInstanceOf(GitNotARepositoryError)
  })
})

describe("local repository", () => {
  it("inits, stages, commits and reads the status back", async () => {
    const { service, root } = makeSandbox()
    const dir = path.join(root, "nested", "repo")
    await service.init(dir, { initialBranch: "main" })

    writeFile(dir, "a.json", "{}\n")
    let status = await service.status(dir)
    expect(status).toMatchObject({ branch: "main", oid: undefined, clean: false })
    expect(status.entries).toEqual([{ kind: "untracked", path: "a.json", origPath: undefined, index: "?", worktree: "?" }])

    await service.add(dir, ["a.json"])
    const sha = await service.commit(dir, "first commit")
    expect(sha).toMatch(/^[0-9a-f]{40}$/)

    status = await service.status(dir)
    expect(status).toMatchObject({ branch: "main", oid: sha, clean: true })
  })

  it("lists nested untracked files individually next to edits", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    fs.mkdirSync(path.join(dir, "projects"))
    writeFile(dir, path.join("projects", "p.json"), "{}\n")
    writeFile(dir, "a.json", '{"v":2}\n')
    const status = await sandbox.service.status(dir)
    expect(status.entries.map((entry) => [entry.kind, entry.path, entry.worktree])).toEqual([
      ["changed", "a.json", "M"],
      ["untracked", "projects/p.json", "?"],
    ])
  })

  it("reports a staged rename with its original path, and a staged deletion", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    const body = Array.from({ length: 20 }, (_, line) => `"line${line}": ${line}`).join(",\n")
    writeFile(dir, "big.json", `{\n${body}\n}\n`)
    await sandbox.service.add(dir, ["big.json"])
    await sandbox.service.commit(dir, "big")

    fs.renameSync(path.join(dir, "big.json"), path.join(dir, "moved.json"))
    fs.rmSync(path.join(dir, "a.json"))
    await sandbox.service.add(dir, ["big.json", "moved.json", "a.json"])
    const entries = (await sandbox.service.status(dir)).entries
    expect(entries.find((entry) => entry.kind === "renamed")).toMatchObject({ path: "moved.json", origPath: "big.json", index: "R" })
    expect(entries.find((entry) => entry.path === "a.json")).toMatchObject({ kind: "changed", index: "D" })
  })

  it("returns undefined when there is nothing to commit", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    expect(await sandbox.service.commit(dir, "again")).toBeUndefined()
    expect(await sandbox.service.commit(dir, "empty on purpose", { allowEmpty: true })).toMatch(/^[0-9a-f]{40}$/)
  })

  it("puts every path after --, so a file named like an option is a file", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    writeFile(dir, "-f.json", "{}\n")
    writeFile(dir, "--all", "{}\n")
    await sandbox.service.add(dir, ["-f.json", "--all"])
    const status = await sandbox.service.status(dir)
    expect(status.entries.map((entry) => [entry.path, entry.index])).toEqual([
      ["--all", "A"],
      ["-f.json", "A"],
    ])
  })

  it("treats a path as literal, never as a glob", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    writeFile(dir, "b.json", "{}\n")
    await sandbox.service.add(dir, ["*.json"]).catch(() => undefined)
    const status = await sandbox.service.status(dir)
    expect(status.entries.map((entry) => [entry.path, entry.index])).toEqual([["b.json", "?"]])
  })

  it("refuses add with no paths", async () => {
    const sandbox = makeSandbox()
    await expect(sandbox.service.add(sandbox.root, [])).rejects.toBeInstanceOf(GitInvalidArgumentError)
  })

  it("throws GitNotARepositoryError outside a repository", async () => {
    const sandbox = makeSandbox()
    const error = await sandbox.service.status(sandbox.root).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitNotARepositoryError)
    expect(error).toMatchObject({ code: "not_a_repository", details: { exitCode: 128 } })
  })

  it("throws a plain GitCommandError, with git's words, for a failure it has no class for", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    const error = await sandbox.service.mergeAbort(dir).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitCommandError)
    expect((error as GitCommandError).details.stderr).toMatch(/no merge to abort/i)
  })
})

describe("author", () => {
  it("throws GitIdentityMissingError rather than guessing an author from the login and host", async () => {
    const sandbox = makeSandbox()
    const service = anonymousService(sandbox)
    const dir = path.join(sandbox.root, "repo")
    await service.init(dir, { initialBranch: "main" })
    writeFile(dir, "a.json", "{}\n")
    await service.add(dir, ["a.json"])

    const error = await service.commit(dir, "first").catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GitIdentityMissingError)
    expect(error).toMatchObject({ code: "identity_missing" })
  })

  it("sets the author in the repository's own config, and commits under it", async () => {
    const sandbox = makeSandbox()
    const service = anonymousService(sandbox)
    const dir = path.join(sandbox.root, "repo")
    await service.init(dir, { initialBranch: "main" })
    writeFile(dir, "a.json", "{}\n")
    await service.add(dir, ["a.json"])

    await service.setIdentity(dir, { name: "  -Ada Lovelace ", email: "ada@example.invalid" })
    await service.commit(dir, "first")

    expect((await service.log(dir))[0]).toMatchObject({ authorName: "-Ada Lovelace", authorEmail: "ada@example.invalid" })
    expect(rawGit(dir, sandbox.env, "config", "--local", "--get", "user.name").trim()).toBe("-Ada Lovelace")
    expect(fs.readFileSync(path.join(sandbox.root, "global.gitconfig"), "utf8")).toBe("")
  })

  it("refuses an author git would refuse, before git is started", async () => {
    const sandbox = makeSandbox()
    await expect(sandbox.service.setIdentity(sandbox.root, { name: "Ada <x>", email: "a@e.invalid" })).rejects.toBeInstanceOf(GitInvalidArgumentError)
    await expect(sandbox.service.setIdentity(sandbox.root, { name: "Ada", email: " " })).rejects.toBeInstanceOf(GitInvalidArgumentError)
  })
})

describe("history", () => {
  async function twoCommits(sandbox: GitSandbox): Promise<{ dir: string; first: string; second: string }> {
    const dir = await repoWithCommit(sandbox)
    const first = (await sandbox.service.revParse(dir, "HEAD")) ?? ""
    writeFile(dir, "a.json", '{"v":2}\n')
    await sandbox.service.add(dir, ["a.json"])
    const second = (await sandbox.service.commit(dir, "second\n\nwith a body")) ?? ""
    return { dir, first, second }
  }

  it("logs newest first with parents, author, subject and body", async () => {
    const sandbox = makeSandbox()
    const { dir, first, second } = await twoCommits(sandbox)
    const entries = await sandbox.service.log(dir)
    expect(entries.map((entry) => entry.sha)).toEqual([second, first])
    expect(entries[0]).toMatchObject({
      parents: [first],
      authorName: "APIWeave Test",
      authorEmail: "test@example.invalid",
      subject: "second",
      body: "with a body\n",
    })
    expect(entries[1]).toMatchObject({ parents: [], subject: "first", body: "" })
    // git prints `Z` when the author's offset is zero, a numeric offset otherwise.
    expect(entries[0]?.authorDate).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$/)
  })

  it("honours maxCount, a revision and a path", async () => {
    const sandbox = makeSandbox()
    const { dir, first } = await twoCommits(sandbox)
    expect(await sandbox.service.log(dir, { maxCount: 1 })).toHaveLength(1)
    expect((await sandbox.service.log(dir, { rev: first })).map((entry) => entry.sha)).toEqual([first])
    writeFile(dir, "b.json", "{}\n")
    await sandbox.service.add(dir, ["b.json"])
    await sandbox.service.commit(dir, "third")
    expect((await sandbox.service.log(dir, { path: "b.json" })).map((entry) => entry.subject)).toEqual(["third"])
  })

  it("has an empty log before the first commit", async () => {
    const sandbox = makeSandbox()
    const dir = path.join(sandbox.root, "unborn")
    await sandbox.service.init(dir, { initialBranch: "main" })
    expect(await sandbox.service.log(dir)).toEqual([])
    expect(await sandbox.service.revParse(dir, "HEAD")).toBeUndefined()
  })

  it("rev-parses, merge-bases and shows", async () => {
    const sandbox = makeSandbox()
    const { dir, first, second } = await twoCommits(sandbox)
    expect(await sandbox.service.revParse(dir, "HEAD~1")).toBe(first)
    expect(await sandbox.service.revParse(dir, "no-such-ref")).toBeUndefined()
    expect(await sandbox.service.mergeBase(dir, first, second)).toBe(first)
    expect(await sandbox.service.show(dir, first, "a.json")).toBe('{"v":1}\n')
    expect(await sandbox.service.show(dir, second, "a.json")).toBe('{"v":2}\n')
    expect(await sandbox.service.show(dir, second, "missing.json")).toBeUndefined()
  })

  it("has no merge base for unrelated histories", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    const base = (await sandbox.service.revParse(dir, "HEAD")) ?? ""
    rawGit(dir, sandbox.env, "checkout", "--orphan", "other")
    rawGit(dir, sandbox.env, ...WHO, "commit", "--allow-empty", "-m", "unrelated")
    expect(await sandbox.service.mergeBase(dir, base, "other")).toBeUndefined()
  })

  it("resets hard to a revision", async () => {
    const sandbox = makeSandbox()
    const { dir, first } = await twoCommits(sandbox)
    writeFile(dir, "a.json", "dirty\n")
    await sandbox.service.resetHard(dir, first)
    expect(fs.readFileSync(path.join(dir, "a.json"), "utf8")).toBe('{"v":1}\n')
    expect(await sandbox.service.revParse(dir, "HEAD")).toBe(first)
    writeFile(dir, "a.json", "dirty again\n")
    await sandbox.service.resetHard(dir)
    expect(fs.readFileSync(path.join(dir, "a.json"), "utf8")).toBe('{"v":1}\n')
  })

  it("fast-forwards to a descendant, treats an ancestor as a no-op, and refuses a sibling", async () => {
    const sandbox = makeSandbox()
    const { dir, first, second } = await twoCommits(sandbox)
    rawGit(dir, sandbox.env, "checkout", "-b", "side")
    writeFile(dir, "b.json", "{}\n")
    await sandbox.service.add(dir, ["b.json"])
    const side = (await sandbox.service.commit(dir, "side")) ?? ""
    rawGit(dir, sandbox.env, "checkout", "-b", "sibling", second)
    writeFile(dir, "c.json", "{}\n")
    await sandbox.service.add(dir, ["c.json"])
    const sibling = (await sandbox.service.commit(dir, "sibling")) ?? ""
    rawGit(dir, sandbox.env, "checkout", "main")

    await sandbox.service.mergeFastForward(dir, side)
    expect(await sandbox.service.revParse(dir, "HEAD")).toBe(side)

    await sandbox.service.mergeFastForward(dir, side)
    await sandbox.service.mergeFastForward(dir, second)
    expect(await sandbox.service.revParse(dir, "HEAD")).toBe(side)

    await expect(sandbox.service.mergeFastForward(dir, sibling)).rejects.toBeInstanceOf(GitCommandError)
    expect(await sandbox.service.revParse(dir, "HEAD")).toBe(side)
    expect((await sandbox.service.status(dir)).clean).toBe(true)
    expect(first).not.toBe(side)
    expect(sibling).not.toBe(side)
  })

  it("counts each side's commits in one call, and says zero when a side has no commit", async () => {
    const sandbox = makeSandbox()
    const remote = makeBareRemote(sandbox)
    const dir = await repoWithCommit(sandbox)
    await sandbox.service.remoteAdd(dir, "origin", remote.url)
    await sandbox.service.push(dir, "origin", "main", { setUpstream: true })
    const other = path.join(sandbox.root, "other")
    await sandbox.service.clone(remote.url, other)
    writeFile(other, "b.json", "{}\n")
    await sandbox.service.add(other, ["b.json"])
    await sandbox.service.commit(other, "theirs")
    await sandbox.service.push(other, "origin", "main")

    await sandbox.service.fetch(dir, "origin")
    expect(await sandbox.service.countAheadBehind(dir, "HEAD", "origin/main")).toEqual({ ahead: 0, behind: 1 })

    writeFile(dir, "c.json", "{}\n")
    await sandbox.service.add(dir, ["c.json"])
    await sandbox.service.commit(dir, "ours")
    expect(await sandbox.service.countAheadBehind(dir, "HEAD", "origin/main")).toEqual({ ahead: 1, behind: 1 })

    expect(await sandbox.service.countAheadBehind(dir, "HEAD", "origin/no-such-branch")).toEqual({ ahead: 0, behind: 0 })
    const unborn = path.join(sandbox.root, "unborn")
    await sandbox.service.init(unborn, { initialBranch: "main" })
    expect(await sandbox.service.countAheadBehind(unborn, "HEAD", "origin/main")).toEqual({ ahead: 0, behind: 0 })
    await expect(sandbox.service.countAheadBehind(dir, "--output=pwned", "HEAD")).rejects.toBeInstanceOf(GitInvalidArgumentError)
    expect(fs.existsSync(path.join(dir, "pwned"))).toBe(false)
  })

  it("counts the commits a revision reaches, and refuses a revision that reads as an option", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    writeFile(dir, "b.json", "{}\n")
    await sandbox.service.add(dir, ["b.json"])
    await sandbox.service.commit(dir, "second")

    expect(await sandbox.service.countCommits(dir, "HEAD")).toBe(2)
    expect(await sandbox.service.countCommits(dir, "HEAD~1")).toBe(1)

    await expect(sandbox.service.countCommits(dir, "--output=pwned")).rejects.toBeInstanceOf(GitInvalidArgumentError)
    expect(fs.existsSync(path.join(dir, "pwned"))).toBe(false)
  })

  it("aborts a merge in progress", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    rawGit(dir, sandbox.env, "checkout", "-b", "side")
    writeFile(dir, "a.json", "side\n")
    rawGit(dir, sandbox.env, ...WHO, "commit", "-am", "side")
    rawGit(dir, sandbox.env, "checkout", "main")
    writeFile(dir, "a.json", "main\n")
    rawGit(dir, sandbox.env, ...WHO, "commit", "-am", "main")
    expect(() => rawGit(dir, sandbox.env, ...WHO, "merge", "side")).toThrow()
    expect((await sandbox.service.status(dir)).entries.some((entry) => entry.kind === "unmerged")).toBe(true)

    await sandbox.service.mergeAbort(dir)
    expect((await sandbox.service.status(dir)).clean).toBe(true)
  })

  it("refuses a revision that would be read as an option", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    await expect(sandbox.service.log(dir, { rev: "--output=pwned.txt" })).rejects.toBeInstanceOf(GitInvalidArgumentError)
    await expect(sandbox.service.show(dir, "--output=pwned.txt", "a.json")).rejects.toBeInstanceOf(GitInvalidArgumentError)
    expect(fs.existsSync(path.join(dir, "pwned.txt"))).toBe(false)
  })
})

describe("remotes", () => {
  it("pushes to a bare file:// remote and clones it back", async () => {
    const sandbox = makeSandbox()
    const remote = makeBareRemote(sandbox)
    const dir = await repoWithCommit(sandbox)
    await sandbox.service.remoteAdd(dir, "origin", remote.url)
    await sandbox.service.push(dir, "origin", "main", { setUpstream: true })

    const clone = path.join(sandbox.root, "deep", "clone")
    await sandbox.service.clone(remote.url, clone, { branch: "main" })
    expect(fs.readFileSync(path.join(clone, "a.json"), "utf8")).toBe('{"v":1}\n')
    expect(await sandbox.service.status(clone)).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 0, behind: 0 })
  })

  it("clones a link the repository carries as a plain file holding its target", async () => {
    const sandbox = makeSandbox()
    const remote = makeBareRemote(sandbox)
    const dir = await repoWithCommit(sandbox)
    writeFile(dir, "target.txt", "../outside")
    const blob = rawGit(dir, sandbox.env, "hash-object", "-w", "target.txt").trim()
    rawGit(dir, sandbox.env, "update-index", "--add", "--cacheinfo", `120000,${blob},link`)
    rawGit(dir, sandbox.env, ...WHO, "commit", "-m", "a link")
    await sandbox.service.remoteAdd(dir, "origin", remote.url)
    await sandbox.service.push(dir, "origin", "main")

    const clone = path.join(sandbox.root, "clone")
    await sandbox.service.clone(remote.url, clone)

    expect(fs.lstatSync(path.join(clone, "link")).isFile()).toBe(true)
    expect(fs.readFileSync(path.join(clone, "link"), "utf8")).toBe("../outside")
  })

  it("fast-forwards over a link the remote gained as a plain file too", async () => {
    const sandbox = makeSandbox()
    const remote = makeBareRemote(sandbox)
    const dir = await repoWithCommit(sandbox)
    await sandbox.service.remoteAdd(dir, "origin", remote.url)
    await sandbox.service.push(dir, "origin", "main")
    const clone = path.join(sandbox.root, "clone")
    await sandbox.service.clone(remote.url, clone)
    writeFile(dir, "target.txt", "../outside")
    const blob = rawGit(dir, sandbox.env, "hash-object", "-w", "target.txt").trim()
    rawGit(dir, sandbox.env, "update-index", "--add", "--cacheinfo", `120000,${blob},workflows`)
    rawGit(dir, sandbox.env, ...WHO, "commit", "-m", "a link where a folder belongs")
    await sandbox.service.push(dir, "origin", "main")

    await sandbox.service.fetch(clone, "origin")
    await sandbox.service.mergeFastForward(clone, "origin/main")

    expect(fs.lstatSync(path.join(clone, "workflows")).isFile()).toBe(true)
    expect(fs.readFileSync(path.join(clone, "workflows"), "utf8")).toBe("../outside")
  })

  it("fetches new commits and reports behind", async () => {
    const sandbox = makeSandbox()
    const remote = makeBareRemote(sandbox)
    const dir = await repoWithCommit(sandbox)
    await sandbox.service.remoteAdd(dir, "origin", remote.url)
    await sandbox.service.push(dir, "origin", "main", { setUpstream: true })
    const other = path.join(sandbox.root, "other")
    await sandbox.service.clone(remote.url, other)
    writeFile(other, "b.json", "{}\n")
    await sandbox.service.add(other, ["b.json"])
    await sandbox.service.commit(other, "from other")
    await sandbox.service.push(other, "origin", "main")

    await sandbox.service.fetch(dir, "origin")
    expect(await sandbox.service.status(dir)).toMatchObject({ ahead: 0, behind: 1 })
    expect(await sandbox.service.revParse(dir, "origin/main")).toBe(await sandbox.service.revParse(other, "HEAD"))
  })

  it("re-points a remote with set-url", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    const first = makeBareRemote(sandbox, "one.git")
    const second = makeBareRemote(sandbox, "two.git")
    await sandbox.service.remoteAdd(dir, "origin", first.url)
    await sandbox.service.remoteSetUrl(dir, "origin", second.url)
    expect(rawGit(dir, sandbox.env, "remote", "get-url", "origin").trim()).toBe(second.url)
  })

  it("removes a remote with its fetched branches, and reports a remote that is not there", async () => {
    const sandbox = makeSandbox()
    const remote = makeBareRemote(sandbox)
    const dir = await repoWithCommit(sandbox)
    await sandbox.service.remoteAdd(dir, "origin", remote.url)
    await sandbox.service.push(dir, "origin", "main")
    await sandbox.service.fetch(dir, "origin")

    await sandbox.service.remoteRemove(dir, "origin")

    expect(rawGit(dir, sandbox.env, "remote").trim()).toBe("")
    expect(await sandbox.service.revParse(dir, "origin/main")).toBeUndefined()
    const error = await sandbox.service.remoteRemove(dir, "origin").catch((caught: unknown) => caught)
    expect(isNoSuchRemote(error)).toBe(true)
  })

  it("names one branch fetched from a remote, or none for an empty one", async () => {
    const sandbox = makeSandbox()
    const remote = makeBareRemote(sandbox)
    const dir = await repoWithCommit(sandbox)
    await sandbox.service.remoteAdd(dir, "origin", remote.url)
    await sandbox.service.fetch(dir, "origin")
    expect(await sandbox.service.firstRemoteRef(dir, "origin")).toBeUndefined()

    await sandbox.service.push(dir, "origin", "main")
    await sandbox.service.fetch(dir, "origin")
    expect(await sandbox.service.firstRemoteRef(dir, "origin")).toMatch(/^refs\/remotes\/origin\/(?:HEAD|main)$/)
  })

  it("throws GitNonFastForwardError when the remote has moved on", async () => {
    const sandbox = makeSandbox()
    const remote = makeBareRemote(sandbox)
    const dir = await repoWithCommit(sandbox)
    await sandbox.service.remoteAdd(dir, "origin", remote.url)
    await sandbox.service.push(dir, "origin", "main")
    const other = path.join(sandbox.root, "other")
    await sandbox.service.clone(remote.url, other)
    writeFile(other, "b.json", "{}\n")
    await sandbox.service.add(other, ["b.json"])
    await sandbox.service.commit(other, "ahead")
    await sandbox.service.push(other, "origin", "main")

    writeFile(dir, "c.json", "{}\n")
    await sandbox.service.add(dir, ["c.json"])
    await sandbox.service.commit(dir, "diverged")
    const error = await sandbox.service.push(dir, "origin", "main").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitNonFastForwardError)
    expect(error).toMatchObject({ code: "non_fast_forward" })
  })

  it("throws GitPermissionDeniedError on a 403", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    const server = await listen((_request, response) => {
      response.writeHead(403)
      response.end("forbidden")
    })
    await sandbox.service.remoteAdd(dir, "origin", server.url)
    const error = await sandbox.service.fetch(dir, "origin").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitPermissionDeniedError)
    expect((error as GitPermissionDeniedError).details.stderr).toMatch(/error: 403/)
  })

  it("throws GitNetworkError when nothing is listening", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    await sandbox.service.remoteAdd(dir, "origin", await closedPortUrl())
    await expect(sandbox.service.fetch(dir, "origin")).rejects.toBeInstanceOf(GitNetworkError)
  })

  it("never lets a credential in the URL reach the error", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    const url = (await closedPortUrl()).replace("http://", "http://octocat:ghp_hunter2@")
    await sandbox.service.remoteAdd(dir, "origin", url)
    const error = await sandbox.service.fetch(dir, "origin").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitError)
    expect(JSON.stringify({ message: (error as GitError).message, details: (error as GitNetworkError).details })).not.toContain("hunter2")
  })

  it("leaves a remote path that is no repository as a plain command error", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    await sandbox.service.remoteAdd(dir, "origin", path.join(sandbox.root, "does-not-exist.git"))
    const error = await sandbox.service.fetch(dir, "origin").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitCommandError)
    expect(error).not.toBeInstanceOf(GitAuthFailedError)
  })
})

describe("timeouts", () => {
  it("kills a fetch that outlives its timeout and throws GitTimeoutError", async () => {
    const sandbox = makeSandbox({ timeouts: { fetch: 1500 } })
    const dir = await repoWithCommit(sandbox)
    const server = await listen(() => undefined)
    await sandbox.service.remoteAdd(dir, "origin", server.url)

    const started = Date.now()
    const error = await sandbox.service.fetch(dir, "origin").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitTimeoutError)
    expect((error as GitTimeoutError).message).toContain("timed out after 1500 ms")
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it("applies the override to that command only", async () => {
    const sandbox = makeSandbox({ timeouts: { fetch: 1 } })
    const dir = await repoWithCommit(sandbox)
    expect((await sandbox.service.status(dir)).clean).toBe(true)
  })
})

describe("remote URL rejection", () => {
  const hostile = ["--upload-pack=touch pwned", "-oProxyCommand=touch pwned", "ext::sh -c touch% pwned", "EXT::sh -c id"]

  it("rejects before git is ever started", async () => {
    // A service whose git cannot start: only a check that runs first can produce an invalid-argument error.
    const empty = makeTempDir()
    const service = new GitService({ hooksDir: empty, env: { PATH: empty } })
    for (const url of hostile) {
      await expect(service.clone(url, path.join(empty, "dest"))).rejects.toBeInstanceOf(GitInvalidArgumentError)
      await expect(service.remoteAdd(empty, "origin", url)).rejects.toBeInstanceOf(GitInvalidArgumentError)
      await expect(service.remoteSetUrl(empty, "origin", url)).rejects.toBeInstanceOf(GitInvalidArgumentError)
    }
  })

  it("leaves no trace of the command it was asked to run", async () => {
    const sandbox = makeSandbox()
    const marker = path.join(sandbox.root, "pwned")
    await sandbox.service.clone(`ext::sh -c touch% ${marker.replaceAll("\\", "/")}`, path.join(sandbox.root, "dest")).catch(() => undefined)
    expect(fs.existsSync(marker)).toBe(false)
  })
})

describe("ref name rejection", () => {
  it("rejects an invalid branch or remote name before git is ever started", async () => {
    // A service whose git cannot start: only a check that runs first can produce an invalid-argument error.
    const empty = makeTempDir()
    const service = new GitService({ hooksDir: empty, env: { PATH: empty } })
    const safeUrl = "https://example.com/r.git"
    await expect(service.fetch(empty, "..")).rejects.toBeInstanceOf(GitInvalidArgumentError)
    await expect(service.push(empty, "origin", "x@{1}")).rejects.toBeInstanceOf(GitInvalidArgumentError)
    await expect(service.clone(safeUrl, path.join(empty, "dest"), { branch: "a/../b" })).rejects.toBeInstanceOf(GitInvalidArgumentError)
    await expect(service.remoteAdd(empty, "bad//name", safeUrl)).rejects.toBeInstanceOf(GitInvalidArgumentError)
    await expect(service.remoteSetUrl(empty, "a.lock", safeUrl)).rejects.toBeInstanceOf(GitInvalidArgumentError)
    await expect(service.init(empty, { initialBranch: "trailing." })).rejects.toBeInstanceOf(GitInvalidArgumentError)
  })
})

describe("hooks", () => {
  function installPreCommitHook(dir: string, marker: string): void {
    const hook = path.join(dir, ".git", "hooks", "pre-commit")
    fs.writeFileSync(hook, `#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\nexit 0\n`, { mode: 0o755 })
  }

  it("does not run a repository hook, though the same hook runs under plain git", async () => {
    const sandbox = makeSandbox()
    const dir = await repoWithCommit(sandbox)
    const marker = path.join(sandbox.root, "hook-ran.txt")
    installPreCommitHook(dir, marker)

    // Control: without the flag the hook fires, so the assertion below is not vacuous.
    rawGit(dir, sandbox.env, ...WHO, "commit", "--allow-empty", "-m", "control")
    expect(fs.existsSync(marker)).toBe(true)
    fs.rmSync(marker)

    writeFile(dir, "a.json", '{"v":3}\n')
    await sandbox.service.add(dir, ["a.json"])
    expect(await sandbox.service.commit(dir, "through the service")).toMatch(/^[0-9a-f]{40}$/)
    expect(fs.existsSync(marker)).toBe(false)
  })

  it("does not run a hook from a global hooks directory either", async () => {
    const sandbox = makeSandbox()
    const globalHooks = path.join(sandbox.root, "global-hooks")
    fs.mkdirSync(globalHooks)
    const marker = path.join(sandbox.root, "global-hook-ran.txt")
    fs.writeFileSync(path.join(globalHooks, "pre-commit"), `#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\n`, { mode: 0o755 })
    fs.writeFileSync(path.join(sandbox.root, "global.gitconfig"), `[core]\n\thooksPath = ${globalHooks.replaceAll("\\", "/")}\n`)
    const dir = await repoWithCommit(sandbox)

    rawGit(dir, sandbox.env, ...WHO, "commit", "--allow-empty", "-m", "control")
    expect(fs.existsSync(marker)).toBe(true)
    fs.rmSync(marker)

    await sandbox.service.commit(dir, "through the service", { allowEmpty: true })
    expect(fs.existsSync(marker)).toBe(false)
  })
})

describe("LC_ALL=C", () => {
  it("keeps stderr in English whatever locale the caller inherited", async () => {
    const sandbox = makeSandbox({
      env: { LC_ALL: "fr_FR.UTF-8", LC_MESSAGES: "fr_FR.UTF-8", LANG: "fr_FR.UTF-8", LANGUAGE: "fr" },
    })
    const error = await sandbox.service.status(sandbox.root).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitNotARepositoryError)
    expect((error as GitNotARepositoryError).details.stderr).toContain("fatal: not a git repository")
  })
})

describe("reading a tree without a checkout", () => {
  /** A repository whose one commit holds files in two folders, a file with spaces and accents, an empty file and a copy of another. */
  async function treeRepo(sandbox: GitSandbox): Promise<string> {
    const dir = path.join(sandbox.root, "tree")
    await sandbox.service.init(dir, { initialBranch: "main" })
    fs.mkdirSync(path.join(dir, "workflows", "nested"), { recursive: true })
    fs.mkdirSync(path.join(dir, "other"))
    writeFile(dir, "workflows/a b é.json", '{"name":"héllo ✓"}\n')
    writeFile(dir, "workflows/nested/deep.json", '{"deep":true}\n')
    writeFile(dir, "workflows/empty.json", "")
    writeFile(dir, "workflows/copy.json", '{"deep":true}\n')
    writeFile(dir, "workspace.json", '{"id":1}\n')
    writeFile(dir, "other/x.json", "{}\n")
    await sandbox.service.add(dir, ["."])
    await sandbox.service.commit(dir, "tree")
    return dir
  }

  const blobOf = (sandbox: GitSandbox, dir: string, file: string): string => rawGit(dir, sandbox.env, "rev-parse", `HEAD:${file}`).trim()

  it("lists a commit's files recursively under the paths asked for, with their blob ids", async () => {
    const sandbox = makeSandbox()
    const dir = await treeRepo(sandbox)

    const entries = await sandbox.service.lsTree(dir, "HEAD", ["workflows", "workspace.json", "nothing-here"])

    expect(entries.map((entry) => entry.path).sort()).toEqual([
      "workflows/a b é.json",
      "workflows/copy.json",
      "workflows/empty.json",
      "workflows/nested/deep.json",
      "workspace.json",
    ])
    for (const entry of entries) expect(entry.oid).toBe(blobOf(sandbox, dir, entry.path))
  })

  it("refuses no paths and a revision that reads as an option", async () => {
    const sandbox = makeSandbox()
    const dir = await treeRepo(sandbox)

    await expect(sandbox.service.lsTree(dir, "HEAD", [])).rejects.toBeInstanceOf(GitInvalidArgumentError)
    await expect(sandbox.service.lsTree(dir, "--help", ["workflows"])).rejects.toBeInstanceOf(GitInvalidArgumentError)
  })

  it("reads many blobs in one git call, multi-byte text, an empty file and a repeated id included", async () => {
    const sandbox = makeSandbox()
    const dir = await treeRepo(sandbox)
    const accented = blobOf(sandbox, dir, "workflows/a b é.json")
    const deep = blobOf(sandbox, dir, "workflows/nested/deep.json")
    const empty = blobOf(sandbox, dir, "workflows/empty.json")
    const missing = "0".repeat(40)

    const blobs = await sandbox.service.readBlobs(dir, [accented, deep, empty, deep, missing])

    expect(blobs.get(accented)).toBe('{"name":"héllo ✓"}\n')
    expect(blobs.get(deep)).toBe('{"deep":true}\n')
    expect(blobs.get(empty)).toBe("")
    expect(blobs.has(missing)).toBe(true)
    expect(blobs.get(missing)).toBeUndefined()
    expect(blobs.size).toBe(4)
    expect(await sandbox.service.readBlobs(dir, [])).toEqual(new Map())
  })

  it("refuses an id that is not a full hex id, before it reaches git's stdin", async () => {
    const sandbox = makeSandbox()
    const dir = await treeRepo(sandbox)
    const real = blobOf(sandbox, dir, "workspace.json")

    for (const bad of ["HEAD", `${real}\nHEAD`, real.slice(0, 10), real.toUpperCase(), "-p"]) {
      await expect(sandbox.service.readBlobs(dir, [real, bad])).rejects.toBeInstanceOf(GitInvalidArgumentError)
    }
  })

  it("cleans untracked files and folders under the paths it is given, and nothing else", async () => {
    const sandbox = makeSandbox()
    const dir = await treeRepo(sandbox)
    fs.mkdirSync(path.join(dir, "workflows", "stray-dir"))
    writeFile(dir, "workflows/stray.json", "{}\n")
    writeFile(dir, "workflows/stray-dir/inner.json", "{}\n")
    writeFile(dir, "other/untracked.json", "{}\n")
    writeFile(dir, "workflows/copy.json", "edited\n")

    await sandbox.service.clean(dir, ["workflows"])

    expect(fs.existsSync(path.join(dir, "workflows", "stray.json"))).toBe(false)
    expect(fs.existsSync(path.join(dir, "workflows", "stray-dir"))).toBe(false)
    // A tracked file, even edited, and an untracked one outside the paths stay.
    expect(fs.readFileSync(path.join(dir, "workflows", "copy.json"), "utf8")).toBe("edited\n")
    expect(fs.existsSync(path.join(dir, "other", "untracked.json"))).toBe(true)
    await expect(sandbox.service.clean(dir, [])).rejects.toBeInstanceOf(GitInvalidArgumentError)
  })
})
