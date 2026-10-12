import fs from "node:fs"
import path from "node:path"
import { runMigrations } from "./migrations"
import { assertIntact, backupDatabase, backupsDirectory, vacuumIfFragmented } from "./maintenance"
import { SyncStore } from "./kvstore"
import { getLogger } from "../logging/logger"
import type { Database, BetterSqlite3Factory } from "./sqlite-types"

export type InitDatabaseOptions = {
  readonly userDataPath?: string
  readonly databasePath?: string
  readonly migrationsPath?: string
}

export type InitializedDatabase = {
  readonly database: Database
  readonly databasePath: string
  readonly kvStore: SyncStore
  readonly schemaVersion: number
  close(): void
}

export function openDatabase(options: InitDatabaseOptions | string): Database {
  const databasePath = resolveDatabasePath(options)
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  }
  const sqliteFactory: BetterSqlite3Factory = require("better-sqlite3")
  const database = new sqliteFactory(databasePath)
  database.pragma("journal_mode = WAL")
  database.pragma("foreign_keys = ON")
  return database
}

export function initDatabase(options: InitDatabaseOptions | string): InitializedDatabase {
  const databasePath = resolveDatabasePath(options)
  const onDisk = databasePath !== ":memory:"
  const migrationsPath = typeof options === "string" ? undefined : options.migrationsPath
  let database: Database | undefined
  let backupPath: string | undefined
  try {
    try {
      database = openDatabase(options)
      assertIntact(database)
    } catch (error) {
      throw new Error(
        `The database ${databasePath} is damaged and cannot be opened: ${errorMessage(error)}. ` +
          `Copies taken before past upgrades are in ${backupsDirectory(databasePath)}.`,
      )
    }
    const opened = database
    let schemaVersion: number
    try {
      schemaVersion = runMigrations(opened, migrationsPath, (currentVersion) => {
        // A fresh file (version 0) has nothing to lose.
        if (onDisk && currentVersion > 0) {
          backupPath = backupDatabase(opened, databasePath, currentVersion)
        }
      })
    } catch (error) {
      if (backupPath === undefined) throw error
      throw new Error(`${errorMessage(error)}. The database was backed up before the upgrade to ${backupPath}.`)
    }
    if (onDisk) {
      // Compaction is an optimisation: a failed VACUUM (SQLITE_FULL on a
      // nearly full disk, say) rolls back and leaves a healthy database.
      try {
        vacuumIfFragmented(opened)
      } catch (error) {
        getLogger("database").warn("startup VACUUM failed; continuing without compaction", error)
      }
    }
    return {
      database: opened,
      databasePath,
      kvStore: new SyncStore(opened),
      schemaVersion,
      close: () => opened.close(),
    }
  } catch (error) {
    database?.close()
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveDatabasePath(options: InitDatabaseOptions | string): string {
  if (typeof options === "string") {
    return path.join(options, "apiweave.db")
  }
  if (options.databasePath !== undefined) {
    return options.databasePath
  }
  if (options.userDataPath !== undefined) {
    return path.join(options.userDataPath, "apiweave.db")
  }
  throw new Error("database path required")
}
