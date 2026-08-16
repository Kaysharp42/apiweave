import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ExternalLaunch } from "../external_terminal"
import { launchInExternalTerminal, NoTerminalFoundError } from "../external_terminal"

const isWindows = process.platform === "win32"
const isLinux = process.platform === "linux"

let tempRoot: string

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-external-"))
})

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

function launch(env: Readonly<Record<string, string>>): ExternalLaunch {
  return {
    executablePath: path.join(tempRoot, "agent.exe"),
    args: [],
    cwd: tempRoot,
    env,
    scratchDir: path.join(tempRoot, "scratch"),
    sessionId: "session-under-test",
  }
}

describe("launchInExternalTerminal", () => {
  /**
   * `spawn` delivers ENOENT asynchronously, on the `error` event. Before the
   * listener existed, Node promoted that event to an uncaught exception and
   * killed the whole main process; the promise has to reject instead.
   *
   * Empty PATH keeps `wt.exe` from resolving, and a COMSPEC that does not exist
   * makes the `cmd.exe` fallback fail — no real terminal is touched.
   */
  it.runIf(isWindows)("rejects with the spawn error instead of leaving it unhandled", async () => {
    const env = {
      ...process.env,
      PATH: "",
      Path: "",
      COMSPEC: path.join(tempRoot, "no-such-cmd.exe"),
    }
    await expect(launchInExternalTerminal(launch(env))).rejects.toThrow(/ENOENT/)
  })

  /**
   * The one failure the launcher raises itself. Every emulator probe comes
   * back empty against an empty PATH, which is the same shape as a desktop
   * with no terminal installed at all.
   */
  it.runIf(isLinux)("throws NoTerminalFoundError when no emulator exists", async () => {
    const env = { ...process.env, PATH: "", Path: "" }
    await expect(launchInExternalTerminal(launch(env))).rejects.toBeInstanceOf(NoTerminalFoundError)
  })
})
