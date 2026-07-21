import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initDatabase, type Database, type KVStore } from "../../../core/db"
import { IpcRouter } from "../../../core/ipc/router"
import { registerConflictUiHandlers, type SyncConflictResolver } from "../conflict-ui-bridge"

const WORKSPACE_ID = "ws-conflicts"

describe("conflict-ui-bridge", () => {
  let tempDir: string
  let db: Database
  let store: KVStore
  let router: IpcRouter
  let resolver: SyncConflictResolver & { resolveConflict: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "conflict-ui-test-"))
    const initialized = initDatabase({ databasePath: join(tempDir, "test.db") })
    db = initialized.database
    store = initialized.kvStore
    activeStore = store
    store.set(
      "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
      [WORKSPACE_ID, "Conflicts", "conflicts", "cloud", "bi-directional", "{}"],
    )
    resolver = { resolveConflict: vi.fn().mockResolvedValue(undefined) }
    router = new IpcRouter()
    registerConflictUiHandlers(router, { store, syncService: resolver })
    await router.dispatch({ domain: "cloud", action: "conflict-list", payload: {} })
  })

  afterEach(() => {
    db.close()
    activeStore = null
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns unresolved conflicts from cloud_conflicts", async () => {
    insertConflict("conflict-1")
    const result = await router.dispatch({ domain: "cloud", action: "conflict-list", payload: {} })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toMatchObject([
        { id: "conflict-1", kind: "workflow", record_id: "workflow-1", winner: null },
      ])
    }
  })

  it("resolves local, rebases the chosen payload, and fetches the loser from the original snapshot", async () => {
    insertConflict("conflict-2")
    const result = await router.dispatch({
      domain: "cloud",
      action: "conflict-resolve",
      payload: { conflict_id: "conflict-2", winner: "local", device_id: "device-1" },
    })

    expect(result.ok).toBe(true)
    expect(resolver.resolveConflict).toHaveBeenCalledWith({
      conflict_id: "conflict-2",
      winner: "local",
      device_id: "device-1",
    })
    const workflow = store.get<{ name: string; rev: number }>("SELECT name, rev FROM workflows WHERE id = ?", ["workflow-1"])
    expect(workflow).toMatchObject({ name: "Local Workflow", rev: 10 })
    expect(store.get<{ winner: string; status: string }>(
      "SELECT winner, status FROM cloud_conflicts WHERE conflict_id = ?",
      ["conflict-2"],
    )).toEqual({ winner: "local", status: "resolved" })
    expect(store.get<{ expected_rev: number }>(
      "SELECT expected_rev FROM cloud_outbox WHERE record_id = ?",
      ["workflow-1"],
    )).toEqual({ expected_rev: 9 })

    const loser = await router.dispatch({
      domain: "cloud",
      action: "conflict-fetch-loser",
      payload: { conflict_id: "conflict-2" },
    })
    expect(loser.ok).toBe(true)
    if (loser.ok) expect(loser.data).toMatchObject({ name: "Cloud Workflow" })
  })

  it("errors when resolving an already resolved conflict", async () => {
    insertConflict("conflict-3", "cloud")
    const result = await router.dispatch({
      domain: "cloud",
      action: "conflict-resolve",
      payload: { conflict_id: "conflict-3", winner: "local", device_id: "device-1" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("conflict")
      expect(result.error.message).toBe("Conflict already resolved")
    }
  })

  it("resolves cloud by replacing a newer local revision and clearing dirty state", async () => {
    insertConflict("conflict-cloud")
    store.set(
      "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["workflow-1", WORKSPACE_ID, WORKSPACE_ID, "Newer Local", "newer-local", "{}", "{}", "{}", 12],
    )
    store.set(
      "INSERT INTO cloud_record_state (workspace_id, kind, record_id, server_rev, local_rev, dirty, conflict_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [WORKSPACE_ID, "workflow", "workflow-1", 9, 12, 1, "conflict-cloud"],
    )

    const result = await router.dispatch({
      domain: "cloud",
      action: "conflict-resolve",
      payload: { conflict_id: "conflict-cloud", winner: "cloud", device_id: "device-1" },
    })

    expect(result.ok).toBe(true)
    expect(store.get<{ name: string; rev: number }>(
      "SELECT name, rev FROM workflows WHERE id = ?",
      ["workflow-1"],
    )).toEqual({ name: "Cloud Workflow", rev: 9 })
    expect(store.get<{ server_rev: number; local_rev: number; dirty: number; conflict_id: string | null }>(
      "SELECT server_rev, local_rev, dirty, conflict_id FROM cloud_record_state WHERE record_id = ?",
      ["workflow-1"],
    )).toEqual({ server_rev: 9, local_rev: 9, dirty: 0, conflict_id: null })
  })

  it("disambiguates a cloud workspace slug that is already used locally", async () => {
    store.set(
      "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
      ["personal-workspace", "Personal", "personal", "local", "none", "{}"],
    )
    const local = { workspaceId: WORKSPACE_ID, name: "Conflicts", slug: "conflicts", origin: "cloud", syncMode: "bi-directional" }
    const cloud = { workspaceId: WORKSPACE_ID, name: "Cloud Personal", slug: "personal", origin: "cloud", syncMode: "bi-directional" }
    store.set(
      `INSERT INTO cloud_conflicts (
        conflict_id, workspace_id, kind, record_id, base_rev,
        local_payload, cloud_payload, local_rev, cloud_rev, local_op, cloud_op
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "workspace-slug-conflict",
        WORKSPACE_ID,
        "workspace",
        WORKSPACE_ID,
        1,
        Buffer.from(JSON.stringify(local)),
        Buffer.from(JSON.stringify(cloud)),
        2,
        3,
        "upsert",
        "upsert",
      ],
    )

    const result = await router.dispatch({
      domain: "cloud",
      action: "conflict-resolve",
      payload: { conflict_id: "workspace-slug-conflict", winner: "cloud", device_id: "device-1" },
    })

    expect(result.ok).toBe(true)
    expect(store.get<{ name: string; slug: string }>(
      "SELECT name, slug FROM workspaces WHERE id = ?",
      [WORKSPACE_ID],
    )).toEqual({ name: "Cloud Personal", slug: "personal-2" })
    expect(store.get<{ slug: string }>(
      "SELECT slug FROM workspaces WHERE id = ?",
      ["personal-workspace"],
    )).toEqual({ slug: "personal" })
  })

  it("errors if the Go SyncService resolve call fails", async () => {
    insertConflict("conflict-4")
    resolver.resolveConflict.mockRejectedValueOnce(new Error("sync service down"))
    await expect(
      router.dispatch({
        domain: "cloud",
        action: "conflict-resolve",
        payload: { conflict_id: "conflict-4", winner: "cloud", device_id: "device-1" },
      }),
    ).rejects.toThrow("sync service down")
  })
})

function insertConflict(id: string, winner: "local" | "cloud" | null = null): void {
  const local = { name: "Local Workflow", graph: { nodes: [], edges: [] }, variables: {} }
  const cloud = { name: "Cloud Workflow", graph: { nodes: [], edges: [] }, variables: {} }
  storeRef().set(
    `INSERT INTO cloud_conflicts (
      conflict_id, server_conflict_id, workspace_id, kind, record_id, base_rev,
      local_payload, cloud_payload, local_rev, cloud_rev, local_op, cloud_op,
      winner, status, createdAt, resolvedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      id,
      WORKSPACE_ID,
      "workflow",
      "workflow-1",
      5,
      Buffer.from(JSON.stringify(local)),
      Buffer.from(JSON.stringify(cloud)),
      7,
      9,
      "upsert",
      "upsert",
      winner,
      winner === null ? "pending" : "resolved",
      new Date().toISOString(),
      winner === null ? null : new Date().toISOString(),
    ],
  )
}

let activeStore: KVStore | null = null
function storeRef(): KVStore {
  if (activeStore === null) throw new Error("store not set")
  return activeStore
}
