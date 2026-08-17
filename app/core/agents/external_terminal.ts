import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveExecutable, spawnCommandFor } from "./executable"
import { scratchFileKind } from "./scratch_files"

export interface ExternalLaunch {
  /** Absolute path to the agent executable, already resolved. */
  readonly executablePath: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  /** Scratch directory APIWeave owns — for the POSIX launcher script. */
  readonly scratchDir: string
  /** Owns the generated script's name and therefore its cleanup. */
  readonly sessionId: string
}

export class NoTerminalFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NoTerminalFoundError"
  }
}

/**
 * The launcher-script scratch kind. `deleteOne` drops a script for a launch
 * that never reached an emulator; `sweep` reclaims scripts left by a previous
 * run — every one of them holds the launched agent's environment in plain
 * text, and before the TTL unlink existed none of them was ever deleted. A
 * crash between spawn and unlink still leaves one, so the sweep stays even
 * now that the happy path cleans up after itself.
 */
export const LAUNCHER_SCRATCH = scratchFileKind("launch-", ".command")

/**
 * How long the generated script survives after the emulator has been spawned.
 *
 * It cannot be deleted synchronously: `spawnDetached` resolves when the
 * *emulator* starts, and the emulator has not read the script yet — on macOS
 * `open` has not even handed it to Terminal.app. It must not be kept either:
 * the script contains `export KEY=value` for every variable in the definition,
 * which is where a user puts an API key. Ten seconds is far longer than any
 * emulator takes to exec the file and far shorter than the session it starts.
 */
const SCRIPT_TTL_MS = 10_000

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
      ["-d", ...[launch.cwd, command.file, ...command.args].map(escapeWindowsTerminalArg)],
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

/**
 * `wt.exe` re-parses its own command line before exec'ing anything, and a bare
 * `;` there is a *subcommand separator*: `wt -d C:\x agent --prompt "a; b"`
 * opens one tab running `agent --prompt "a`, then a second tab running `b"`.
 * Process-level argv quoting does not help, because the split happens inside
 * `wt` after Windows has already un-quoted. Its documented escape is a
 * backslash, which is why this is applied per argument rather than to a joined
 * string — the argv array is still what reaches `spawn`.
 */
function escapeWindowsTerminalArg(value: string): string {
  return value.replaceAll(";", "\\;")
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
  try {
    if (process.platform === "darwin") {
      await launchMacos(launch, scriptPath, env)
    } else {
      await launchLinux(launch, scriptPath, env)
    }
  } catch (error) {
    // Nothing consumed the script, so it can go immediately rather than
    // sitting out the TTL with the agent's environment in it.
    fs.rmSync(scriptPath, { force: true })
    throw error
  }
  scheduleScriptCleanup(scriptPath)
}

/**
 * The user's own terminal, then iTerm, then Terminal.app.
 *
 * Hardcoding `open -a Terminal` was wrong in both directions. It ignored the
 * emulator the user actually lives in — `TERM_PROGRAM` names it, and APIWeave
 * launched from iTerm inherits it — and it failed *silently* when Terminal.app
 * was absent or renamed, because `open` exits non-zero long after the detached
 * spawn has already resolved. Existence is checked against the app bundle on
 * disk instead, so a missing emulator raises the same `NoTerminalFoundError`
 * that Linux has always raised rather than opening nothing at all.
 */
async function launchMacos(launch: ExternalLaunch, scriptPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  const candidates = macosTerminalApps(env)
  for (const app of candidates) {
    const bundle = findMacosApp(app, env)
    if (bundle === undefined) {
      continue
    }
    await spawnDetached("/usr/bin/open", ["-a", bundle, scriptPath], { cwd: launch.cwd, env })
    return
  }
  throw new NoTerminalFoundError(`No terminal application found. Tried: ${candidates.join(", ")}`)
}

async function launchLinux(launch: ExternalLaunch, scriptPath: string, env: NodeJS.ProcessEnv): Promise<void> {
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

/**
 * `TERM_PROGRAM` is set by the emulator that started the process, so it names
 * the one the user chose — but it names it in the emulator's own spelling
 * (`Apple_Terminal`, `iTerm.app`, `ghostty`), not as a bundle name. The known
 * ones are mapped; anything else is tried with `.app` stripped, which is right
 * often enough to be worth attempting and costs a `statSync` when it is not.
 */
const TERM_PROGRAM_APPS: Readonly<Record<string, string>> = {
  Apple_Terminal: "Terminal",
  "iTerm.app": "iTerm",
  iTerm: "iTerm",
  WezTerm: "WezTerm",
  Hyper: "Hyper",
  ghostty: "Ghostty",
  Alacritty: "Alacritty",
  kitty: "kitty",
  WarpTerminal: "Warp",
  Tabby: "Tabby",
}

const MACOS_FALLBACK_APPS: readonly string[] = ["iTerm", "Terminal"]

function macosTerminalApps(env: NodeJS.ProcessEnv): readonly string[] {
  const declared = env["TERM_PROGRAM"]
  if (declared === undefined || declared.length === 0) {
    return MACOS_FALLBACK_APPS
  }
  const preferred = TERM_PROGRAM_APPS[declared] ?? declared.replace(/\.app$/i, "")
  // Hoist the user's own terminal, never drop it. Filtering the fallbacks and
  // keeping `preferred` first matters when it is *already* in that list: under
  // `TERM_PROGRAM=Apple_Terminal` the earlier form returned the fallbacks
  // unchanged, so a user who launched from Terminal.app and also had iTerm
  // installed got iTerm — the opposite of asking for their own terminal.
  return [preferred, ...MACOS_FALLBACK_APPS.filter((app) => app !== preferred)]
}

/**
 * Terminal.app lives in `/System/Applications/Utilities` on modern macOS,
 * everything else in `/Applications` or the user's own — so the search order is
 * the four places an emulator is actually installed. The bundle path is handed
 * to `open -a` rather than the bare name, because a name is re-resolved by
 * LaunchServices and can pick a different copy than the one just verified.
 */
function findMacosApp(appName: string, env: NodeJS.ProcessEnv): string | undefined {
  const home = env["HOME"] ?? os.homedir()
  const roots = ["/Applications", path.join(home, "Applications"), "/System/Applications", "/System/Applications/Utilities"]
  for (const root of roots) {
    const bundle = path.join(root, `${appName}.app`)
    try {
      if (fs.statSync(bundle).isDirectory()) {
        return bundle
      }
    } catch {
      // Not installed here; try the next root.
    }
  }
  return undefined
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

/**
 * `Date.now()` named the script before, which collides for two launches in the
 * same millisecond — two agents then share one file and the second launch
 * rewrites the first one's environment out from under it. The session id is
 * unique by construction and, unlike a random name, is a key the service can
 * use later to delete exactly this script.
 */
function writeLauncherScript(launch: ExternalLaunch): string {
  fs.mkdirSync(launch.scratchDir, { recursive: true, mode: 0o700 })
  const scriptPath = path.join(launch.scratchDir, LAUNCHER_SCRATCH.filename(launch.sessionId))
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
 * `unref` so a pending unlink never holds the app open, and the unlink itself
 * is swallowed: if the emulator has the file open, or the sweep already took
 * it, that is not an error worth surfacing on a session that launched fine.
 */
function scheduleScriptCleanup(scriptPath: string): void {
  setTimeout(() => {
    try {
      fs.rmSync(scriptPath, { force: true })
    } catch {
      // Reclaimed by the next startup sweep instead.
    }
  }, SCRIPT_TTL_MS).unref()
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
