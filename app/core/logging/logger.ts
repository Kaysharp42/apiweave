/* eslint-disable no-console -- the fallback sink *is* the console by definition; these two logging files are the only places allowed to touch it */
import type { Logger } from "@shared/types/Logger"
import type { LogLevel } from "@shared/types/LogLevel"

/**
 * Where log records end up. The main process binds this once at startup to
 * electron-log's transports (daily files + terminal); before that — and in
 * every plain-node unit test — records fall through to the browser/Node
 * console with a timestamped prefix, so nothing is ever silently dropped.
 */
export interface LogBackend {
  write: (level: LogLevel, name: string, message: string, data: readonly unknown[]) => void
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
}

function clockStamp(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0")
  const m = String(date.getMinutes()).padStart(2, "0")
  const s = String(date.getSeconds()).padStart(2, "0")
  const ms = String(date.getMilliseconds()).padStart(3, "0")
  return `${h}:${m}:${s}.${ms}`
}

/** Console fallback used until (and unless) a richer backend is bound. */
function createConsoleBackend(): LogBackend {
  return {
    write: (level, name, message, data) => {
      // Resolved per call, not captured at load, so test doubles and
      // environments that patch console later are still observed.
      console[level](`[${clockStamp(new Date())}] [${LEVEL_LABELS[level]}] [${name}] ${message}`, ...data)
    },
  }
}

let backend: LogBackend = createConsoleBackend()
let bound = false
const loggers = new Map<string, Logger>()

/**
 * Replaces where records are written. Called once by the Electron composition
 * root; binding twice would be a wiring bug and is refused rather than
 * silently re-routed.
 */
export function bindLogBackend(next: LogBackend): void {
  if (bound && next !== backend) {
    throw new Error("bindLogBackend called twice with different backends")
  }
  bound = true
  backend = next
}

/**
 * The SLF4J-style entry point. One logger per name per process; the name tags
 * every record, which is what makes the daily file greppable by subsystem.
 */
export function getLogger(name: string): Logger {
  const existing = loggers.get(name)
  if (existing !== undefined) {
    return existing
  }

  const logger: Logger = {
    debug: (message, ...data) => backend.write("debug", name, message, data),
    info: (message, ...data) => backend.write("info", name, message, data),
    warn: (message, ...data) => backend.write("warn", name, message, data),
    error: (message, ...data) => backend.write("error", name, message, data),
  }
  loggers.set(name, logger)
  return logger
}
