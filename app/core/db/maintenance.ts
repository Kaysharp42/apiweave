import fs from "node:fs"
import path from "node:path"
import type { Database } from "./sqlite-types"

/** Pre-upgrade backups kept in `<data folder>/backups`; older ones are deleted. */
export const KEPT_BACKUPS = 5

const BACKUP_FILE = /^apiweave-.+-v\d+\.db$/

/** Free space at which startup compacts the file: a quarter of it, and at least 8 MiB. */
const VACUUM_MIN_FREE_BYTES = 8 * 1024 * 1024

export function backupsDirectory(databasePath: string): string {
  return path.join(path.dirname(databasePath), "backups")
}

/**
 * Writes a consistent copy of the database to the backups folder before a
 * migration touches it, then keeps only the newest {@link KEPT_BACKUPS}. The
 * timestamp leads the name so name order is age order across versions.
 */
export function backupDatabase(database: Database, databasePath: string, schemaVersion: number): string {
  const directory = backupsDirectory(databasePath)
  fs.mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = path.join(directory, `apiweave-${stamp}-v${schemaVersion}.db`)
  database.prepare("VACUUM INTO ?").run(backupPath)
  const backups = fs.readdirSync(directory).filter((name) => BACKUP_FILE.test(name)).sort()
  for (const stale of backups.slice(0, -KEPT_BACKUPS)) {
    fs.rmSync(path.join(directory, stale), { force: true })
  }
  return backupPath
}

/** Throws the first problem `PRAGMA quick_check` reports. */
export function assertIntact(database: Database): void {
  const result = database.pragma<string>("quick_check", { simple: true })
  if (result !== "ok") {
    throw new Error(result)
  }
}

/**
 * Rebuilds the file when deletes (run-history pruning, mostly) have left a
 * quarter of it free. Deciding from the freelist keeps it stateless and makes
 * the cost appear only when there is space to win back.
 *
 * ponytail: VACUUM blocks startup for the size of the file; switch to
 * auto_vacuum=INCREMENTAL if databases grow large enough for that to show.
 */
export function vacuumIfFragmented(database: Database): boolean {
  const pageCount = database.pragma<number>("page_count", { simple: true })
  const freePages = database.pragma<number>("freelist_count", { simple: true })
  const pageSize = database.pragma<number>("page_size", { simple: true })
  if (freePages * 4 < pageCount || freePages * pageSize < VACUUM_MIN_FREE_BYTES) {
    return false
  }
  database.exec("VACUUM")
  return true
}
