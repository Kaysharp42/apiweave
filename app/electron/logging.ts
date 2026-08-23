import { app, shell } from "electron"
import fs from "node:fs"
import path from "node:path"
import log from "electron-log/main"
import type { LogLevel, Logger } from "@shared/types/Logger"
import { bindLogBackend } from "../core/logging/logger"
import { isExpiredLogFile, logFileName } from "../core/logging/daily_files"

// ---------------------------------------------------------------------------
// Main-process logging
//
// A packaged app has no terminal. Printing to stdout in the main process goes
// to nothing, which makes the class of bug that matters most here — "the
// update didn't install / the save failed and I don't know why" — impossible
// to diagnose from a user's report.
//
// Everything funnels through one system, shaped like the classic Java loggers:
//
//   getLogger("cloud-sync").warn(...)     ← core/electron code (SLF4J-style,
//                                            no electron import needed)
//   log.scope("updater")                  ← electron-log named logger
//
// The file transport writes one file per day to `app.getPath("logs")`:
//
//   Windows  %APPDATA%\APIWeave\logs\apiweave-main-2026-08-23.log
//   macOS    ~/Library/Logs/APIWeave/apiweave-main-2026-08-23.log
//   Linux    ~/.config/APIWeave/logs/apiweave-main-2026-08-23.log
//
// A file that grows past maxSize within its day is rotated into a timestamped
// sibling (`apiweave-main-2026-08-23.143005.log`) rather than clobbering an
// `.old` copy, and files older than RETENTION_DAYS are deleted on launch and
// hourly afterwards, so months of uptime cannot fill the disk.
//
// Renderer output lands in the same daily files two ways:
//   - log.initialize() injects a session preload exposing `window.__electronLog`,
//     which src/utils/logger.ts forwards explicit records over;
//   - spyRendererConsole mirrors anything still printed to the renderer console
//     (uncaught errors, third-party libs) into the main logger.
// ---------------------------------------------------------------------------

const RETENTION_DAYS = 14
/** Per-day size cap; past this the day splits into timestamped chunks. */
const MAX_FILE_BYTES = 10 * 1024 * 1024
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"]

function envLevel(): LogLevel {
  const raw = process.env["APIWEAVE_LOG_LEVEL"]
  return LEVELS.find((level) => level === raw) ?? "info"
}

function configureTransports(): void {
  const level = envLevel()
  log.transports.file.level = level
  log.transports.file.maxSize = MAX_FILE_BYTES
  log.transports.console.level = level

  // One file per day, resolved per record so midnight rolls over cleanly.
  log.transports.file.resolvePathFn = ({ libraryDefaultDir }, message) =>
    path.join(libraryDefaultDir, logFileName(message?.date ?? new Date()))

  // The stock archiver renames to `<name>.old.log`, which a same-day second
  // rotation would overwrite mid-write on Windows. Chunk instead.
  log.transports.file.archiveLogFn = (file) => {
    const current = file.toString()
    const info = path.parse(current)
    const now = new Date()
    const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join("")
    try {
      fs.renameSync(current, path.join(info.dir, `${info.name}.${stamp}${info.ext}`))
    } catch (error) {
      log.warn("Could not rotate log", error)
    }
  }

  // Log4j2-style line: timestamp [LEVEL] [logger] message
  const lineFormat = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}"
  log.transports.file.format = lineFormat
  log.transports.console.format = "[{h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}"
}

function sweepExpiredLogs(): void {
  let logsDir: string
  try {
    logsDir = app.getPath("logs")
  } catch {
    return
  }

  let entries: string[]
  try {
    entries = fs.readdirSync(logsDir)
  } catch {
    return
  }

  const now = new Date()
  for (const entry of entries) {
    if (!isExpiredLogFile(entry, now, RETENTION_DAYS)) {
      continue
    }
    try {
      fs.unlinkSync(path.join(logsDir, entry))
    } catch {
      // In use or already gone — the next sweep retries harmlessly.
    }
  }
}

let initialized = false

/**
 * Binds the whole system together. Idempotent; called once at the very top of
 * the composition root so every later record lands in the daily file.
 */
export function initLogging(): void {
  if (initialized) {
    return
  }
  initialized = true

  configureTransports()

  // Session preload exposing `window.__electronLog` + renderer-console mirroring.
  log.initialize({ includeFutureSessions: true, spyRendererConsole: true })

  bindLogBackend({
    write: (level, name, message, data): void => {
      log.scope(name)[level](message, ...data)
    },
  })

  void app.whenReady().then(() => {
    sweepExpiredLogs()
    const timer = setInterval(sweepExpiredLogs, SWEEP_INTERVAL_MS)
    timer.unref?.()
  })
}

/**
 * Logger handed to electron-updater as `autoUpdater.logger`, which is chatty at
 * debug level — every provider request, resolved file and byte range. The file
 * transport is pinned to `info` by default so that detail stays out of the log
 * unless someone raises APIWEAVE_LOG_LEVEL deliberately.
 */
export const updaterLog: Logger = log.scope("updater") as Logger

/**
 * Logger for rejected IPC dispatches. The router is electron-free, so the
 * composition root passes this in as `reportError`; every refused call — a
 * workflow save rejected by validation, a denied action, an internal handler
 * failure — lands in the daily file as `[ipc] <domain>.<action> rejected (...)`.
 * This is the line a support report should quote, since toasts are transient
 * and the renderer console dies with the window.
 */
export const ipcLog: Logger = log.scope("ipc") as Logger

/** Absolute path to today's log file. Resolved on demand rather than at
 * import: the path depends on `app.getPath`, which is only meaningful once
 * Electron has decided where userData lives. */
export function logFilePath(): string {
  return log.transports.file.getFile().path
}

/**
 * Opens the OS file manager with the log file selected. Reveals rather than
 * opens it, because the useful next step is almost always attaching the file to
 * a bug report, and a `.log` file has no default handler on Windows.
 */
export function revealLogFile(): void {
  shell.showItemInFolder(logFilePath())
}
