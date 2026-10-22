import fs from "node:fs"
import path from "node:path"
import type { Database } from "./sqlite-types"

type Migration = {
  readonly version: number
  readonly fileName: string
  readonly sql: string
}

type Token = {
  readonly text: string
  readonly next: number
}

const MIGRATION_FILE = /^(\d+)_.*\.sql$/

/**
 * Tables that hold the user's data. No migration may drop or rename one: a
 * schema change to any of them adds or alters columns in place.
 * `readMigrations` refuses such a file before anything runs.
 */
export const CONTENT_TABLES: ReadonlySet<string> = new Set([
  "workspaces",
  "workflows",
  "workflow_revisions",
  "collections",
  "environments",
  "secrets_metadata",
  "runs",
  "run_responses",
  "run_node_results",
  "project_runs",
  "node_presets",
  "agent_definitions",
  "agent_sessions",
  "agent_run_approvals",
  "agent_local_paths",
  "app_settings",
])

/**
 * Tables holding only state the app can rebuild or do without. The guard never
 * reads this set — it protects `CONTENT_TABLES` and nothing else. It exists so
 * a test can require every table in the schema to be in exactly one of the two.
 */
export const STATE_ONLY_TABLES: ReadonlySet<string> = new Set<string>()

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")*"|\x60(?:[^\x60]|\x60\x60)*\x60|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_$]*)`
const DROP_TABLE_START = /^\s*drop\s+table\b/i
const DROP_TABLE = new RegExp(String.raw`^\s*drop\s+table\s+(?:if\s+exists\s+)?(?:${IDENTIFIER}\s*\.\s*)?(${IDENTIFIER})\s*$`, "i")
const RENAME_TABLE_START = /^\s*alter\s+table\b[\s\S]*\brename\s+to\b/i
const RENAME_TABLE = new RegExp(String.raw`^\s*alter\s+table\s+(?:${IDENTIFIER}\s*\.\s*)?(${IDENTIFIER})\s+rename\s+to\b`, "i")
const IDENTIFIER_QUOTES: ReadonlySet<string> = new Set(['"', "`", "["])
const UNREADABLE_NAME_HINT = "(name the table bare or in double quotes; a single-quoted name reads as a string)"

/**
 * Applies every migration newer than the database's user_version. When at
 * least one is pending, `beforeApply` runs first with the current version —
 * the composition root takes its pre-upgrade backup there.
 */
export function runMigrations(
  database: Database,
  migrationsPath = defaultMigrationsPath(),
  beforeApply?: (currentVersion: number) => void,
): number {
  const migrations = readMigrations(migrationsPath)
  const latestVersion = migrations.at(-1)?.version ?? 0
  const currentVersion = getUserVersion(database)
  if (currentVersion > latestVersion) {
    throw new Error(`migration not found: database user_version ${currentVersion} is newer than current ${latestVersion}`)
  }
  const pending = migrations.filter((migration) => migration.version > currentVersion)
  if (pending.length > 0) {
    beforeApply?.(currentVersion)
  }
  for (const migration of pending) {
    applyMigration(database, migration)
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
      assertContentTablesSurvive(fileName, sql)
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

/**
 * Refuses a `DROP TABLE` of a content table, and an `ALTER TABLE … RENAME TO`
 * of one: SQLite repoints every child's foreign key at the renamed table, so
 * dropping it afterwards cascades the children away. A statement whose table
 * name cannot be read is refused too: the guard fails closed rather than
 * letting it through. Column renames are untouched.
 */
function assertContentTablesSurvive(fileName: string, sql: string): void {
  for (const statement of withoutCommentsAndStrings(sql).split(";")) {
    if (DROP_TABLE_START.test(statement)) {
      assertNotContentTable(fileName, statement, DROP_TABLE, "migration contains forbidden DROP TABLE")
    } else if (RENAME_TABLE_START.test(statement)) {
      assertNotContentTable(fileName, statement, RENAME_TABLE, "migration renames a content table")
    }
  }
}

/** Refuses `statement`, prefixed with `refusal`, when the table `pattern` reads from it is a content table or cannot be read. */
function assertNotContentTable(fileName: string, statement: string, pattern: RegExp, refusal: string): void {
  const table = readTableName(pattern, statement)
  if (table === undefined) {
    throw new Error(`${refusal}: ${fileName}: cannot read the table name in "${statement.trim()}" ${UNREADABLE_NAME_HINT}`)
  }
  if (CONTENT_TABLES.has(table)) {
    throw new Error(`${refusal}: ${fileName}: ${table} holds user data`)
  }
}

function readTableName(pattern: RegExp, statement: string): string | undefined {
  const quoted = pattern.exec(statement)?.[1]
  return quoted === undefined ? undefined : unquoteIdentifier(quoted).toLowerCase()
}

/**
 * The SQL with comments removed and string literals emptied, so a statement
 * boundary or keyword inside prose or a value is never taken for one.
 * Quoted identifiers are kept verbatim.
 */
function withoutCommentsAndStrings(sql: string): string {
  let result = ""
  let index = 0
  while (index < sql.length) {
    const token = readToken(sql, index)
    result += token.text
    index = token.next
  }
  return result
}

/**
 * The comment, string literal, quoted identifier or plain character starting
 * at `index`: the text that replaces it, and the index just past it. A line
 * comment stops before its newline, so the line break survives.
 */
function readToken(sql: string, index: number): Token {
  const char = sql.charAt(index)
  const pair = sql.slice(index, index + 2)
  if (pair === "--") return { text: "", next: endAfter(sql, sql.indexOf("\n", index), 0) }
  if (pair === "/*") return { text: " ", next: endAfter(sql, sql.indexOf("*/", index + 2), 2) }
  if (char === "'") return { text: "''", next: closingQuote(sql, index, "'") + 1 }
  if (IDENTIFIER_QUOTES.has(char)) return readQuotedIdentifier(sql, index)
  return { text: char, next: index + 1 }
}

function readQuotedIdentifier(sql: string, index: number): Token {
  const quote = sql.charAt(index)
  const end = quote === "[" ? sql.indexOf("]", index + 1) : closingQuote(sql, index, quote)
  const stop = endAfter(sql, end, 1)
  return { text: sql.slice(index, stop), next: stop }
}

/** The index past a terminator of `length` found at `found`, or the end of the SQL when none was. */
function endAfter(sql: string, found: number, length: number): number {
  return found === -1 ? sql.length : found + length
}

/** Index of the quote closing the one at `start`, treating a doubled quote as an escape. */
function closingQuote(sql: string, start: number, quote: string): number {
  let index = start + 1
  while (index < sql.length) {
    if (sql.charAt(index) === quote) {
      if (sql.charAt(index + 1) !== quote) return index
      index += 2
    } else {
      index += 1
    }
  }
  return sql.length
}

function unquoteIdentifier(identifier: string): string {
  const first = identifier.charAt(0)
  if (first === "[") return identifier.slice(1, -1)
  if (first === '"' || first === "`") return identifier.slice(1, -1).replaceAll(first + first, first)
  return identifier
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
