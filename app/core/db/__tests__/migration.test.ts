import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { initDatabase, readMigrations, ThreadStore } from "../index"
import { vacuumIfFragmented } from "../maintenance"
import { CONTENT_TABLES, STATE_ONLY_TABLES } from "../migrations"
import type { InitializedDatabase } from "../index"
import type { BetterSqlite3Factory, SqliteRow } from "../sqlite-types"

vi.mock("../maintenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../maintenance")>()
  return { ...actual, vacuumIfFragmented: vi.fn(actual.vacuumIfFragmented) }
})

const tempRoots: string[] = []
const CURRENT_SCHEMA_VERSION = readMigrations().at(-1)?.version ?? 0

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
      expect(db.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(db.database.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
      expect(tableNames(store)).toEqual([
        "agent_definitions",
        "agent_local_paths",
        "agent_run_approvals",
        "agent_sessions",
        "app_settings",
        "collections",
        "environments",
        "node_presets",
        "project_runs",
        "run_node_results",
        "run_responses",
        "runs",
        "secrets_metadata",
        "workflow_revisions",
        "workflows",
        "workspace_git",
        "workspace_merge",
        "workspace_merge_pick",
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

      const workspace = store.get("SELECT id, rev, createdAt, updatedAt FROM workspaces WHERE id = ?", ["workspace-1"])
      expect(workspace).toMatchObject({ id: "workspace-1", rev: 1 })
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
        expect(secondOpen.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      } finally {
        secondOpen.close()
      }

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
        `migration not found: database user_version 99 is newer than current ${CURRENT_SCHEMA_VERSION}`,
      )
      const workflow = store.get("SELECT id, name FROM workflows WHERE id = ?", ["workflow-1"])
      expect(workflow).toMatchObject({ id: "workflow-1", name: "Before unknown migration" })
    } finally {
      db.close()
    }
  })

  it("upgrades a v5 database with duplicate cloud bindings and keeps every workspace", () => {
    const tempRoot = makeTempRoot()
    const databasePath = path.join(tempRoot, "upgrade.db")
    const old = initDatabase({ databasePath, migrationsPath: copyMigrations(tempRoot, 5) })
    old.kvStore.set("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)", ["workspace-1", "Local", "local"])
    old.kvStore.set("INSERT INTO workspaces (id, name, slug, origin, syncMode) VALUES (?, ?, ?, ?, ?)", [
      "workspace-2",
      "Duplicate",
      "duplicate",
      "cloud",
      "bi-directional",
    ])
    old.kvStore.set(
      "INSERT INTO cloud_workspace_bindings (workspace_id, cloud_workspace_id, sync_mode) VALUES (?, ?, ?)",
      ["workspace-1", "cloud-1", "bi-directional"],
    )
    old.kvStore.set(
      "INSERT INTO cloud_workspace_bindings (workspace_id, cloud_workspace_id, sync_mode) VALUES (?, ?, ?)",
      ["workspace-2", "cloud-1", "bi-directional"],
    )
    old.kvStore.set(
      "INSERT INTO cloud_outbox (id, kind, record_id, workspace_id, expected_rev, op, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["outbox-duplicate", "workflow", "workflow-dirty", "workspace-2", 0, "upsert", Buffer.from("{}"), Date.now()],
    )
    old.kvStore.set("INSERT INTO workflows (id, workspace_id, scopeId, name, slug) VALUES (?, ?, ?, ?, ?)", [
      "workflow-dirty",
      "workspace-2",
      "workspace-2",
      "Dirty",
      "dirty",
    ])
    old.close()

    const upgraded = initDatabase({ databasePath })
    try {
      expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(upgraded.kvStore.query("SELECT id, name FROM workspaces ORDER BY id")).toEqual([
        { id: "workspace-1", name: "Local" },
        { id: "workspace-2", name: "Duplicate" },
      ])
      expect(upgraded.kvStore.query("SELECT id, workspace_id FROM workflows")).toEqual([
        { id: "workflow-dirty", workspace_id: "workspace-2" },
      ])
      expect(cloudLeftovers(upgraded)).toEqual([])
      expect(upgraded.database.pragma("foreign_key_check")).toEqual([])
    } finally {
      upgraded.close()
    }
  })

  it("moves each run's results out of the metadata blob into one row per node, in order", () => {
    const tempRoot = makeTempRoot()
    const oldMigrationsPath = path.join(tempRoot, "migrations-v16")
    fs.mkdirSync(oldMigrationsPath)
    for (const fileName of fs.readdirSync(path.join(__dirname, "..", "migrations"))) {
      if (/^(00\d|01[0-6])_.*\.sql$/.test(fileName)) {
        fs.copyFileSync(path.join(__dirname, "..", "migrations", fileName), path.join(oldMigrationsPath, fileName))
      }
    }
    const databasePath = path.join(tempRoot, "results-upgrade.db")
    const old = initDatabase({ databasePath, migrationsPath: oldMigrationsPath })
    seedRunParentRows(old)
    old.kvStore.set(
      "INSERT INTO runs (id, workspace_id, workflow_id, scopeId, status, response_metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "run-1",
        "workspace-1",
        "workflow-1",
        "workspace-1",
        "completed",
        JSON.stringify({ trigger: "schedule", results: [{ nodeId: "b", status: "passed" }, { nodeId: "a", status: "failed" }] }),
      ],
    )
    old.close()

    const upgraded = initDatabase({ databasePath })
    try {
      expect(upgraded.kvStore.query("SELECT node_id FROM run_node_results WHERE run_id = 'run-1' ORDER BY rowid"))
        .toEqual([{ node_id: "b" }, { node_id: "a" }])
      expect(JSON.parse(upgraded.kvStore.get<{ m: string }>("SELECT response_metadata_json AS m FROM runs")!.m))
        .toEqual({ trigger: "schedule" })
    } finally {
      upgraded.close()
    }
  })

  it("upgrades a v8 database with Team bindings, outbox rows and a linked account", () => {
    const tempRoot = makeTempRoot()
    const databasePath = path.join(tempRoot, "team-binding-upgrade.db")
    const old = initDatabase({ databasePath, migrationsPath: copyMigrations(tempRoot, 8) })
    old.kvStore.transaction((store) => {
      store.set("INSERT INTO workspaces (id, name, slug, origin, syncMode) VALUES (?, ?, ?, ?, ?)", [
        "team-workspace",
        "Team",
        "team",
        "team",
        "bi-directional",
      ])
      store.set("INSERT INTO workflows (id, workspace_id, scopeId, name, slug) VALUES (?, ?, ?, ?, ?)", [
        "team-workflow",
        "team-workspace",
        "team-workspace",
        "Team flow",
        "team-flow",
      ])
      store.set("INSERT INTO environments (id, workspace_id, scopeId, name, slug) VALUES (?, ?, ?, ?, ?)", [
        "team-env",
        "team-workspace",
        "team-workspace",
        "Staging",
        "staging",
      ])
      store.set(
        "INSERT INTO cloud_workspace_bindings (workspace_id, cloud_workspace_id, team_id, sync_mode) VALUES (?, ?, ?, ?)",
        ["team-workspace", "cloud-team-workspace", "team-1", "bi-directional"],
      )
      store.set(
        "INSERT INTO cloud_outbox (id, kind, record_id, workspace_id, expected_rev, op, payload, created_at, is_baseline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["outbox-1", "workflow", "team-workflow", "team-workspace", 1, "upsert", Buffer.from("{}"), Date.now(), 1],
      )
      // 014 backfills cloud_workspace_accounts from the linked account.
      store.set("INSERT INTO app_settings (key, value) VALUES (?, ?)", ["cloud.account_identity", '{"accountId":"acct-1"}'])
    })
    old.close()

    const upgraded = initDatabase({ databasePath })
    try {
      expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(upgraded.kvStore.query("SELECT id FROM workspaces")).toEqual([{ id: "team-workspace" }])
      expect(upgraded.kvStore.query("SELECT id FROM workflows")).toEqual([{ id: "team-workflow" }])
      expect(upgraded.kvStore.query("SELECT id FROM environments")).toEqual([{ id: "team-env" }])
      expect(cloudLeftovers(upgraded)).toEqual([])
      expect(upgraded.database.pragma("foreign_key_check")).toEqual([])
    } finally {
      upgraded.close()
    }
  })

  // Each case upgrades its own copy of the fixture: two of them write to it.
  describe("dropping the Cloud schema (pre-023 fixture with real Cloud rows)", () => {
    const keptSettings = [
      { key: "Cloud.Upper" },
      { key: "agents.cloud.x" },
      { key: "agents.default" },
      { key: "cloud_underscore" },
      { key: "cloudy.theme" },
      { key: "mcp.enabled" },
    ]

    it("keeps every content row and leaves no foreign key dangling", () => {
      const { upgraded, before } = upgradeCloudFixture()
      try {
        expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
        expect(upgraded.database.pragma("foreign_keys", { simple: true })).toBe(1)
        expect(upgraded.database.pragma("foreign_key_check")).toEqual([])
        expect(contentRows(upgraded)).toEqual({
          ...before,
          workspaces: (before["workspaces"] ?? []).map(({ origin: _origin, syncMode: _syncMode, ...row }) => row),
          app_settings: (before["app_settings"] ?? []).filter((row) => !String(row["key"]).startsWith("cloud.")),
          // Created after the fixture's version, so they start empty.
          workspace_git: [],
          workspace_merge: [],
          workspace_merge_pick: [],
        })
      } finally {
        upgraded.close()
      }
    })

    it("drops the Cloud tables, the workspace columns and the cloud.* settings, and nothing near them", () => {
      const { upgraded, cloudTables } = upgradeCloudFixture()
      try {
        const tables = tableNames(upgraded.kvStore)
        for (const dropped of [...cloudTables, "scoped_keys"]) {
          expect(tables).not.toContain(dropped)
        }
        expect(cloudLeftovers(upgraded)).toEqual([])
        expect(upgraded.kvStore.query("SELECT key FROM app_settings ORDER BY key")).toEqual(keptSettings)
        const workspaceColumns = upgraded.kvStore.query("SELECT name FROM pragma_table_info('workspaces')").map((row) => row["name"])
        expect(workspaceColumns).not.toContain("origin")
        expect(workspaceColumns).not.toContain("syncMode")
        expect(workspaceColumns).toEqual(["id", "name", "slug", "settings_json", "rev", "createdAt", "updatedAt"])
      } finally {
        upgraded.close()
      }
    })

    it("drops Cloud's indexes and trigger and no others", () => {
      const { upgraded, indexesBefore, triggersBefore } = upgradeCloudFixture()
      try {
        expect(schemaObjects(upgraded, "index")).toEqual(
          indexesBefore.filter((name) => !name.startsWith("idx_cloud_") && name !== "idx_scoped_keys_scope"),
        )
        expect(schemaObjects(upgraded, "trigger")).toEqual(triggersBefore.filter((name) => name !== "scoped_keys_touch"))
      } finally {
        upgraded.close()
      }
    })

    it("still bumps rev and updatedAt when a rebuilt workspace row changes", () => {
      const { upgraded, before } = upgradeCloudFixture()
      try {
        const workspaceBefore = before["workspaces"]?.find((row) => row["id"] === "ws-cloud")
        upgraded.kvStore.set("UPDATE workspaces SET name = ? WHERE id = ?", ["Cloud renamed", "ws-cloud"])
        const workspaceAfter = upgraded.kvStore.get("SELECT rev, updatedAt FROM workspaces WHERE id = ?", ["ws-cloud"])
        expect(workspaceAfter?.["rev"]).toBe(Number(workspaceBefore?.["rev"]) + 1)
        expect(workspaceAfter?.["updatedAt"]).not.toBe(workspaceBefore?.["updatedAt"])
      } finally {
        upgraded.close()
      }
    })

    // The cascade from workspaces still reaches every child, directly or through
    // workflows, runs and collections. agent_local_paths has no FK by design
    // (015_agents.sql) and app_settings is not workspace-scoped: both stay.
    it("still cascades a workspace delete to every child table", () => {
      const cascaded = [
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
        "workspace_git",
        "workspace_merge",
        "workspace_merge_pick",
      ]
      expect(new Set([...cascaded, "workspaces", "agent_local_paths", "app_settings"])).toEqual(CONTENT_TABLES)
      const { upgraded, before } = upgradeCloudFixture()
      try {
        // The fixture predates the git tables, so the rows they must cascade are written here.
        upgraded.kvStore.set("INSERT INTO workspace_git (workspace_id) VALUES (?)", ["ws-cloud"])
        upgraded.kvStore.set(
          "INSERT INTO workspace_merge (workspace_id, base_commit, our_commit, their_commit) VALUES (?, ?, ?, ?)",
          ["ws-cloud", "base", "ours", "theirs"],
        )
        upgraded.kvStore.set(
          "INSERT INTO workspace_merge_pick (workspace_id, base_commit, record_id, path, side) VALUES (?, ?, ?, ?, ?)",
          ["ws-cloud", "base", "wf", "name", "ours"],
        )
        upgraded.kvStore.delete("DELETE FROM workspaces WHERE id = ?", ["ws-cloud"])
        const afterDelete = contentRows(upgraded)
        for (const table of cascaded) {
          expect(afterDelete[table], `${table} must cascade from workspaces`).toEqual([])
        }
        expect(afterDelete["workspaces"]?.map((row) => row["id"])).toEqual(["ws-local"])
        expect(afterDelete["agent_local_paths"]).toEqual(before["agent_local_paths"])
        expect(upgraded.kvStore.query("SELECT key FROM app_settings ORDER BY key")).toEqual(keptSettings)
        expect(upgraded.database.pragma("foreign_key_check")).toEqual([])
      } finally {
        upgraded.close()
      }
    })
  })

  it("keeps a merge waiting through the upgrade that makes its base commit nullable", () => {
    const tempRoot = makeTempRoot()
    const databasePath = path.join(tempRoot, "merge-upgrade.db")
    const old = initDatabase({ databasePath, migrationsPath: copyMigrations(tempRoot, 27) })
    old.kvStore.transaction((store) => {
      store.set("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)", ["ws-1", "Local", "local"])
      store.set("INSERT INTO workspace_git (workspace_id) VALUES (?)", ["ws-1"])
      store.set("INSERT INTO workspace_merge (workspace_id, base_commit, our_commit, their_commit) VALUES (?, ?, ?, ?)", [
        "ws-1",
        "base",
        "ours",
        "theirs",
      ])
      store.set("INSERT INTO workspace_merge_pick (workspace_id, base_commit, record_id, path, side) VALUES (?, ?, ?, ?, ?)", [
        "ws-1",
        "base",
        "wf",
        "name",
        "ours",
      ])
    })
    old.close()

    const upgraded = initDatabase({ databasePath })
    try {
      expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      // The waiting merge and its picks survive: they are decisions, not the schema's to drop.
      expect(upgraded.kvStore.query("SELECT workspace_id, base_commit, our_commit, their_commit FROM workspace_merge")).toEqual([
        { workspace_id: "ws-1", base_commit: "base", our_commit: "ours", their_commit: "theirs" },
      ])
      expect(upgraded.kvStore.query("SELECT base_commit, record_id FROM workspace_merge_pick")).toEqual([{ base_commit: "base", record_id: "wf" }])
      // A two-way merge is a row with no base at all.
      upgraded.kvStore.set("INSERT OR REPLACE INTO workspace_merge (workspace_id, base_commit, our_commit, their_commit) VALUES (?, NULL, ?, ?)", [
        "ws-1",
        "ours",
        "theirs",
      ])
      expect(upgraded.kvStore.get("SELECT base_commit FROM workspace_merge WHERE workspace_id = ?", ["ws-1"])).toEqual({ base_commit: null })
      // The divergence a two-way merge leaves needs to remember its basis after the row is gone.
      expect(upgraded.kvStore.get("SELECT unrelated_merge FROM workspace_git WHERE workspace_id = ?", ["ws-1"])).toEqual({ unrelated_merge: 0 })
      expect(upgraded.database.pragma("foreign_key_check")).toEqual([])
    } finally {
      upgraded.close()
    }
  })

  it("keeps a merge's picks through the upgrade that lets a pick hold a value, and reads both back", () => {
    const tempRoot = makeTempRoot()
    const databasePath = path.join(tempRoot, "merge-value-upgrade.db")
    const old = initDatabase({ databasePath, migrationsPath: copyMigrations(tempRoot, 28) })
    old.kvStore.transaction((store) => {
      store.set("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)", ["ws-1", "Local", "local"])
      store.set("INSERT INTO workspace_git (workspace_id) VALUES (?)", ["ws-1"])
      store.set("INSERT INTO workspace_merge (workspace_id, base_commit, our_commit, their_commit) VALUES ('ws-1', NULL, 'ours', 'theirs')")
      store.set("INSERT INTO workspace_merge_pick (workspace_id, base_commit, record_id, path, side) VALUES (?, NULL, 'wf', 'name', 'ours')", ["ws-1"])
    })
    old.close()

    const upgraded = initDatabase({ databasePath })
    try {
      expect(upgraded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(upgraded.kvStore.query("SELECT record_id, path, side, value FROM workspace_merge_pick")).toEqual([
        { record_id: "wf", path: "name", side: "ours", value: null },
      ])
      // A pick of the user's own carries a value and no side.
      upgraded.kvStore.set("INSERT INTO workspace_merge_pick (workspace_id, base_commit, record_id, path, side, value) VALUES (?, NULL, 'wf', 'description', NULL, ?)", [
        "ws-1",
        '{"note":"kept"}',
      ])
      expect(upgraded.kvStore.query("SELECT path, side, value FROM workspace_merge_pick ORDER BY path")).toEqual([
        { path: "description", side: null, value: '{"note":"kept"}' },
        { path: "name", side: "ours", value: null },
      ])
      expect(upgraded.database.pragma("foreign_key_check")).toEqual([])
    } finally {
      upgraded.close()
    }
  })

  it("numbers its migrations 1..N with no gaps and no duplicates", () => {
    // The runner applies `version > user_version` only, so a gap is a migration
    // a later branch would add below the version already stamped and never run.
    const versions = readMigrations().map((migration) => migration.version)
    expect(versions).toEqual(Array.from({ length: versions.length }, (_, index) => index + 1))
  })

  it("classifies every table as content or state", () => {
    const db = openTempDatabase()
    try {
      const tables = tableNames(db.kvStore)
      const unclassified = tables.filter((name) => !CONTENT_TABLES.has(name) && !STATE_ONLY_TABLES.has(name))
      expect(unclassified, "add each new table to CONTENT_TABLES or STATE_ONLY_TABLES in core/db/migrations.ts").toEqual([])
      expect([...CONTENT_TABLES].filter((name) => !tables.includes(name))).toEqual([])
      expect([...STATE_ONLY_TABLES].filter((name) => !tables.includes(name))).toEqual([])
      expect([...CONTENT_TABLES].filter((name) => STATE_ONLY_TABLES.has(name))).toEqual([])
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
      expect(recovered.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    } finally {
      recovered.close()
    }
  })

  it("backs up the database before migrating it and keeps the newest five copies", () => {
    const tempRoot = makeTempRoot()
    const oldMigrationsPath = copyMigrations(tempRoot, 1)
    const databasePath = path.join(tempRoot, "apiweave.db")
    initDatabase({ databasePath, migrationsPath: oldMigrationsPath }).close()
    const backups = path.join(tempRoot, "backups")
    expect(fs.existsSync(backups)).toBe(false)
    fs.mkdirSync(backups)
    for (let index = 0; index < 6; index += 1) {
      fs.writeFileSync(path.join(backups, `apiweave-2020-01-0${index + 1}T00-00-00-000Z-v1.db`), "")
    }

    const upgraded = initDatabase({ databasePath })
    upgraded.close()

    const kept = fs.readdirSync(backups).sort()
    expect(kept).toHaveLength(5)
    const fresh = kept.at(-1)!
    expect(fresh).toMatch(/^apiweave-\d{4}-.+-v1\.db$/)
    const copy = initDatabase({ databasePath: path.join(backups, fresh), migrationsPath: oldMigrationsPath })
    try {
      expect(copy.schemaVersion).toBe(1)
    } finally {
      copy.close()
    }
  })

  it("names the backup when a migration fails", () => {
    const tempRoot = makeTempRoot()
    const migrationsPath = copyMigrations(tempRoot, 1)
    const databasePath = path.join(tempRoot, "apiweave.db")
    initDatabase({ databasePath, migrationsPath }).close()
    fs.writeFileSync(path.join(migrationsPath, "002_bad.sql"), "INSERT INTO missing_table (id) VALUES ('x');\n")

    expect(() => initDatabase({ databasePath, migrationsPath })).toThrow(
      new RegExp(`migration failed: 002_bad\\.sql.*backed up before the upgrade to ${escapeRegExp(path.join(tempRoot, "backups"))}`),
    )
  })

  it("refuses a damaged database file and points at the backups folder", () => {
    const tempRoot = makeTempRoot()
    const databasePath = path.join(tempRoot, "apiweave.db")
    fs.writeFileSync(databasePath, "this is not an sqlite file".repeat(200))

    expect(() => initDatabase({ databasePath })).toThrow(
      new RegExp(`damaged.*${escapeRegExp(path.join(tempRoot, "backups"))}`),
    )
  })

  // Root ignores file permissions, so the file would open read-write.
  it.skipIf(process.getuid?.() === 0)("reports a read-only database as unopenable, not damaged", () => {
    const tempRoot = makeTempRoot()
    const databasePath = path.join(tempRoot, "apiweave.db")
    // A rollback-journal file: switching it to WAL is a write, which fails.
    const sqliteFactory: BetterSqlite3Factory = require("better-sqlite3")
    const plain = new sqliteFactory(databasePath)
    plain.exec("CREATE TABLE t (x)")
    plain.close()
    fs.chmodSync(databasePath, 0o444)

    let message = ""
    try {
      initDatabase({ databasePath }).close()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(new RegExp(`^Could not open the database ${escapeRegExp(databasePath)}: .*readonly`))
    expect(message).not.toMatch(/damaged|backups/)
  })

  it("compacts the file at startup once a quarter of it is free", () => {
    const db = openTempDatabase()
    db.database.exec("CREATE TABLE filler (b BLOB)")
    db.database.exec(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 12) INSERT INTO filler SELECT randomblob(1024 * 1024) FROM n",
    )
    db.database.exec("DELETE FROM filler")
    expect(db.database.pragma("freelist_count", { simple: true })).toBeGreaterThan(0)
    db.close()

    const reopened = initDatabase({ databasePath: db.databasePath })
    try {
      expect(reopened.database.pragma("freelist_count", { simple: true })).toBe(0)
    } finally {
      reopened.close()
    }
  })

  it("still opens the database when the startup VACUUM fails", () => {
    const db = openTempDatabase()
    db.close()
    vi.mocked(vacuumIfFragmented).mockImplementationOnce(() => {
      throw new Error("SQLITE_FULL: database or disk is full")
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      const reopened = initDatabase({ databasePath: db.databasePath })
      reopened.close()
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })

  it("removes secrets orphaned by environments deleted before the cascade existed", () => {
    const tempRoot = makeTempRoot()
    const databasePath = path.join(tempRoot, "apiweave.db")
    const old = initDatabase({ databasePath, migrationsPath: copyMigrations(tempRoot, 18) })
    old.kvStore.set("INSERT INTO workspaces (id, name, slug) VALUES ('ws', 'W', 'w')")
    old.kvStore.set("INSERT INTO environments (id, workspace_id, scopeId, name, slug) VALUES ('env', 'ws', 'ws', 'E', 'e')")
    for (const [id, scopeType, scopeId] of [["live", "environment", "env"], ["orphan", "environment", "gone"], ["ws", "workspace", "ws"]]) {
      old.kvStore.set(
        "INSERT INTO secrets_metadata (id, workspace_id, scopeType, scopeId, key, label) VALUES (?, 'ws', ?, ?, 'K', '')",
        [id!, scopeType!, scopeId!],
      )
    }
    old.close()

    const upgraded = initDatabase({ databasePath })
    try {
      expect(upgraded.kvStore.query("SELECT id FROM secrets_metadata ORDER BY id")).toEqual([{ id: "live" }, { id: "ws" }])
    } finally {
      upgraded.close()
    }
  })

  it("rejects destructive migration files before execution", () => {
    const tempRoot = makeTempRoot()
    const migrationsPath = path.join(tempRoot, "migrations")
    fs.mkdirSync(migrationsPath)
    fs.writeFileSync(path.join(migrationsPath, "001_bad.sql"), "DROP TABLE workflows;\n")
    expect(() => readMigrations(migrationsPath)).toThrow("migration contains forbidden DROP TABLE: 001_bad.sql")
  })

  it.each([
    ["IF EXISTS", "DROP TABLE IF EXISTS runs;", "runs"],
    ["lower case without a semicolon", "drop table secrets_metadata", "secrets_metadata"],
    ["a schema prefix", "DROP TABLE main.environments;", "environments"],
    ["double quotes and mixed case", 'DROP TABLE IF EXISTS "main"."Workspaces";', "workspaces"],
    ["backticks", "DROP TABLE `collections`;", "collections"],
    ["brackets", "DROP TABLE [app_settings];", "app_settings"],
    ["a statement after another on the same line", "SELECT 1; DROP TABLE\n  agent_sessions ;", "agent_sessions"],
  ])("rejects a content-table drop written with %s", (_label, sql, table) => {
    const migrationsPath = writeMigration(sql)
    expect(() => readMigrations(migrationsPath)).toThrow(
      `migration contains forbidden DROP TABLE: 001_drop.sql: ${table} holds user data`,
    )
  })

  it.each([
    ["an unterminated quote", 'DROP TABLE "workflows;\n'],
    ["a single-quoted name", "DROP TABLE 'runs';"],
  ])("refuses a DROP TABLE whose table name it cannot read: %s", (_label, sql) => {
    const migrationsPath = writeMigration(sql)
    expect(() => readMigrations(migrationsPath)).toThrow(
      "migration contains forbidden DROP TABLE: 001_drop.sql: cannot read the table name",
    )
  })

  it.each([
    ["a plain rename", "ALTER TABLE workspaces RENAME TO workspaces_old;", "workspaces"],
    ["lower case without a semicolon", "alter table runs rename to runs_old", "runs"],
    ["a schema prefix", "ALTER TABLE main.workflows RENAME TO workflows_old;", "workflows"],
    ["double quotes, mixed case and whitespace", 'ALTER\n\tTABLE "Workspaces"\n\tRENAME\tTO\n"old";', "workspaces"],
    [
      "the rename-then-drop that cascades every child away",
      "ALTER TABLE workspaces RENAME TO workspaces_old;\nDROP TABLE workspaces_old;",
      "workspaces",
    ],
  ])("rejects a content-table rename written with %s", (_label, sql, table) => {
    const migrationsPath = writeMigration(sql)
    expect(() => readMigrations(migrationsPath)).toThrow(`migration renames a content table: 001_drop.sql: ${table} holds user data`)
  })

  it("refuses a table rename whose table name it cannot read", () => {
    const migrationsPath = writeMigration('ALTER TABLE "workspaces RENAME TO x;\n')
    expect(() => readMigrations(migrationsPath)).toThrow("migration renames a content table: 001_drop.sql: cannot read the table name")
  })

  it.each([
    ["a non-content table rename", "ALTER TABLE cloud_outbox RENAME TO cloud_outbox_old;"],
    ["RENAME COLUMN", "ALTER TABLE workspaces RENAME COLUMN id TO x;"],
    ["the legacy column rename", "ALTER TABLE workspaces RENAME id TO x;"],
  ])("allows %s", (_label, sql) => {
    const migrationsPath = writeMigration(sql)
    expect(readMigrations(migrationsPath).map((migration) => migration.fileName)).toEqual(["001_drop.sql"])
  })

  it("allows dropping a table that holds no content, and ignores DROP TABLE in comments and strings", () => {
    const migrationsPath = writeMigration(
      [
        "-- DROP TABLE workflows; the environment's rows stay",
        "/* DROP TABLE runs; */",
        "INSERT INTO app_settings (key, value) VALUES ('note', 'it''s fine; DROP TABLE workspaces');",
        'CREATE TABLE "odd -- name" (id TEXT);',
        "DROP TABLE IF EXISTS cloud_outbox;",
        "",
      ].join("\n"),
    )
    expect(readMigrations(migrationsPath).map((migration) => migration.fileName)).toEqual(["001_drop.sql"])
  })
})

function writeMigration(sql: string): string {
  const migrationsPath = path.join(makeTempRoot(), "migrations")
  fs.mkdirSync(migrationsPath)
  fs.writeFileSync(path.join(migrationsPath, "001_drop.sql"), sql)
  return migrationsPath
}

function contentRows(db: InitializedDatabase): Record<string, readonly SqliteRow[]> {
  const existing = new Set(tableNames(db.kvStore))
  return Object.fromEntries(
    [...CONTENT_TABLES]
      .filter((table) => existing.has(table))
      .map((table) => [table, db.kvStore.query(`SELECT * FROM "${table}" ORDER BY rowid`)]),
  )
}

/** Anything Cloud left behind: its tables, the workspace columns, or `cloud.*` settings. */
function cloudLeftovers(db: InitializedDatabase): readonly string[] {
  const tables = tableNames(db.kvStore).filter((name) => name.startsWith("cloud_") || name === "scoped_keys")
  const columns = db.kvStore
    .query("SELECT name FROM pragma_table_info('workspaces') WHERE name IN ('origin', 'syncMode')")
    .map((row) => `workspaces.${String(row["name"])}`)
  const settings = db.kvStore
    .query("SELECT key FROM app_settings WHERE key GLOB 'cloud.*'")
    .map((row) => `app_settings:${String(row["key"])}`)
  return [...tables, ...columns, ...settings]
}

function schemaObjects(db: InitializedDatabase, type: "index" | "trigger"): readonly string[] {
  return db.kvStore
    .query("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name", [type])
    .map((row) => String(row["name"]))
}

interface CloudUpgrade {
  readonly upgraded: InitializedDatabase
  /** Every content table's rows in the v22 database. */
  readonly before: Record<string, readonly SqliteRow[]>
  readonly cloudTables: readonly string[]
  readonly indexesBefore: readonly string[]
  readonly triggersBefore: readonly string[]
}

/**
 * Seeds the v22 fixture, checks it holds a row in every content and Cloud
 * table — without them the assertions after the upgrade mean nothing — and
 * opens it at the current schema. The caller closes `upgraded`.
 */
function upgradeCloudFixture(): CloudUpgrade {
  const tempRoot = makeTempRoot()
  const databasePath = path.join(tempRoot, "cloud-upgrade.db")
  const old = initDatabase({ databasePath, migrationsPath: copyMigrations(tempRoot, 22) })
  expect(old.schemaVersion).toBe(22)
  seedCloudFixture(old)
  const before = contentRows(old)
  for (const [table, rows] of Object.entries(before)) {
    expect(rows.length, `${table} must be seeded for the check to mean anything`).toBeGreaterThan(0)
  }
  const indexesBefore = schemaObjects(old, "index")
  const triggersBefore = schemaObjects(old, "trigger")
  const cloudTables = tableNames(old.kvStore).filter((name) => name.startsWith("cloud_"))
  expect(cloudTables).toHaveLength(7)
  for (const table of [...cloudTables, "scoped_keys"]) {
    expect(old.kvStore.get(`SELECT COUNT(*) AS n FROM "${table}"`)?.["n"], `${table} must be seeded`).toBeGreaterThan(0)
  }
  old.close()
  return { upgraded: initDatabase({ databasePath }), before, cloudTables, indexesBefore, triggersBefore }
}

/** A v22 database as Cloud left it: a bound workspace with every kind of Cloud row, and content in every table. */
function seedCloudFixture(db: InitializedDatabase): void {
  const now = Date.now()
  db.kvStore.transaction((store) => {
    store.set("INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)", [
      "ws-cloud",
      "Cloud",
      "cloud",
      "cloud",
      "bi-directional",
      '{"description":null,"isPersonal":false,"deletedAt":null}',
    ])
    store.set("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)", ["ws-local", "Personal", "personal"])
    store.set("INSERT INTO collections (id, workspace_id, scopeId, name, slug) VALUES (?, ?, ?, ?, ?)", [
      "project-1", "ws-cloud", "ws-cloud", "Project", "project",
    ])
    store.set("INSERT INTO environments (id, workspace_id, scopeId, name, slug) VALUES (?, ?, ?, ?, ?)", [
      "env-1", "ws-cloud", "ws-cloud", "Staging", "staging",
    ])
    store.set("INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json) VALUES (?, ?, ?, ?, ?, ?)", [
      "workflow-1", "ws-cloud", "ws-cloud", "Smoke", "smoke", '{"nodes":[],"edges":[]}',
    ])
    store.set(
      "INSERT INTO workflow_revisions (id, workflow_id, source, workflow_rev, node_count, edge_count, snapshot, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["revision-1", "workflow-1", "cloud", 1, 0, 0, Buffer.from("snapshot"), "2026-01-01T00:00:00.000Z"],
    )
    store.set("INSERT INTO runs (id, workspace_id, workflow_id, scopeId, status) VALUES (?, ?, ?, ?, ?)", [
      "run-1", "ws-cloud", "workflow-1", "ws-cloud", "completed",
    ])
    store.set("INSERT INTO run_responses (run_id, node_id, body, size) VALUES (?, ?, ?, ?)", [
      "run-1", "http-1", Buffer.from("body"), 4,
    ])
    store.set("INSERT INTO run_node_results (run_id, node_id, result_json) VALUES (?, ?, ?)", [
      "run-1", "http-1", '{"nodeId":"http-1","status":"passed"}',
    ])
    store.set("INSERT INTO project_runs (id, project_id, environment_id, status) VALUES (?, ?, ?, ?)", [
      "project-run-1", "project-1", "env-1", "passed",
    ])
    store.set(
      "INSERT INTO secrets_metadata (id, workspace_id, scopeType, scopeId, key, label, sealed, key_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["secret-1", "ws-cloud", "environment", "env-1", "API_TOKEN", "API token", Buffer.from("sealed"), "key-1"],
    )
    store.set("INSERT INTO node_presets (id, workspace_id, name, node_type) VALUES (?, ?, ?, ?)", [
      "preset-1", "ws-cloud", "Login", "http-request",
    ])
    store.set("INSERT INTO agent_definitions (id, workspace_id, agent_key, name, detect_cmd) VALUES (?, ?, ?, ?, ?)", [
      "agent-def-1", "ws-cloud", "custom", "Custom", "custom --version",
    ])
    store.set("INSERT INTO agent_sessions (id, workspace_id, agent_key, launch_mode, status, cwd) VALUES (?, ?, ?, ?, ?, ?)", [
      "agent-session-1", "ws-cloud", "custom", "embedded", "exited", "C:/work",
    ])
    store.set(
      "INSERT INTO agent_run_approvals (id, workspace_id, agent, workflow_id, workflow_name, fingerprint, secret_names, destinations, runs_scripts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["approval-1", "ws-cloud", "claude", "workflow-1", "Smoke", "fp", "[]", "[]", 0],
    )
    store.set("INSERT INTO agent_local_paths (scope_kind, scope_id, local_path) VALUES (?, ?, ?)", [
      "project", "project-1", "C:/work/project",
    ])

    store.set(
      "INSERT INTO cloud_devices (device_id, label, client_version, access_token, wrapped_dek) VALUES (?, ?, ?, ?, ?)",
      ["device-1", "Laptop", "0.12.1", "token", "wrapped"],
    )
    store.set(
      "INSERT INTO cloud_workspace_bindings (workspace_id, cloud_workspace_id, sync_mode, device_id, local_origin) VALUES (?, ?, ?, ?, ?)",
      ["ws-cloud", "cloud-ws-1", "bi-directional", "device-1", "cloud"],
    )
    store.set("INSERT INTO cloud_record_state (workspace_id, kind, record_id, server_rev, local_rev, dirty) VALUES (?, ?, ?, ?, ?, ?)", [
      "ws-cloud", "workflow", "workflow-1", 3, 4, 1,
    ])
    store.set(
      "INSERT INTO cloud_outbox (id, kind, record_id, workspace_id, expected_rev, op, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["outbox-1", "workflow", "workflow-1", "ws-cloud", 3, "upsert", Buffer.from("{}"), now],
    )
    store.set(
      "INSERT INTO cloud_conflicts (conflict_id, workspace_id, kind, record_id, base_rev, local_rev, cloud_rev, local_op, cloud_op) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["conflict-1", "ws-cloud", "workflow", "workflow-1", 2, 4, 3, "upsert", "upsert"],
    )
    store.set(
      "INSERT INTO cloud_workspace_tombstones (id, workspace_id, cloud_workspace_id, expected_rev, created_at) VALUES (?, ?, ?, ?, ?)",
      ["tombstone-1", "ws-deleted", "cloud-ws-deleted", 5, now],
    )
    store.set("INSERT INTO cloud_workspace_accounts (workspace_id, account_id) VALUES (?, ?)", ["ws-cloud", "acct-1"])
    store.set(
      "INSERT INTO scoped_keys (id, workspace_id, scopeType, scopeId, public_key, encrypted_private_key) VALUES (?, ?, ?, ?, ?, ?)",
      ["scoped-key-1", "ws-cloud", "workspace", "ws-cloud", Buffer.from("public"), Buffer.from("private")],
    )
    for (const [key, value] of [
      ["cloud.account_identity", '{"accountId":"acct-1"}'],
      ["cloud.device_id", "device-1"],
      ["cloud.cursor.ws-cloud", "42"],
      ["cloud.e2ee.wdek.ws-cloud", "c2VhbGVk"],
      ["mcp.enabled", "true"],
      ["agents.default", "agent-def-1"],
      // Near Cloud's namespace but not in it: `GLOB 'cloud.*'` must keep them.
      ["Cloud.Upper", "kept"],
      ["cloudy.theme", "kept"],
      ["cloud_underscore", "kept"],
      ["agents.cloud.x", "kept"],
    ]) {
      store.set("INSERT INTO app_settings (key, value) VALUES (?, ?)", [key!, value!])
    }
  })
}

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

function copyMigrations(tempRoot: string, upToVersion: number): string {
  const target = path.join(tempRoot, `migrations-v${upToVersion}`)
  fs.mkdirSync(target)
  for (const fileName of fs.readdirSync(path.join(__dirname, "..", "migrations"))) {
    const version = Number.parseInt(fileName, 10)
    if (fileName.endsWith(".sql") && version <= upToVersion) {
      fs.copyFileSync(path.join(__dirname, "..", "migrations", fileName), path.join(target, fileName))
    }
  }
  return target
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
