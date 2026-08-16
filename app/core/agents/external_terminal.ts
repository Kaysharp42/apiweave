import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { resolveExecutable, spawnCommandFor } from "./executable"

export interface ExternalLaunch {
  /** Absolute path to the agent executable, already resolved. */
  readonly executablePath: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  /** Scratch directory APIWeave owns — for the POSIX launcher script. */
  readonly scratchDir: string
}

export class NoTerminalFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NoTerminalFoundError"
  }
}

/**
 * Open the user's terminal emulator running the agent in `cwd`.
 *
 * Phase 2 exists so the feature is useful before any native dependency lands,
 * and it stays afterwards as the fallback for when the PTY fails to load. The
 * launched terminal is not tracked: once it forks, the pid APIWeave spawned is
 * the emulator's, not the agent's, which is why an `external` session never
 * claims a live status.
 */
export async function launchInExternalTerminal(launch: ExternalLaunch): Promise<void> {
  if (process.platform === "win32") {
    await launchWindows(launch)
    return
  }
  await launchPosix(launch)
}

// ── Windows ───────────────────────────────────────────────────────────────

/**
 * Windows Terminal when it is there, the classic console when it is not.
 *
 * `wt.exe` ships with Windows 11 but is an optional install on 10, so the
 * fallback is not theoretical. Both paths spawn a real argv — `shell: true` is
 * never used, and `cmd.exe` appears only as an explicit interpreter for the
 * `.cmd` shims that Node cannot execute directly.
 */
async function launchWindows(launch: ExternalLaunch): Promise<void> {
  const env = { ...process.env, ...launch.env }
  const command = spawnCommandFor(launch.executablePath, launch.args, env)
  const windowsTerminal = resolveExecutable("wt.exe", env)

  if (windowsTerminal !== undefined) {
    await spawnDetached(
      windowsTerminal,
      ["-d", launch.cwd, command.file, ...command.args],
      { cwd: launch.cwd, env },
    )
    return
  }

  // `start` needs an explicit empty title, or it consumes the first quoted
  // argument as the window title and the agent never runs.
  await spawnDetached(
    env["COMSPEC"] ?? "cmd.exe",
    ["/c", "start", "", command.file, ...command.args],
    { cwd: launch.cwd, env },
  )
}

// ── macOS and Linux ───────────────────────────────────────────────────────

/**
 * Both platforms go through a generated `sh` script rather than the terminal's
 * own command flags.
 *
 * On macOS `open -a Terminal` cannot pass arguments or environment to the
 * program it opens at all — a script is the only way. On Linux every emulator
 * disagrees about its exec flag (`-e` takes one string in xfce4-terminal and an
 * argv in alacritty; gnome-terminal wants `--`), so handing each of them a
 * single file path sidesteps a table of per-emulator quoting rules that would
 * be wrong for whichever emulator was not tested.
 */
async function launchPosix(launch: ExternalLaunch): Promise<void> {
  const env = { ...process.env, ...launch.env }
  const scriptPath = writeLauncherScript(launch)
  if (process.platform === "darwin") {
    await spawnDetached("/usr/bin/open", ["-a", "Terminal", scriptPath], { cwd: launch.cwd, env })
    return
  }

  for (const terminal of LINUX_TERMINALS) {
    const resolved = resolveExecutable(terminal.command, env)
    if (resolved === undefined) {
      continue
    }
    await spawnDetached(resolved, terminal.argsFor(scriptPath), { cwd: launch.cwd, env })
    return
  }
  throw new NoTerminalFoundError(
    `No terminal emulator found. Tried: ${LINUX_TERMINALS.map((entry) => entry.command).join(", ")}`,
  )
}

interface LinuxTerminal {
  readonly command: string
  readonly argsFor: (scriptPath: string) => readonly string[]
}

/**
 * `x-terminal-emulator` first because on Debian-family systems it is the user's
 * own configured choice; the rest is a most-common-first probe.
 */
const LINUX_TERMINALS: readonly LinuxTerminal[] = [
  { command: "x-terminal-emulator", argsFor: (script) => ["-e", script] },
  { command: "gnome-terminal", argsFor: (script) => ["--", script] },
  { command: "konsole", argsFor: (script) => ["-e", script] },
  { command: "xfce4-terminal", argsFor: (script) => ["-e", script] },
  { command: "alacritty", argsFor: (script) => ["-e", script] },
  { command: "kitty", argsFor: (script) => [script] },
  { command: "wezterm", argsFor: (script) => ["start", "--", script] },
  { command: "xterm", argsFor: (script) => ["-e", script] },
]

function writeLauncherScript(launch: ExternalLaunch): string {
  fs.mkdirSync(launch.scratchDir, { recursive: true, mode: 0o700 })
  const scriptPath = path.join(launch.scratchDir, `launch-${Date.now()}.command`)
  const exports = Object.entries(launch.env).map(([key, value]) => `export ${key}=${shellQuote(value)}`)
  const script = [
    "#!/bin/sh",
    `cd ${shellQuote(launch.cwd)} || exit 1`,
    ...exports,
    `exec ${[launch.executablePath, ...launch.args].map(shellQuote).join(" ")}`,
    "",
  ].join("\n")
  fs.writeFileSync(scriptPath, script, { encoding: "utf8", mode: 0o700 })
  return scriptPath
}

/**
 * Single-quote everything and escape embedded quotes the POSIX way. Inside
 * single quotes `sh` expands nothing at all, so a path containing `$`, a space
 * or a backtick survives intact — which is the whole point of generating the
 * script instead of concatenating a command line.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Spawn detached and report whether the child actually came up.
 *
 * `spawn` delivers failures like `ENOENT` asynchronously, on the `error` event.
 * Without a listener Node promotes that event into an uncaught exception — in
 * the main process that is a crash, not a log line. The returned promise is
 * that listener: it rejects on `error` and resolves only once the child is
 * actually running.
 */
function spawnDetached(file: string, args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    })
    child.once("error", reject)
    child.once("spawn", () => {
      // Without this the terminal dies with APIWeave; the user asked for a
      // session in their own terminal, not one tethered to this app's
      // lifetime.
      child.unref()
      resolve()
    })
  })
}
