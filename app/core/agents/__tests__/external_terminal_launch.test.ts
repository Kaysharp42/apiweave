import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ExternalLaunch } from "../external_terminal"
import { launchInExternalTerminal, NoTerminalFoundError } from "../external_terminal"

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
    ...overrides,
  }
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

  it("goes through `open -a Terminal` on macOS", async () => {
    await withPlatform("darwin", async () => {
      const child = new FakeChild()
      spawnMock.mockReturnValue(child)
      const launchSpec = launch({ env: { PATH: tempRoot, Path: tempRoot } })

      const done = launchInExternalTerminal(launchSpec)
      child.emit("spawn")
      await done

      expect(spawnMock).toHaveBeenCalledWith(
        "/usr/bin/open",
        ["-a", "Terminal", readLauncherScript(launchSpec)],
        expect.objectContaining({ cwd: launchSpec.cwd }),
      )
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

function readLauncherScript(launchSpec: ExternalLaunch): string {
  const scripts = fs.readdirSync(launchSpec.scratchDir).filter((name) => name.endsWith(".command"))
  expect(scripts).toHaveLength(1)
  const script = scripts[0]
  if (script === undefined) throw new Error("no launcher script was written")
  return path.join(launchSpec.scratchDir, script)
}
