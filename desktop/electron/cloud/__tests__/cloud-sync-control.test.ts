import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Database, KVStore } from "../../../core/db"
import { initDatabase } from "../../../core/db"
import { CLOUD_OUTBOX_MAX_RETRIES, CloudSyncRepository } from "../../../core/repositories"
import { createKeyfile } from "../../../core/secrets/keyfile"
import type { SyncProvider } from "../../../core/sync"
import { DeviceTokenStore } from "../cloud-client"
import { ErrLinkCancelled } from "../cloud-link"
import { DesktopCloudSyncControl } from "../cloud-sync-control"

const WORKSPACE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
const CLOUD_WORKSPACE_ID = "01CLOUDWORKSPACE00000000000"

describe("DesktopCloudSyncControl", () => {
  let db: Database
  let store: KVStore
  let tempDir: string
  let keyfilePath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cloud-sync-control-test-"))
    keyfilePath = join(tempDir, "keyfile.json")
    createKeyfile(keyfilePath)
    const initialized = initDatabase({ databasePath: join(tempDir, "test.db") })
    db = initialized.database
    store = initialized.kvStore
    store.set(
      "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
      [WORKSPACE_ID, "Local Workspace", "local-workspace", "cloud", "bi-directional", "{}"],
    )
  })

  afterEach(() => {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("removes account-scoped outbox, bindings, cursors, and conflict data on unlink", () => {
    const repository = new CloudSyncRepository(store)
    const tokenStore = new DeviceTokenStore(repository, keyfilePath)
    tokenStore.setTokens("device-1", "access-token", "refresh-token")
    repository.upsertDevice({
      deviceId: "device-1",
      label: "Test Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      syncMode: "bi-directional",
      deviceId: "device-1",
    })
    repository.enqueueOutbox({
      kind: "workflow",
      record_id: "workflow-1",
      workspace_id: WORKSPACE_ID,
      expected_rev: 0,
      op: "upsert",
      payload: new Uint8Array(),
    })
    store.set("UPDATE cloud_outbox SET retry_count = ?", [CLOUD_OUTBOX_MAX_RETRIES])
    repository.setCursor(CLOUD_WORKSPACE_ID, 10n, 2n)
    store.set(
      `INSERT INTO cloud_conflicts (
        conflict_id, workspace_id, kind, record_id, base_rev,
        local_rev, cloud_rev, local_op, cloud_op
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["conflict-1", WORKSPACE_ID, "workflow", "workflow-1", 1, 2, 2, "upsert", "upsert"],
    )
    repository.setSetting("cloud.public_config", JSON.stringify({
      version: 1,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1],
    }))

    let activeProvider: SyncProvider | undefined
    const control = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Test Device",
      },
      setSyncProviderTarget: (provider) => {
        activeProvider = provider
      },
    })

    expect(control.status()).toMatchObject({ active: true, state: "error", deadLetterCount: 1 })
    const status = control.unlink()

    expect(activeProvider).toBeDefined()
    expect(status).toMatchObject({ linked: false, active: false, workspaceIds: [] })
    expect(repository.countOutbox()).toBe(0)
    expect(repository.listWorkspaceBindings()).toEqual([])
    expect(repository.getCursor(CLOUD_WORKSPACE_ID)).toBeUndefined()
    expect(store.get("SELECT 1 FROM cloud_conflicts LIMIT 1")).toBeUndefined()
    expect(store.get("SELECT 1 FROM cloud_devices LIMIT 1")).toBeUndefined()
  })

  it("cancels configuration discovery without waiting for OAuth timeout", async () => {
    const control = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Test Device",
      },
      configClient: async (_entryUrl, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      }),
      setSyncProviderTarget: () => undefined,
    })

    const linkPromise = control.link({})
    control.cancelLink()

    await expect(linkPromise).rejects.toThrow(ErrLinkCancelled)
    expect(control.status()).toMatchObject({ linked: false, active: false, workspaceCatalog: [] })
  })
})
