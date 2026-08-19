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

  const searchDirs = (env["PATH"] ?? env["Path"] ?? "").split(path.delimiter).filter((entry) => entry.length > 0)
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
}

/**
 * Compose the `(file, args)` pair to hand to `spawn`/`execFile`/`pty.spawn`.
 *
 * On Windows a `.cmd` or `.bat` is not a real executable: spawning it bare
 * gives ENOENT, and spawning it explicitly gives EINVAL ever since the
 * CVE-2024-27980 fix. It has to be run through `cmd.exe /c`. Everything else,
 * on every platform, is spawned directly with its arguments untouched.
 */
export function spawnCommandFor(
  executablePath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): SpawnCommand {
  const isBatchShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(executablePath)
  if (!isBatchShim) {
    return { file: executablePath, args }
  }
  return { file: env["COMSPEC"] ?? "cmd.exe", args: ["/c", executablePath, ...args] }
}
