import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveExecutable, spawnCommandFor, type SpawnCommand } from "./executable"
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

// ── choosing an emulator ──────────────────────────────────────────────────

/**
 * The registry with the user's own emulator moved to the front.
 *
 * Hoisted rather than filtered-and-prepended, so an emulator that is already in
 * the list keeps its single entry and its recipe: an earlier form prepended the
 * preferred *name* to the fallbacks, which under `TERM_PROGRAM=Apple_Terminal`
 * left a user who launched from Terminal.app — with iTerm also installed —
 * being dropped into iTerm, the opposite of asking for their own terminal.
 *
 * Only known entries are hoisted. An emulator this file has no recipe for is
 * one it cannot drive, and reordering the list around a name it cannot use
 * would only delay the fallback.
 */
function preferFirst<T>(
  entries: readonly T[],
  preferred: string | null,
  idOf: (entry: T) => string,
): readonly T[] {
  if (preferred === null) {
    return entries
  }
  const chosen = entries.find((entry) => idOf(entry) === preferred)
  if (chosen === undefined) {
    return entries
  }
  return [chosen, ...entries.filter((entry) => entry !== chosen)]
}

/**
 * Spellings that do not normalise to their registry id on their own.
 * `Apple_Terminal` is Terminal.app's own name for itself, and Warp announces
 * itself as `WarpTerminal`; everything else in the roster reaches its id by
 * lower-casing and dropping a `.app` suffix (`iTerm.app`, `WezTerm`, `Ghostty`).
 */
const TERM_PROGRAM_ALIASES: Readonly<Record<string, string>> = {
  apple_terminal: "terminal",
  warpterminal: "warp",
}

/**
 * The emulator the user is actually in, normalised to a registry id, or null.
 *
 * Two sources, and they mean different things. `TERM_PROGRAM` is set by
 * whichever emulator started APIWeave, so it is evidence; `$TERMINAL` is the
 * long-standing POSIX convention for "open terminals with this", so it is an
 * instruction and wins. It may be an absolute path, so only the basename is
 * compared.
 *
 * Used for ordering only. What it names is never *added* to a registry here —
 * see {@link launchLinux} for the one place an unknown `$TERMINAL` is tried,
 * and why it is tried last.
 */
function preferredTerminalId(env: NodeJS.ProcessEnv): string | null {
  const declared = declaredTerminal(env)
  const source = declared ?? env["TERM_PROGRAM"]
  if (source === undefined || source.length === 0) {
    return null
  }
  const normalized = source.toLowerCase().replace(/\.app$/, "").replace(/\.exe$/, "")
  return TERM_PROGRAM_ALIASES[normalized] ?? normalized
}

/** The basename of `$TERMINAL`, which users set to an emulator or to a path. */
function declaredTerminal(env: NodeJS.ProcessEnv): string | undefined {
  const declared = env["TERMINAL"]
  if (declared === undefined || declared.length === 0) {
    return undefined
  }
  return path.basename(declared)
}

// ── Windows ───────────────────────────────────────────────────────────────

interface WindowsTerminal {
  readonly id: string
  readonly command: string
  readonly argsFor: (cwd: string, command: SpawnCommand) => readonly string[]
}

/**
 * Windows Terminal first, then the emulator the user lives in if it is one of
 * the cross-platform ones, and `start` through the classic console for
 * everything else.
 *
 * `wt.exe` ships with Windows 11 but is an optional install on 10, so the
 * fallback is not theoretical — and unlike the POSIX registries this one has a
 * guaranteed last resort, because `cmd.exe /c start` needs nothing installed.
 * That is why it is not a table entry: it never fails, so it is the floor
 * rather than a candidate.
 *
 * Every path spawns a real argv. `shell: true` is never used, and `cmd.exe`
 * appears only as an explicit interpreter — for `start`, and for the `.cmd`
 * shims that Node cannot execute directly.
 */
const WINDOWS_TERMINALS: readonly WindowsTerminal[] = [
  {
    id: "wt",
    command: "wt.exe",
    argsFor: (cwd, command) => [
      "-d",
      ...[cwd, command.file, ...command.args].map(escapeWindowsTerminalArg),
    ],
  },
  {
    id: "wezterm",
    command: "wezterm.exe",
    argsFor: (cwd, command) => ["start", "--cwd", cwd, "--", command.file, ...command.args],
  },
  {
    id: "alacritty",
    command: "alacritty.exe",
    argsFor: (cwd, command) => ["--working-directory", cwd, "-e", command.file, ...command.args],
  },
]

async function launchWindows(launch: ExternalLaunch): Promise<void> {
  const env = { ...process.env, ...launch.env }
  const command = spawnCommandFor(launch.executablePath, launch.args, env)

  for (const terminal of preferFirst(WINDOWS_TERMINALS, preferredTerminalId(env), (entry) => entry.id)) {
    const resolved = resolveExecutable(terminal.command, env)
    if (resolved === undefined) {
      continue
    }
    await spawnDetached(resolved, terminal.argsFor(launch.cwd, command), { cwd: launch.cwd, env })
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
 * How one macOS emulator is started, and the reason this file is not simply a
 * list of app names.
 *
 * `open -a <bundle> <script>.command` *runs* the script only for an app that
 * registers a shell-script document type. Terminal.app and iTerm do; Ghostty,
 * Alacritty, kitty and WezTerm do not — handing one of them a `.command`
 * through LaunchServices opens an ordinary shell in the user's home directory
 * and the agent never runs, while `open` exits zero and the detached spawn
 * resolved long before it. That is a launch that reports success and does
 * nothing, which is worse than the missing-emulator error it replaced.
 *
 * So everything that is not a document handler is exec'd out of its own bundle
 * with the same per-emulator flag Linux uses, and the two kinds are kept apart
 * in the type rather than in a comment.
 */
type MacosExec =
  | { readonly kind: "document" }
  | {
      readonly kind: "binary"
      /** The CLI inside `Contents/MacOS`, which is also its name on PATH. */
      readonly binary: string
      readonly argsFor: (scriptPath: string) => readonly string[]
    }

interface MacosTerminal {
  readonly id: string
  /** The `.app` bundle name, without the extension. */
  readonly app: string
  readonly exec: MacosExec
}

/**
 * iTerm before Terminal.app because Terminal.app is always installed — a user
 * who has iTerm chose it — and the drivable third-party emulators after both,
 * where they are reached only by {@link preferFirst} hoisting the user's own.
 *
 * Warp, Hyper and Tabby are deliberately absent. All three set `TERM_PROGRAM`,
 * so a user in one is recognised, but none of them can be told to run a command
 * from the command line: including them would mean opening an empty window and
 * calling the launch a success. Falling through to Terminal.app runs the agent,
 * which is what the user asked for even if it is not where they asked for it.
 */
const MACOS_TERMINALS: readonly MacosTerminal[] = [
  { id: "iterm", app: "iTerm", exec: { kind: "document" } },
  { id: "terminal", app: "Terminal", exec: { kind: "document" } },
  {
    id: "ghostty",
    app: "Ghostty",
    exec: { kind: "binary", binary: "ghostty", argsFor: (script) => ["-e", script] },
  },
  {
    id: "wezterm",
    app: "WezTerm",
    exec: { kind: "binary", binary: "wezterm", argsFor: (script) => ["start", "--", script] },
  },
  {
    id: "kitty",
    app: "kitty",
    exec: { kind: "binary", binary: "kitty", argsFor: (script) => [script] },
  },
  {
    id: "alacritty",
    app: "Alacritty",
    exec: { kind: "binary", binary: "alacritty", argsFor: (script) => ["-e", script] },
  },
]

/**
 * The user's own terminal, then iTerm, then Terminal.app, then anything else
 * installed that can be driven.
 *
 * Existence is checked before spawning rather than left to `open`, which fails
 * *silently* for a missing app: it exits non-zero long after the detached spawn
 * has already resolved, so a missing emulator used to be reported to the user
 * as a successful launch.
 */
async function launchMacos(launch: ExternalLaunch, scriptPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  for (const terminal of preferFirst(MACOS_TERMINALS, preferredTerminalId(env), (entry) => entry.id)) {
    const bundle = findMacosApp(terminal.app, env)
    if (terminal.exec.kind === "document") {
      if (bundle === undefined) {
        continue
      }
      await spawnDetached("/usr/bin/open", ["-a", bundle, scriptPath], { cwd: launch.cwd, env })
      return
    }
    const binary = findMacosBinary(terminal.exec.binary, bundle, env)
    if (binary === undefined) {
      continue
    }
    await spawnDetached(binary, terminal.exec.argsFor(scriptPath), { cwd: launch.cwd, env })
    return
  }
  throw new NoTerminalFoundError(
    `No terminal application found. Tried: ${MACOS_TERMINALS.map((entry) => entry.app).join(", ")}`,
  )
}

async function launchLinux(launch: ExternalLaunch, scriptPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  for (const terminal of preferFirst(LINUX_TERMINALS, preferredTerminalId(env), (entry) => entry.command)) {
    const resolved = resolveExecutable(terminal.command, env)
    if (resolved === undefined) {
      continue
    }
    await spawnDetached(resolved, terminal.argsFor(scriptPath), { cwd: launch.cwd, env })
    return
  }
  // An emulator the registry has never heard of, but which the user named
  // themselves. `-e <command>` is the near-universal convention, and it is
  // still a guess — so it is tried after every emulator this file knows how to
  // drive, and only for `$TERMINAL`, which is an explicit instruction rather
  // than the ambient evidence `TERM_PROGRAM` provides. Guessing at
  // `TERM_PROGRAM` would mean handing `-e` to `tmux`, where it sets an
  // environment variable and runs nothing at all.
  //
  // The raw value before the basename, because `resolveExecutable` treats an
  // argument containing a separator as a literal path: `TERMINAL` pointing at
  // an emulator outside PATH is the case the basename lookup cannot serve.
  const declared =
    resolveExecutable(env["TERMINAL"] ?? "", env) ??
    resolveExecutable(declaredTerminal(env) ?? "", env)
  if (declared !== undefined) {
    await spawnDetached(declared, ["-e", scriptPath], { cwd: launch.cwd, env })
    return
  }
  throw new NoTerminalFoundError(
    `No terminal emulator found. Tried: ${LINUX_TERMINALS.map((entry) => entry.command).join(", ")}`,
  )
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

/**
 * An emulator's own CLI: inside the bundle first, then PATH.
 *
 * The bundle wins because it is the copy just verified, but the PATH lookup is
 * not a nicety — Homebrew installs `wezterm`, `kitty` and `alacritty` as links
 * in `/opt/homebrew/bin`, and a user who has one of those but keeps the app
 * somewhere {@link findMacosApp} does not look would otherwise be told they
 * have no terminal at all.
 *
 * Both lookups go through `resolveExecutable`, which treats an argument
 * containing a separator as a literal path and everything else as a PATH
 * search — and in both cases proves the file is really there and really
 * executable before it is handed to `spawn`.
 */
function findMacosBinary(
  binary: string,
  bundle: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const inside =
    bundle === undefined
      ? undefined
      : resolveExecutable(path.join(bundle, "Contents", "MacOS", binary), env)
  return inside ?? resolveExecutable(binary, env)
}

interface LinuxTerminal {
  readonly command: string
  readonly argsFor: (scriptPath: string) => readonly string[]
}

/**
 * `x-terminal-emulator` first because on Debian-family systems it is the user's
 * own configured choice; then the desktop environments' own terminals, then the
 * emulators people install deliberately, then the X11 fallbacks that are on
 * almost every machine. Anything the user names in `$TERMINAL` is hoisted above
 * all of it by {@link preferFirst}, or tried by {@link launchLinux} if it is not
 * in this list at all.
 */
const LINUX_TERMINALS: readonly LinuxTerminal[] = [
  { command: "x-terminal-emulator", argsFor: (script) => ["-e", script] },
  { command: "gnome-terminal", argsFor: (script) => ["--", script] },
  // GNOME Console and Ptyxis, the GTK4 replacements gnome-terminal is being
  // retired in favour of. Neither is a drop-in: `kgx` kept `-e`, `ptyxis`
  // takes the command after `--`.
  { command: "kgx", argsFor: (script) => ["-e", script] },
  { command: "ptyxis", argsFor: (script) => ["--", script] },
  { command: "konsole", argsFor: (script) => ["-e", script] },
  { command: "xfce4-terminal", argsFor: (script) => ["-e", script] },
  { command: "mate-terminal", argsFor: (script) => ["-e", script] },
  { command: "tilix", argsFor: (script) => ["-e", script] },
  { command: "terminator", argsFor: (script) => ["-e", script] },
  { command: "deepin-terminal", argsFor: (script) => ["-e", script] },
  { command: "qterminal", argsFor: (script) => ["-e", script] },
  { command: "lxterminal", argsFor: (script) => ["-e", script] },
  { command: "ghostty", argsFor: (script) => ["-e", script] },
  { command: "wezterm", argsFor: (script) => ["start", "--", script] },
  { command: "alacritty", argsFor: (script) => ["-e", script] },
  { command: "kitty", argsFor: (script) => [script] },
  { command: "foot", argsFor: (script) => [script] },
  { command: "urxvt", argsFor: (script) => ["-e", script] },
  { command: "rxvt", argsFor: (script) => ["-e", script] },
  { command: "st", argsFor: (script) => ["-e", script] },
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
