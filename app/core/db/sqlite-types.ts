export type SqliteValue = string | number | bigint | Buffer | null
export type SqliteNamedParameters = Record<string, SqliteValue>
export type SqliteParameters = SqliteValue[] | SqliteNamedParameters
export type SqliteRow = Record<string, SqliteValue>

export type PragmaOptions = {
  readonly simple?: boolean
}

export type RunResult = {
  readonly changes: number
  readonly lastInsertRowid: number | bigint
}

export interface SqliteStatement<Row extends SqliteRow = SqliteRow> {
  readonly all: (...params: SqliteValue[] | readonly [SqliteNamedParameters]) => readonly Row[]
  readonly get: (...params: SqliteValue[] | readonly [SqliteNamedParameters]) => Row | undefined
  readonly run: (...params: SqliteValue[] | readonly [SqliteNamedParameters]) => RunResult
}

export interface Database {
  readonly name: string
  readonly open: boolean
  close(): void
  exec(sql: string): void
  prepare<Row extends SqliteRow = SqliteRow>(sql: string): SqliteStatement<Row>
  pragma<T extends SqliteValue | readonly SqliteRow[] = readonly SqliteRow[]>(
    source: string,
    options?: PragmaOptions,
  ): T
  transaction<T>(fn: () => T): () => T
}

export interface BetterSqlite3Factory {
  new (filename: string): Database
}
