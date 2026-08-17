import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ExternalLaunch } from "../external_terminal"
import {
  LAUNCHER_SCRATCH,
  launchInExternalTerminal,
  NoTerminalFoundError,
} from "../external_terminal"

/**
 * The successful-launch half of the external terminal, on every host. The
 * companion `external_terminal.test.ts` exercises the real failure paths
 * (ENOENT rejection, no emulator installed); these tests mock `spawn` so the
 * Windows, macOS and Linux branches can all be asserted here without a
 * terminal emulator, and `process.platform` is stubbed per test because the
 * branches — and `executable.ts` — read it directly.
 */

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

/** The pieces of the child `spawnDetached` interacts with. */
class FakeChild {
  private readonly listeners: [string, (value: unknown) => void][] = []
  readonly unref = vi.fn()
  once = (event: string, handler: (value: unknown) => void): this => {
    this.listeners.push([event, handler])
    return this
  }
  emit(event: string, value?: unknown): void {
    for (const [name, handler] of this.listeners) {
      if (name === event) handler(value)
    }
  }
}

let tempRoot: string

beforeEach(() => {
  // The mock is module-scoped, so without a reset every `mock.calls[0]`
  // assertion would be reading the previous test's launch.
  spawnMock.mockReset()
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-external-"))
})

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

function launch(overrides: Partial<ExternalLaunch> = {}): ExternalLaunch {
  return {
    executablePath: path.join(tempRoot, "agent.exe"),
    args: ["--prompt", "hello world"],
    cwd: path.join(tempRoot, "my project"),
    env: {},
    scratchDir: path.join(tempRoot, "scratch"),
    sessionId: "session-1",
    ...overrides,
  }
}

/**
 * macOS resolves the emulator against installed app bundles rather than trusting
 * `open -a` to fail loudly — it does not, because the detached spawn has already
 * resolved by the time `open` exits non-zero. A fake bundle under a fake `HOME`
 * is what lets that branch run on a Windows or Linux CI host.
 */
function makeFakeAppBundle(name: string): string {
  const bundle = path.join(tempRoot, "Applications", `${name}.app`)
  fs.mkdirSync(bundle, { recursive: true })
  return bundle
}

/** A real file on the fake PATH, so `resolveExecutable` genuinely finds it. */
function makeFakeExecutable(name: string): string {
  const filePath = path.join(tempRoot, name)
  fs.writeFileSync(filePath, "")
  fs.chmodSync(filePath, 0o755)
  return filePath
}

function cleanPathEnv(): Record<string, string> {
  return { PATH: "", Path: "" }
}

async function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = process.platform
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, "platform", { value: original, configurable: true })
  }
}

describe("launchInExternalTerminal — successful launches", () => {
  it("opens Windows Terminal with the working directory and the agent argv", async () => {
    await withPlatform("win32", async () => {
      const wt = makeFakeExecutable("wt.exe")
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({ env: { PATH: tempRoot, Path: tempRoot } })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("spawn")
      await done

      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock).toHaveBeenCalledWith(
        wt,
        ["-d", launchSpec.cwd, launchSpec.executablePath, ...launchSpec.args],
        expect.objectContaining({
          cwd: launchSpec.cwd,
          detached: true,
          stdio: "ignore",
        }),
      )
      expect(child.unref).toHaveBeenCalledTimes(1)
    })
  })

  it("falls back to the classic console through cmd.exe when wt.exe is absent", async () => {
    await withPlatform("win32", async () => {
      const comspec = makeFakeExecutable("cmd.exe")
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({
        env: { ...cleanPathEnv(), COMSPEC: comspec },
      })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("spawn")
      await done

      expect(spawnMock).toHaveBeenCalledWith(
        comspec,
        ["/c", "start", "", launchSpec.executablePath, ...launchSpec.args],
        expect.objectContaining({ detached: true }),
      )
    })
  })

  it("rejects with the spawn error instead of crashing when the terminal fails to start", async () => {
    await withPlatform("win32", async () => {
      makeFakeExecutable("wt.exe")
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({ env: { PATH: tempRoot, Path: tempRoot } })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("error", new Error("EACCES: permission denied"))
      await expect(done).rejects.toThrow("EACCES: permission denied")
    })
  })

  it("hands the first emulator found a launcher script on Linux", async () => {
    await withPlatform("linux", async () => {
      const emulator = makeFakeExecutable("x-terminal-emulator")
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({ env: { PATH: tempRoot, Path: tempRoot } })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("spawn")
      await done

      const script = readLauncherScript(launchSpec)
      expect(spawnMock).toHaveBeenCalledWith(
        emulator,
        ["-e", script],
        expect.objectContaining({ cwd: launchSpec.cwd, detached: true }),
      )
    })
  })

  it("writes a launcher script that quotes a hostile working directory and environment", async () => {
    await withPlatform("linux", async () => {
      makeFakeExecutable("x-terminal-emulator")
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({
        env: {
          PATH: tempRoot,
          Path: tempRoot,
          WEIRD: "it's $HOME `tick`",
        },
      })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("spawn")
      await done

      const script = fs.readFileSync(readLauncherScript(launchSpec), "utf8")
      expect(script).toMatch(/^#!\/bin\/sh\ncd '.*my project' \|\| exit 1$/m)
      expect(script).toContain("export WEIRD='it'\\''s $HOME `tick`'")
      expect(script).toContain(`exec '${launchSpec.executablePath}' '--prompt' 'hello world'`)
    })
  })

  it("goes through `open -a` with the installed Terminal bundle on macOS", async () => {
    await withPlatform("darwin", async () => {
      const bundle = makeFakeAppBundle("Terminal")
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({ env: { PATH: tempRoot, Path: tempRoot, HOME: tempRoot } })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("spawn")
      await done

      expect(spawnMock).toHaveBeenCalledWith(
        "/usr/bin/open",
        ["-a", bundle, readLauncherScript(launchSpec)],
        expect.objectContaining({ cwd: launchSpec.cwd }),
      )
    })
  })

  /**
   * `TERM_PROGRAM` is set by whichever emulator started APIWeave, so it names
   * the one the user actually lives in. Hardcoding Terminal.app ignored that
   * and dropped an iTerm user into a different terminal than the rest of their
   * work.
   */
  it("prefers the emulator named by TERM_PROGRAM when it is installed", async () => {
    await withPlatform("darwin", async () => {
      makeFakeAppBundle("Terminal")
      const iterm = makeFakeAppBundle("iTerm")
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({
        env: { PATH: tempRoot, Path: tempRoot, HOME: tempRoot, TERM_PROGRAM: "iTerm.app" },
      })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("spawn")
      await done

      expect(spawnMock.mock.calls[0]?.[1]).toEqual(["-a", iterm, readLauncherScript(launchSpec)])
    })
  })

  it("falls back past an uninstalled TERM_PROGRAM rather than opening nothing", async () => {
    await withPlatform("darwin", async () => {
      const terminal = makeFakeAppBundle("Terminal")
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({
        env: { PATH: tempRoot, Path: tempRoot, HOME: tempRoot, TERM_PROGRAM: "Ghostty" },
      })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("spawn")
      await done

      expect(spawnMock.mock.calls[0]?.[1]).toEqual(["-a", terminal, readLauncherScript(launchSpec)])
    })
  })

  /**
   * The failure `open -a Terminal` could never report. A detached spawn resolves
   * on `spawn`, long before `open` exits non-zero for a missing app, so the old
   * code told the user the agent had launched and nothing appeared.
   */
  it("raises NoTerminalFoundError on macOS when no terminal app is installed", async () => {
    await withPlatform("darwin", async () => {
      const launchSpec = launch({ env: { ...cleanPathEnv(), HOME: tempRoot } })
      await expect(launchInExternalTerminal(launchSpec)).rejects.toBeInstanceOf(NoTerminalFoundError)
      expect(spawnMock).not.toHaveBeenCalled()
      // And the script, which holds the agent's whole environment, does not
      // outlive the launch that failed.
      expect(fs.existsSync(path.join(launchSpec.scratchDir, LAUNCHER_SCRATCH.filename(launchSpec.sessionId)))).toBe(false)
    })
  })

  it("throws NoTerminalFoundError when no emulator exists, on any host", async () => {
    await withPlatform("linux", async () => {
      const launchSpec = launch({ env: cleanPathEnv() })
      await expect(launchInExternalTerminal(launchSpec)).rejects.toBeInstanceOf(
        NoTerminalFoundError,
      )
    })
  })
})

describe("launcher scripts — naming and cleanup", () => {
  /**
   * `launch-${Date.now()}.command` collided for two launches in the same
   * millisecond: both agents shared one file, and the second launch rewrote the
   * first one's exported environment out from under it.
   */
  it("names the script after the session, so simultaneous launches cannot collide", async () => {
    await withPlatform("linux", async () => {
      makeFakeExecutable("x-terminal-emulator")
      spawnMock.mockImplementation(() => {
        const child = new FakeChild()
        queueMicrotask(() => child.emit("spawn"))
        return child
      })
      const env = { PATH: tempRoot, Path: tempRoot }

      await Promise.all([
        launchInExternalTerminal(launch({ env, sessionId: "session-a" })),
        launchInExternalTerminal(launch({ env, sessionId: "session-b" })),
      ])

      const scratchDir = path.join(tempRoot, "scratch")
      expect(fs.readdirSync(scratchDir).sort()).toEqual(
        [LAUNCHER_SCRATCH.filename("session-a"), LAUNCHER_SCRATCH.filename("session-b")].sort(),
      )
    })
  })

  /**
   * Every script holds `export KEY=value` for each variable in the definition,
   * which is where a user puts an API key. Nothing deleted them before, so a
   * crash between spawn and the delayed unlink still leaves one for the sweep.
   */
  it("sweeps stale scripts and leaves the rest of the directory alone", () => {
    const scratchDir = path.join(tempRoot, "scratch")
    fs.mkdirSync(scratchDir, { recursive: true })
    fs.writeFileSync(path.join(scratchDir, LAUNCHER_SCRATCH.filename("old-a")), "#!/bin/sh\n")
    fs.writeFileSync(path.join(scratchDir, LAUNCHER_SCRATCH.filename("old-b")), "#!/bin/sh\n")
    fs.writeFileSync(path.join(scratchDir, "apiweave-mcp-old.json"), "{}")

    expect(LAUNCHER_SCRATCH.sweep(scratchDir)).toBe(2)
    expect(fs.readdirSync(scratchDir)).toEqual(["apiweave-mcp-old.json"])
  })

  it("deletes one session's script by id, and shrugs when it is already gone", () => {
    const scratchDir = path.join(tempRoot, "scratch")
    fs.mkdirSync(scratchDir, { recursive: true })
    fs.writeFileSync(path.join(scratchDir, LAUNCHER_SCRATCH.filename("session-1")), "#!/bin/sh\n")

    expect(LAUNCHER_SCRATCH.deleteOne(scratchDir, "session-1")).toBe(true)
    expect(fs.readdirSync(scratchDir)).toEqual([])
    expect(LAUNCHER_SCRATCH.deleteOne(scratchDir, "session-1")).toBe(true)
  })
})

/**
 * `wt.exe` re-parses its own command line, and a bare `;` there separates
 * subcommands: the tail of a prompt would open as a second tab running whatever
 * followed it. Process-level argv quoting cannot help, because the split happens
 * after Windows has un-quoted.
 */
describe("Windows Terminal argument escaping", () => {
  it("escapes semicolons so a prompt cannot open a second tab", async () => {
    await withPlatform("win32", async () => {
      const wt = makeFakeExecutable("wt.exe")
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({
        env: { PATH: tempRoot, Path: tempRoot },
        args: ["--prompt", "fix this; then run tests"],
      })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("spawn")
      await done

      const argv = spawnMock.mock.calls[0]?.[1] as string[]
      expect(spawnMock.mock.calls[0]?.[0]).toBe(wt)
      expect(argv).toContain("fix this\\; then run tests")
      expect(argv.some((value) => /(^|[^\\]);/.test(value))).toBe(false)
    })
  })
})

function readLauncherScript(launchSpec: ExternalLaunch): string {
  const scripts = fs.readdirSync(launchSpec.scratchDir).filter((name) => name.endsWith(".command"))
  expect(scripts).toHaveLength(1)
  const script = scripts[0]
  if (script === undefined) throw new Error("no launcher script was written")
  expect(script).toBe(LAUNCHER_SCRATCH.filename(launchSpec.sessionId))
  return path.join(launchSpec.scratchDir, script)
}
