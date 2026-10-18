import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  GitAuthFailedError,
  GitCommandError,
  GitError,
  GitInvalidArgumentError,
  GitNetworkError,
  GitNonFastForwardError,
  GitNotARepositoryError,
  GitNotInstalledError,
  GitPermissionDeniedError,
  GitTimeoutError,
} from "../git_errors"
import { GitService } from "../git_service"
import {
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
    expect(entries[0]?.authorDate).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/)
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
