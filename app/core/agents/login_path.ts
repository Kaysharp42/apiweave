import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

/**
 * A GUI-launched app does not inherit the user's shell PATH.
 *
 * Measured on Arch: the AppImage started from a .desktop entry runs with
 * `PATH=/usr/local/sbin:/usr/local/bin:/usr/bin:…` — no `~/.local/bin`, no
 * `~/.opencode/bin`. The roster then reports `claude` as not-installed (it only
 * exists in `~/.local/bin`) and resolves `opencode` to the stale `/usr/bin`
 * copy instead of the newer one earlier on the user's real PATH. macOS is
 * worse: GUI apps get `/usr/bin:/bin:/usr/sbin:/sbin`, so nvm, Homebrew, mise
 * and asdf installs are all invisible.
 *
 * So ask the login shell what PATH actually is, once, before anything resolves
 * an executable. Detection, the PTY launcher and the external-terminal launcher
 * all read `process.env`, so fixing it here fixes all three.
 */

const MARKER = "__APIWEAVE_PATH__"

/** One shell startup, with the user's rc files. Slow rc files must not wedge boot. */
const SHELL_TIMEOUT_MS = 5_000

/** Prepend the shell's entries, keeping the process's own as a fallback tail. */
export function mergePath(shellPath: string, currentPath: string): string {
  const entries = [...shellPath.split(path.delimiter), ...currentPath.split(path.delimiter)]
  return [...new Set(entries.filter((entry) => entry.length > 0))].join(path.delimiter)
}

/** The `PATH=` line of an `env` dump, or `undefined` if the dump has none. */
export function parseEnvPath(output: string): string | undefined {
  const afterMarker = output.slice(output.lastIndexOf(MARKER) + MARKER.length)
  const line = afterMarker.split(/\r?\n/).find((entry) => entry.startsWith("PATH="))
  return line?.slice("PATH=".length).trim() || undefined
}

/**
 * Returns the merged PATH it installed, or `null` when it left `env` alone.
 *
 * `env` rather than `echo $PATH` because fish stores PATH as a list and would
 * hand back space-separated entries; `env` prints the exported, delimiter-joined
 * form in every shell. The marker discards anything an interactive rc file
 * printed on stdout before it.
 */
export function hydratePathFromLoginShell(env: NodeJS.ProcessEnv = process.env): string | null {
  // SHELL is absent for a macOS app launched from Finder; the passwd database
  // has the login shell either way, and `/bin/sh` would read none of the rc
  // files that put the PATH entries there in the first place.
  const shell = env["SHELL"] || os.userInfo().shell
  if (process.platform === "win32" || shell === null || shell === undefined || shell.length === 0) {
    return null
  }

  let output: string
  try {
    output = execFileSync(shell, ["-ilc", `printf '%s' ${MARKER}; env`], {
      encoding: "utf8",
      timeout: SHELL_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    // No shell, an rc file that exits non-zero, a timeout — the inherited PATH
    // is still usable, it is just short. Never fatal.
    return null
  }

  const shellPath = parseEnvPath(output)
  if (shellPath === undefined) {
    return null
  }

  const merged = mergePath(shellPath, env["PATH"] ?? "")
  env["PATH"] = merged
  return merged
}
