import { initDatabase, type InitializedDatabase } from "../../db"

/** Every benchmark task trial starts with a separate in-memory SQLite database. */
export function createMcpBenchmarkDatabase(): InitializedDatabase {
  return initDatabase({ databasePath: ":memory:" })
}
