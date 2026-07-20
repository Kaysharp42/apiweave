import fs from "node:fs"
import path from "node:path"
import { runMigrations } from "./migrations"
import { SyncStore } from "./kvstore"
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
  const database = openDatabase(options)
  const migrationsPath = typeof options === "string" ? undefined : options.migrationsPath
  try {
    const schemaVersion = runMigrations(database, migrationsPath)
    const kvStore = new SyncStore(database)
    return {
      database,
      databasePath,
      kvStore,
      schemaVersion,
      close: () => database.close(),
    }
  } catch (error) {
    database.close()
    throw error
  }
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
