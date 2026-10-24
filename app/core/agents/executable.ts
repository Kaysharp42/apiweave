import fs from "node:fs"
import path from "node:path"

/**
 * PATH resolution and safe argv composition for agent CLIs.
 *
 * Everything here exists to avoid `shell: true`, which is not an option for two
 * separate reasons. The obvious one is injection: an agent name or a prompt
 * reaching a shell is arbitrary code execution. The less obvious one is that it
 * is silently lossy — Node concatenates arguments with spaces instead of
 * quoting them, so an argument of `hello world` arrives at the child as
 * `hello`, and `safe & echo INJECTED` executes the injection. Node emits
 * DEP0190 for exactly this.
 */

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD"

/**
 * Find a command on PATH the way the OS would, returning an absolute path.
 *
 * Resolving to an absolute path up front is what lets the caller branch on the
 * file extension below — with a bare name there is no way to tell a real `.exe`
 * from a `.cmd` shim, and the two need different spawn treatment.
 */
export function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (command.length === 0) {
    return undefined
  }
  // An explicit path is used as given — it is not a PATH lookup at all.
  if (command.includes("/") || command.includes("\\")) {
    const absolute = path.resolve(command)
    return isExecutableFile(absolute) ? absolute : undefined
  }

  // Absolute entries only: an empty or relative one (`.`, `bin`) is resolved
  // against main's working directory, where a planted `gh.exe` would be run —
  // and handed a token.
  const searchDirs = (env["PATH"] ?? env["Path"] ?? "").split(path.delimiter).filter((entry) => path.isAbsolute(entry))
  const candidates = candidateNames(command, env)

  for (const dir of searchDirs) {
    for (const name of candidates) {
      const candidate = path.join(dir, name)
      if (isExecutableFile(candidate)) {
        return candidate
      }
    }
  }
  return undefined
}

/**
 * Windows only: `where.exe claude` may list several hits, and the first one can
 * be an extensionless shim that `spawn` cannot execute at all (ENOENT). Trying
 * PATHEXT entries *before* the bare name means the runnable form wins.
 */
function candidateNames(command: string, env: NodeJS.ProcessEnv): readonly string[] {
  if (process.platform !== "win32") {
    return [command]
  }
  // PATHEXT is conventionally upper-case (`.COM;.EXE;…`). The filesystem does
  // not care, but the resolved path is shown in the roster, and `claude.EXE`
  // reads like something went wrong.
  const extensions = (env["PATHEXT"] ?? DEFAULT_PATHEXT)
    .split(";")
    .filter((ext) => ext.length > 0)
    .map((ext) => ext.toLowerCase())
  const hasKnownExt = extensions.some((ext) => command.toLowerCase().endsWith(ext))
  return hasKnownExt ? [command] : [...extensions.map((ext) => `${command}${ext}`), command]
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) {
      return false
    }
  } catch {
    return false
  }
  if (process.platform === "win32") {
    return true
  }
  try {
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface SpawnCommand {
  readonly file: string
  readonly args: readonly string[]
  /**
   * True when `args` is already a cmd.exe command line, escaped here, that must
   * reach the process untouched — `windowsVerbatimArguments` for
   * `child_process`, {@link ptyArgs} for node-pty. Either one's own quoting
   * on top would re-quote the carets and quotes and undo the escaping.
   */
  readonly verbatim: boolean
}

/** A Windows batch file, which can only run through `cmd.exe`. */
export function isBatchShim(executablePath: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(executablePath)
}

/**
 * Compose the `(file, args)` pair to hand to `spawn`/`execFile`/`pty.spawn`.
 *
 * On Windows a `.cmd` or `.bat` is not a real executable: spawning it bare
 * gives ENOENT, and spawning it explicitly gives EINVAL ever since the
 * CVE-2024-27980 fix. It has to be run through `cmd.exe`, which parses the
 * command line for `&`, `|`, `<`, `>`, `^`, `%` and `!` — so every argument, a
 * user's prompt included, is escaped for it by {@link cmdCommandLine} and the
 * whole line is passed verbatim. Everything else, on every platform, is
 * spawned directly with its arguments untouched.
 */
export function spawnCommandFor(
  executablePath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): SpawnCommand {
  if (!isBatchShim(executablePath)) {
    return { file: executablePath, args, verbatim: false }
  }
  // `/d` skips AutoRun commands; `/s` with the outer quotes makes cmd strip
  // exactly those two and leave the escaped line inside alone.
  return {
    file: env["COMSPEC"] ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${cmdCommandLine(executablePath, args)}"`],
    verbatim: true,
  }
}

/** The args in the form node-pty wants: a verbatim command line is passed as one string, which it does not re-quote. */
export function ptyArgs(command: SpawnCommand): readonly string[] | string {
  return command.verbatim ? command.args.join(" ") : command.args
}

/** Every character cmd.exe gives a meaning to, caret-escaped below. Same set as cross-spawn. */
const CMD_METACHARACTERS = /([()\][%!^"`<>&|;, *?])/g

/**
 * A batch file's command line, escaped for cmd.exe the way cross-spawn does it
 * (itself after https://qntm.org/cmd) — ported rather than imported, because
 * cross-spawn's escaping is an internal module, not its API.
 *
 * Each argument is quoted for the C runtime that eventually parses it, then
 * every metacharacter is caret-escaped twice: once for the `cmd.exe` that runs
 * the shim, and once for the shim's own `%*`, which cmd re-parses when it
 * expands it — and agent CLIs installed with npm are exactly such shims. A line
 * break cannot be escaped at all — cmd ends the command there — so it is
 * refused rather than silently cut.
 */
export function cmdCommandLine(executablePath: string, args: readonly string[]): string {
  for (const arg of args) {
    if (/[\r\n]/.test(arg)) {
      throw new Error(
        `${path.basename(executablePath)} runs through cmd.exe, which cannot pass a line break in an argument — put the prompt on one line`,
      )
    }
  }
  return [executablePath.replace(CMD_METACHARACTERS, "^$1"), ...args.map(escapeCmdArgument)].join(" ")
}

function escapeCmdArgument(arg: string): string {
  // Backslashes before a quote, and before the closing quote added below, are
  // doubled; the quote itself is backslash-escaped.
  const quoted = `"${arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, "$1$1")}"`
  return quoted.replace(CMD_METACHARACTERS, "^$1").replace(CMD_METACHARACTERS, "^$1")
}

/**
 * For a launch that hands an argv to another program which then runs it
 * through cmd.exe — `start`, or a terminal emulator starting a `.cmd` shim.
 * There is no single escaping that survives an unknown number of re-parses, so
 * an argument cmd.exe would interpret is refused instead.
 */
export function assertNoCmdMetacharacters(executablePath: string, args: readonly string[]): void {
  const unsafe = args.find((arg) => /[&|<>^%!"\r\n]/.test(arg))
  if (unsafe !== undefined) {
    throw new Error(
      `${path.basename(executablePath)} would be started through cmd.exe, which interprets & | < > ^ % ! " and line breaks — remove them from the prompt, or launch in the embedded terminal`,
    )
  }
}
