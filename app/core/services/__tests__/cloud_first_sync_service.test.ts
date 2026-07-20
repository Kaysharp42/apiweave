import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Database, KVStore } from "../../db"
import { initDatabase } from "../../db"
import { CloudSyncRepository, CollectionRepository, EnvironmentRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { CloudFirstSyncService } from "../cloud_first_sync_service"

describe("CloudFirstSyncService", () => {
  let database: Database
  let store: KVStore
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cloud-first-sync-test-"))
    const initialized = initDatabase({ databasePath: join(tempDir, "test.db") })
    database = initialized.database
    store = initialized.kvStore
  })

  afterEach(() => {
    database.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("atomically binds distinct IDs and snapshots every syncable local record once", () => {
    const workspace = new WorkspaceRepository(store).create({ name: "Local Personal", slug: "local-personal" })
    new CollectionRepository(store).create({ workspaceId: workspace.workspaceId, name: "Project" })
    new WorkflowRepository(store).create({ workspaceId: workspace.workspaceId, name: "Workflow" })
    new EnvironmentRepository(store).create({
      workspaceId: workspace.workspaceId,
      name: "Environment",
      variables: { visible: "value", apiToken: "must-not-persist-in-baseline" },
      secrets: { API_KEY: "secret-canary" },
    })
    new CloudSyncRepository(store).upsertDevice({
      deviceId: "device-1",
      label: "Test Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    const service = new CloudFirstSyncService(store)
    const input = {
      workspaceId: workspace.workspaceId,
      cloudWorkspaceId: "cloud-personal-id",
      cloudWorkspaceName: "Cloud Personal",
      syncMode: "bi-directional" as const,
      deviceId: "device-1",
    }

    const binding = service.bindAndSnapshot(input)
    service.bindAndSnapshot(input)

    expect(binding).toMatchObject({
      workspaceId: workspace.workspaceId,
      cloudWorkspaceId: "cloud-personal-id",
      cloudWorkspaceName: "Cloud Personal",
      localOrigin: "local",
      initializationState: "pulling",
    })
    expect(new WorkspaceRepository(store).getById(workspace.workspaceId)).toMatchObject({
      origin: "cloud",
      syncMode: "bi-directional",
    })
    const rows = store.query<{ payload: Buffer | null; is_baseline: number; kind: string }>(
      "SELECT payload, is_baseline, kind FROM cloud_outbox ORDER BY created_at, rowid",
    )
    expect(rows).toHaveLength(4)
    expect(rows.every((row) => row.is_baseline === 1)).toBe(true)
    expect(rows.map((row) => row.kind)).toEqual(["workspace", "environment", "project", "workflow"])
    const persisted = rows.map((row) => row.payload?.toString("utf8") ?? "").join("\n")
    expect(persisted).not.toContain("secret-canary")
    expect(persisted).not.toContain("must-not-persist-in-baseline")
  })

  it("rolls back without partial binding or baseline rows when local validation fails", () => {
    const service = new CloudFirstSyncService(store)

    expect(() => service.bindAndSnapshot({
      workspaceId: "missing-local",
      cloudWorkspaceId: "cloud-workspace",
      cloudWorkspaceName: "Cloud",
      syncMode: "bi-directional",
      deviceId: "device-1",
    })).toThrow("Local workspace does not exist")

    expect(store.get("SELECT 1 FROM cloud_workspace_bindings LIMIT 1")).toBeUndefined()
    expect(store.get("SELECT 1 FROM cloud_outbox LIMIT 1")).toBeUndefined()
  })

  it("prevents two local workspaces from binding the same cloud workspace", () => {
    const workspaces = new WorkspaceRepository(store)
    const first = workspaces.create({ name: "First", slug: "first" })
    const second = workspaces.create({ name: "Second", slug: "second" })
    new CloudSyncRepository(store).upsertDevice({
      deviceId: "device-1",
      label: "Test Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    const service = new CloudFirstSyncService(store)
    service.bindAndSnapshot({
      workspaceId: first.workspaceId,
      cloudWorkspaceId: "shared-cloud-id",
      cloudWorkspaceName: "Cloud",
      syncMode: "bi-directional",
      deviceId: "device-1",
    })

    expect(() => service.bindAndSnapshot({
      workspaceId: second.workspaceId,
      cloudWorkspaceId: "shared-cloud-id",
      cloudWorkspaceName: "Cloud",
      syncMode: "bi-directional",
      deviceId: "device-1",
    })).toThrow("already bound")
  })
})
