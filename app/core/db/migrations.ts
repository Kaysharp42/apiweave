import fs from "node:fs"
import path from "node:path"
import type { Database } from "./sqlite-types"

type Migration = {
  readonly version: number
  readonly fileName: string
  readonly sql: string
}

const MIGRATION_FILE = /^(\d+)_.*\.sql$/

export function runMigrations(database: Database, migrationsPath = defaultMigrationsPath()): number {
  const migrations = readMigrations(migrationsPath)
  const latestVersion = migrations.at(-1)?.version ?? 0
  const currentVersion = getUserVersion(database)
  if (currentVersion > latestVersion) {
    throw new Error(`migration not found: database user_version ${currentVersion} is newer than current ${latestVersion}`)
  }
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      applyMigration(database, migration)
    }
  }
  return getUserVersion(database)
}

export function readMigrations(migrationsPath = defaultMigrationsPath()): readonly Migration[] {
  const migrations = fs
    .readdirSync(migrationsPath)
    .filter((fileName) => MIGRATION_FILE.test(fileName))
    .map((fileName) => {
      const match = MIGRATION_FILE.exec(fileName)
      const versionText = match?.[1]
      if (versionText === undefined) {
        throw new Error(`invalid migration filename: ${fileName}`)
      }
      const sql = fs.readFileSync(path.join(migrationsPath, fileName), "utf8")
      if (/\bdrop\s+table\b/i.test(sql)) {
        throw new Error(`migration contains forbidden DROP TABLE: ${fileName}`)
      }
      return {
        version: Number.parseInt(versionText, 10),
        fileName,
        sql,
      }
    })
    .sort((left, right) => left.version - right.version)

  const seenVersions = new Set<number>()
  for (const migration of migrations) {
    if (seenVersions.has(migration.version)) {
      throw new Error(`duplicate migration version: ${migration.version}`)
    }
    seenVersions.add(migration.version)
  }
  return migrations
}

function applyMigration(database: Database, migration: Migration): void {
  const apply = database.transaction(() => {
    database.exec(migration.sql)
    database.pragma(`user_version = ${migration.version}`)
  })
  try {
    apply()
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`migration failed: ${migration.fileName}: ${error.message}`)
    }
    throw error
  }
}

function getUserVersion(database: Database): number {
  const version = database.pragma("user_version", { simple: true })
  if (typeof version !== "number") {
    throw new Error("PRAGMA user_version did not return a number")
  }
  return version
}

function defaultMigrationsPath(): string {
  return path.join(__dirname, "migrations")
}
