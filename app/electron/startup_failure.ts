/**
 * Body of the native error box shown when the composition root throws before a
 * window exists — a database newer than this build, a failed migration, an
 * unreadable keyfile. Electron-free so it can be tested; main.ts shows it and
 * exits, which is what releases the single-instance lock for the next launch.
 */
export function startupFailureMessage(error: unknown, paths: { logFile: string; userData: string }): string {
  const reason = error instanceof Error ? error.message : String(error)
  return [
    reason,
    "",
    "The full error was written to the log file:",
    paths.logFile,
    "",
    "Your data folder (database, keyfile) is:",
    paths.userData,
    "",
    "Include the log file when reporting this problem.",
  ].join("\n")
}
