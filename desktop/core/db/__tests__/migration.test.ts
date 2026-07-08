import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { initDatabase, readMigrations, ThreadStore } from "../index"
import { LocalOnlySyncProvider } from "../../sync"
import type { InitializedDatabase, SqliteRow } from "../index"

const tempRoots: string[] = []

describe("database migrations", () => {
  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("creates a fresh database and roundtrips core records", async () => {
    const db = openTempDatabase()
    try {
      const store = db.kvStore
      expect(db.schemaVersion).toBe(3)
      expect(db.database.pragma("user_version", { simple: true })).toBe(3)
      expect(tableNames(store)).toEqual([
        "collections",
        "environments",
        "run_responses",
        "runs",
        "scoped_keys",
        "secrets_metadata",
        "workflows",
        "workspaces",
      ])

      store.transaction((tx) => {
        tx.set("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)", ["workspace-1", "Local", "local"])
        tx.set(
          "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json) VALUES (?, ?, ?, ?, ?, ?)",
          ["workflow-1", "workspace-1", "workspace-1", "Smoke", "smoke", "{}"],
        )
        tx.set("INSERT INTO runs (id, workspace_id, workflow_id, scopeId, status) VALUES (?, ?, ?, ?, ?)", [
          "run-1",
          "workspace-1",
          "workflow-1",
          "workspace-1",
          "queued",
        ])
      })

      const workspace = store.get("SELECT id, origin, syncMode, rev, createdAt, updatedAt FROM workspaces WHERE id = ?", [
        "workspace-1",
      ])
      expect(workspace).toMatchObject({ id: "workspace-1", origin: "local", syncMode: "none", rev: 1 })
      expect(workspace?.createdAt).toEqual(expect.any(String))
      expect(workspace?.updatedAt).toEqual(expect.any(String))

      const workflowBefore = store.get("SELECT id, rev, updatedAt FROM workflows WHERE id = ?", ["workflow-1"])
      store.set("UPDATE workflows SET name = ? WHERE id = ?", ["Smoke renamed", "workflow-1"])
      const workflowAfter = store.get("SELECT id, name, rev, updatedAt FROM workflows WHERE id = ?", ["workflow-1"])
      expect(workflowBefore?.rev).toBe(1)
      expect(workflowAfter).toMatchObject({ id: "workflow-1", name: "Smoke renamed", rev: 2 })
      expect(workflowAfter?.updatedAt).not.toBe(workflowBefore?.updatedAt)

      const run = store.get("SELECT id, rev, createdAt, updatedAt FROM runs WHERE id = ?", ["run-1"])
      expect(run).toMatchObject({ id: "run-1", rev: 1 })
      expect(run?.createdAt).toEqual(expect.any(String))
      expect(run?.updatedAt).toEqual(expect.any(String))

      const secondOpen = initDatabase({ databasePath: db.databasePath })
      try {
        expect(secondOpen.schemaVersion).toBe(3)
      } finally {
        secondOpen.close()
      }

      const syncProvider = new LocalOnlySyncProvider()
      await expect(syncProvider.pull()).resolves.toBeUndefined()
      await expect(syncProvider.push()).resolves.toBeUndefined()
      expect(() => new ThreadStore()).toThrow("not_implemented")
    } finally {
      db.close()
    }
  })

  it("spills large response bodies to the side table and cascades deletes", () => {
    const db = openTempDatabase()
    try {
      const store = db.kvStore
      seedRunParentRows(db)
      const largeBody = Buffer.alloc(5 * 1024 * 1024, "x")
      store.set(
        "INSERT INTO runs (id, workspace_id, workflow_id, scopeId, status, response_metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
        ["run-large", "workspace-1", "workflow-1", "workspace-1", "completed", '{"bodyStorage":"side"}'],
      )
      store.set("INSERT INTO run_responses (run_id, node_id, body, size) VALUES (?, ?, ?, ?)", [
        "run-large",
        "http-1",
        largeBody,
        largeBody.length,
      ])

      const spilled = store.get("SELECT run_id, node_id, size FROM run_responses WHERE run_id = ?", ["run-large"])
      const largeRun = store.get("SELECT response_body_inline, response_body_size FROM runs WHERE id = ?", ["run-large"])
      expect(spilled).toMatchObject({ run_id: "run-large", node_id: "http-1", size: largeBody.length })
      expect(largeRun).toMatchObject({ response_body_inline: null, response_body_size: 0 })

      store.delete("DELETE FROM runs WHERE id = ?", ["run-large"])
      expect(store.get("SELECT run_id FROM run_responses WHERE run_id = ?", ["run-large"])).toBeUndefined()

      const smallBody = Buffer.alloc(50 * 1024, "y")
      store.set(
        "INSERT INTO runs (id, workspace_id, workflow_id, scopeId, status, response_body_inline, response_body_size) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ["run-small", "workspace-1", "workflow-1", "workspace-1", "completed", smallBody, smallBody.length],
      )
      const smallRun = store.get("SELECT response_body_size FROM runs WHERE id = ?", ["run-small"])
      expect(smallRun).toMatchObject({ response_body_size: smallBody.length })
      expect(store.get("SELECT run_id FROM run_responses WHERE run_id = ?", ["run-small"])).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it("halts clearly when database user_version is newer than known migrations", () => {
    const db = openTempDatabase()
    try {
      const store = db.kvStore
      seedRunParentRows(db)
      store.set("UPDATE workflows SET name = ? WHERE id = ?", ["Before unknown migration", "workflow-1"])
      db.database.pragma("user_version = 99")

      expect(() => initDatabase({ databasePath: db.databasePath })).toThrow(
        "migration not found: database user_version 99 is newer than current 3",
      )
      const workflow = store.get("SELECT id, name FROM workflows WHERE id = ?", ["workflow-1"])
      expect(workflow).toMatchObject({ id: "workflow-1", name: "Before unknown migration" })
    } finally {
      db.close()
    }
  })

  it("rolls back a failed migration transaction", () => {
    const tempRoot = makeTempRoot()
    const migrationsPath = path.join(tempRoot, "migrations")
    fs.mkdirSync(migrationsPath)
    fs.copyFileSync(path.join(__dirname, "..", "migrations", "001_init.sql"), path.join(migrationsPath, "001_init.sql"))
    fs.writeFileSync(
      path.join(migrationsPath, "002_bad.sql"),
      "CREATE TABLE migration_probe (id TEXT PRIMARY KEY);\nINSERT INTO missing_table (id) VALUES ('x');\n",
    )

    expect(() => initDatabase({ databasePath: path.join(tempRoot, "bad.db"), migrationsPath })).toThrow(
      "migration failed: 002_bad.sql",
    )

    const recovered = initDatabase({ databasePath: path.join(tempRoot, "bad.db"), migrationsPath: path.join(__dirname, "..", "migrations") })
    try {
      expect(recovered.kvStore.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ["migration_probe"])).toBeUndefined()
      expect(recovered.schemaVersion).toBe(3)
    } finally {
      recovered.close()
    }
  })

  it("rejects destructive migration files before execution", () => {
    const tempRoot = makeTempRoot()
    const migrationsPath = path.join(tempRoot, "migrations")
    fs.mkdirSync(migrationsPath)
    fs.writeFileSync(path.join(migrationsPath, "001_bad.sql"), "DROP TABLE workflows;\n")
    expect(() => readMigrations(migrationsPath)).toThrow("migration contains forbidden DROP TABLE: 001_bad.sql")
  })
})

function openTempDatabase(): InitializedDatabase {
  return initDatabase({ databasePath: path.join(makeTempRoot(), "apiweave-test.db") })
}

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-db-"))
  tempRoots.push(tempRoot)
  return tempRoot
}

function tableNames(store: InitializedDatabase["kvStore"]): readonly string[] {
  return store
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string")
}

function seedRunParentRows(db: InitializedDatabase): void {
  db.kvStore.transaction((store) => {
    store.set("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)", ["workspace-1", "Local", "local"])
    store.set("INSERT INTO workflows (id, workspace_id, scopeId, name, slug) VALUES (?, ?, ?, ?, ?)", [
      "workflow-1",
      "workspace-1",
      "workspace-1",
      "Smoke",
      "smoke",
    ])
  })
}
