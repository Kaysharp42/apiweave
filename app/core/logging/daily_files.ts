/**
 * Pure date/naming rules for the daily log files. Kept free of `fs` and
 * `electron` so the retention policy is unit-testable; electron/logging.ts
 * supplies the filesystem around them.
 */

export const LOG_FILE_PREFIX = "apiweave-main-"

/** A day stamp in *local* time — users look for "yesterday's file", not UTC's. */
export function logFileStamp(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** The live log file for the moment `date` falls in. */
export function logFileName(date: Date): string {
  return `${LOG_FILE_PREFIX}${logFileStamp(date)}.log`
}

/**
 * Extracts the day a log file belongs to, or null for anything that is not one
 * of ours — `main.old.log` from earlier releases, rotated chunks
 * (`...-2026-08-23.143005.log`), unrelated files sharing the folder.
 */
export function parseLogFileName(fileName: string): Date | null {
  if (!fileName.startsWith(LOG_FILE_PREFIX) || !fileName.endsWith(".log")) {
    return null
  }

  const stem = fileName.slice(LOG_FILE_PREFIX.length, -".log".length)
  // A size-rotated chunk carries an optional `.HHmmss` suffix after the stamp.
  const dot = stem.indexOf(".")
  const stamp = dot === -1 ? stem : stem.slice(0, dot)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp)
  if (match === null) {
    return null
  }

  // `new Date` rolls impossible days forward (Feb 31 → Mar 3), so a corrupt or
  // forged stamp must be caught by checking the round-trip.
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null
  }
  return date
}

/**
 * Retention: a file is expired when its *whole* day lies further back than
 * `retentionDays`. Today's file and the previous `retentionDays - 1` survive,
 * so the window always covers at least today plus yesterday.
 */
export function isExpiredLogFile(fileName: string, now: Date, retentionDays: number): boolean {
  const day = parseLogFileName(fileName)
  if (day === null) {
    return false
  }

  const midnight = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const ageDays = Math.floor((midnight(now) - midnight(day)) / 86_400_000)
  return ageDays >= retentionDays
}
