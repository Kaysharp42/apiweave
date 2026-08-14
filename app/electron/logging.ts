import { shell } from "electron"
import log from "electron-log/main"

// ---------------------------------------------------------------------------
// Main-process logging
//
// A packaged app has no terminal. `console.log` in the main process goes to a
// stdout nobody is attached to, which makes the one class of bug that matters
// most here — "the update didn't install and I don't know why" — impossible to
// diagnose from a user's report.
//
// electron-log's default file transport writes to `app.getPath("logs")`:
//
//   Windows  %APPDATA%\APIWeave\logs\main.log
//   macOS    ~/Library/Logs/APIWeave/main.log
//   Linux    ~/.config/APIWeave/logs/main.log
//
// and rotates at 1 MiB into `main.old.log`, so it cannot grow without bound on
// a machine that stays up for months. One generation of history is enough: the
// update events worth reading are always from the current or previous session.
// ---------------------------------------------------------------------------

log.transports.file.level = "info"

/**
 * Logger handed to electron-updater as `autoUpdater.logger`, which is chatty at
 * debug level — every provider request, resolved file and byte range. The file
 * transport is pinned to `info` above so that detail stays out of the log
 * unless someone raises the level deliberately, while the events that explain a
 * failed update (checking, found, downloading, error) still land.
 *
 * The scope prefixes each line with `[updater]`, so update lines stay findable
 * once anything else in the main process starts logging here too.
 */
export const updaterLog = log.scope("updater")

/**
 * Logger for rejected IPC dispatches. The router is electron-free, so the
 * composition root passes this in as `reportError`; every refused call — a
 * workflow save rejected by validation, a denied action, an internal handler
 * failure — lands in `main.log` as `[ipc] <domain>.<action> rejected (...)`.
 * This is the line a support report should quote, since toasts are transient
 * and the renderer console dies with the window.
 */
export const ipcLog = log.scope("ipc")

/** Absolute path to the current log file. Resolved on demand rather than at
 * import: the path depends on `app.getPath`, which is only meaningful once
 * Electron has decided where userData lives. */
export function logFilePath(): string {
  return log.transports.file.getFile().path
}

/**
 * Opens the OS file manager with the log file selected. Reveals rather than
 * opens it, because the useful next step is almost always attaching the file to
 * a bug report, and `main.log` has no default handler on Windows.
 */
export function revealLogFile(): void {
  shell.showItemInFolder(logFilePath())
}
