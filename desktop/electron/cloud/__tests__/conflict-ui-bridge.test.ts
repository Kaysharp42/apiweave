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

  it("returns unresolved conflicts from conflict_snapshots", async () => {
    insertConflict("conflict-1")
    const result = await router.dispatch({ domain: "cloud", action: "conflict-list", payload: {} })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toMatchObject([
        { id: "conflict-1", kind: "workflow", record_id: "workflow-1", winner: null },
      ])
    }
  })

  it("resolves local, calls SyncService, applies the chosen payload, and stores the loser", async () => {
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
    expect(workflow).toMatchObject({ name: "Local Workflow", rev: 7 })

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
    "INSERT INTO conflict_snapshots (id, workspace_id, kind, record_id, local_payload, cloud_payload, local_rev, cloud_rev, winner, loser_payload, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      WORKSPACE_ID,
      "workflow",
      "workflow-1",
      Buffer.from(JSON.stringify(local)),
      Buffer.from(JSON.stringify(cloud)),
      7,
      9,
      winner,
      winner === null ? null : Buffer.from(JSON.stringify(winner === "local" ? cloud : local)),
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
