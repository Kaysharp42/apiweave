import { describe, expect, it } from "vitest"
import { assertRefName, assertRevision, assertSafeRemoteUrl } from "../git_arguments"
import { GitInvalidArgumentError } from "../git_errors"
import { DEFAULT_TIMEOUTS_MS, awaitWithin, execGit, gitConfigArgs, gitEnvironment, timeoutFor } from "../git_process"

describe("gitConfigArgs", () => {
  it("carries the seven settings, each as its own -c", () => {
    expect(gitConfigArgs("/app/empty-hooks")).toEqual([
      "-c",
      "core.hooksPath=/app/empty-hooks",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.symlinks=false",
      "-c",
      "protocol.ext.allow=never",
      "-c",
      "credential.interactive=auto",
      "-c",
      "user.useConfigOnly=true",
    ])
  })
})

describe("gitEnvironment", () => {
  it("forces the quiet, English environment over whatever was inherited", () => {
    const env = gitEnvironment({ PATH: "/bin", LC_ALL: "fr_FR.UTF-8", GIT_TERMINAL_PROMPT: "1", GIT_OPTIONAL_LOCKS: "1" })
    expect(env).toMatchObject({ PATH: "/bin", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_LFS_SKIP_SMUDGE: "1", LC_ALL: "C" })
  })

  it("drops variables that would aim git at another repository", () => {
    const env = gitEnvironment({ GIT_DIR: "/elsewhere/.git", GIT_WORK_TREE: "/elsewhere", GIT_INDEX_FILE: "/elsewhere/index" })
    expect(env).not.toHaveProperty("GIT_DIR")
    expect(env).not.toHaveProperty("GIT_WORK_TREE")
    expect(env).not.toHaveProperty("GIT_INDEX_FILE")
  })

  it("does not mutate what it was given", () => {
    const base = { LC_ALL: "de_DE.UTF-8" }
    gitEnvironment(base)
    expect(base).toEqual({ LC_ALL: "de_DE.UTF-8" })
  })
})

describe("timeoutFor", () => {
  it("gives network commands longer than local ones", () => {
    for (const command of ["fetch", "push", "clone"] as const) {
      expect(timeoutFor(command, {})).toBe(DEFAULT_TIMEOUTS_MS.network)
    }
    for (const command of ["status", "add", "commit", "log", "show", "version"] as const) {
      expect(timeoutFor(command, {})).toBe(DEFAULT_TIMEOUTS_MS.local)
    }
    expect(DEFAULT_TIMEOUTS_MS.network).toBeGreaterThan(DEFAULT_TIMEOUTS_MS.local)
  })

  it("lets a caller override one command", () => {
    expect(timeoutFor("fetch", { fetch: 50 })).toBe(50)
    expect(timeoutFor("push", { fetch: 50 })).toBe(DEFAULT_TIMEOUTS_MS.network)
  })
})

describe("awaitWithin", () => {
  it("settles when the work never does", async () => {
    const started = Date.now()
    await awaitWithin(new Promise(() => undefined), 50)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it("settles as soon as the work does, well inside the bound", async () => {
    await expect(awaitWithin(Promise.resolve("done"), 60_000)).resolves.toBeUndefined()
  })

  it("swallows a rejection from the work", async () => {
    await expect(awaitWithin(Promise.reject(new Error("kill failed")), 60_000)).resolves.toBeUndefined()
  })
})

describe("execGit", () => {
  it("kills a child that outlives its timeout and still resolves", async () => {
    const outcome = await execGit(process.execPath, ["-e", "setTimeout(() => undefined, 60_000)"], {
      cwd: undefined,
      env: process.env,
      timeoutMs: 250,
    })
    expect(outcome).toMatchObject({ status: "timeout", exitCode: undefined, stdout: "", stderr: "" })
  })

  it("streams stderr as it comes, and on a cancel kills the whole tree — a grandchild included — and resolves cancelled", async () => {
    // A parent that starts a grandchild, says its pid, and waits: what a sign-in's gh or glab waiting for a code looks like.
    const parent = [
      "const { spawn } = require('node:child_process')",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' })",
      "process.stderr.write('grandchild ' + child.pid + '\\n')",
      "setInterval(() => undefined, 1000)",
    ].join(";")
    const controller = new AbortController()
    let grandchild: number | undefined
    const started = Date.now()

    const outcome = await execGit(process.execPath, ["-e", parent], {
      cwd: undefined,
      env: process.env,
      timeoutMs: 60_000,
      signal: controller.signal,
      onStderr: (text) => {
        const pid = /grandchild (\d+)/.exec(text)?.[1]
        if (pid === undefined) return
        grandchild = Number(pid)
        controller.abort()
      },
    })

    expect(outcome).toMatchObject({ status: "cancelled", exitCode: undefined })
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(grandchild).toBeDefined()
    const alive = (): boolean => {
      try {
        process.kill(grandchild ?? 0, 0)
        return true
      } catch {
        return false
      }
    }
    // POSIX has no tree kill: there the grandchild is the tool's own to reap, as git's helpers are.
    if (process.platform === "win32") {
      for (let tries = 0; alive() && tries < 50; tries++) await new Promise((resolve) => setTimeout(resolve, 100))
      expect(alive()).toBe(false)
    } else if (alive()) {
      process.kill(grandchild ?? 0)
    }
  }, 30_000)

  it("resolves cancelled at once for a signal already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const outcome = await execGit(process.execPath, ["-e", "setTimeout(() => undefined, 60_000)"], {
      cwd: undefined,
      env: process.env,
      timeoutMs: 60_000,
      signal: controller.signal,
    })
    expect(outcome.status).toBe("cancelled")
  })
})

describe("argument checks", () => {
  it.each([
    "--upload-pack=touch /tmp/pwned",
    "-oProxyCommand=touch /tmp/pwned",
    "-u",
    " --upload-pack=x",
    "ext::sh -c touch% /tmp/pwned",
    "EXT::sh -c id",
    "  ext::sh -c id",
    "",
    "https://example.com/r.git\n--upload-pack=x",
  ])("refuses the remote URL %j", (url) => {
    expect(() => assertSafeRemoteUrl(url)).toThrow(GitInvalidArgumentError)
  })

  it.each(["https://github.com/acme/api.git", "git@github.com:acme/api.git", "file:///tmp/remote.git", "C:\\repos\\api.git", "/srv/git/api.git", "ssh://git@host:2222/x.git"])(
    "accepts the remote URL %s",
    (url) => {
      expect(() => assertSafeRemoteUrl(url)).not.toThrow()
    },
  )

  it("refuses a revision that is an option", () => {
    expect(() => assertRevision("--output=x")).toThrow(GitInvalidArgumentError)
    expect(() => assertRevision("")).toThrow(GitInvalidArgumentError)
    expect(() => assertRevision("HEAD~2")).not.toThrow()
    expect(() => assertRevision("origin/main..HEAD")).not.toThrow()
    expect(() => assertRevision("main:workflows/a.json")).not.toThrow()
  })

  it("refuses a branch or remote name that is an option, a refspec or has whitespace", () => {
    for (const name of ["-f", "--force", "main:other", "a b", "", "a\nb"]) {
      expect(() => assertRefName(name)).toThrow(GitInvalidArgumentError)
    }
    expect(() => assertRefName("feature/x-1")).not.toThrow()
    expect(() => assertRefName("origin")).not.toThrow()
  })

  it.each(["..", "x..y", "feature/..", "@{1}", "feature/x@{1}", "/leading", "trailing/", "a//b", "a.lock", "dir/nested.lock", "x/y.lock/z", "trailing.", ".", "a\tb", "a\u007fb"])(
    "refuses the branch or remote name %j, which is not a valid ref name",
    (name) => {
      expect(() => assertRefName(name)).toThrow(GitInvalidArgumentError)
    },
  )

  it.each(["main", "release-1.0", "feature/x", "origin", "v1.0.0", "notes.lock.b", "upstream/deep/nested"])(
    "accepts the branch or remote name %s",
    (name) => {
      expect(() => assertRefName(name)).not.toThrow()
    },
  )
})
