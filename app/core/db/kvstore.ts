import type { Database, RunResult, SqliteNamedParameters, SqliteParameters, SqliteRow, SqliteValue } from "./sqlite-types"

export interface KVStore {
  get<Row extends SqliteRow>(sql: string, params?: SqliteParameters): Row | undefined
  set(sql: string, params?: SqliteParameters): RunResult
  delete(sql: string, params?: SqliteParameters): RunResult
  query<Row extends SqliteRow>(sql: string, params?: SqliteParameters): readonly Row[]
  transaction<T>(fn: (store: KVStore) => T): T
  exec(sql: string): void
}

export class SyncStore implements KVStore {
  public constructor(private readonly database: Database) {}

  public get<Row extends SqliteRow>(sql: string, params?: SqliteParameters): Row | undefined {
    const statement = this.database.prepare<Row>(sql)
    return params === undefined ? statement.get() : statement.get(...bind(params))
  }

  public set(sql: string, params?: SqliteParameters): RunResult {
    return this.run(sql, params)
  }

  public delete(sql: string, params?: SqliteParameters): RunResult {
    return this.run(sql, params)
  }

  public query<Row extends SqliteRow>(sql: string, params?: SqliteParameters): readonly Row[] {
    const statement = this.database.prepare<Row>(sql)
    return params === undefined ? statement.all() : statement.all(...bind(params))
  }

  public transaction<T>(fn: (store: KVStore) => T): T {
    return this.database.transaction(() => fn(this))()
  }

  public exec(sql: string): void {
    this.database.exec(sql)
  }

  private run(sql: string, params?: SqliteParameters): RunResult {
    const statement = this.database.prepare(sql)
    return params === undefined ? statement.run() : statement.run(...bind(params))
  }
}

export class ThreadStore implements KVStore {
  public constructor() {
    throw new Error("not_implemented")
  }

  public get<Row extends SqliteRow>(_sql: string, _params?: SqliteParameters): Row | undefined {
    throw new Error("not_implemented")
  }

  public set(_sql: string, _params?: SqliteParameters): RunResult {
    throw new Error("not_implemented")
  }

  public delete(_sql: string, _params?: SqliteParameters): RunResult {
    throw new Error("not_implemented")
  }

  public query<Row extends SqliteRow>(_sql: string, _params?: SqliteParameters): readonly Row[] {
    throw new Error("not_implemented")
  }

  public transaction<T>(_fn: (store: KVStore) => T): T {
    throw new Error("not_implemented")
  }

  public exec(_sql: string): void {
    throw new Error("not_implemented")
  }
}

function bind(params: SqliteParameters): SqliteValue[] | readonly [Record<string, SqliteValue>] {
  if (Array.isArray(params)) {
    return params
  }
  const namedParams: SqliteNamedParameters = params
  return [namedParams]
}
