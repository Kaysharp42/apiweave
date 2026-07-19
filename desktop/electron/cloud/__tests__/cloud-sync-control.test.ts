import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import nock from "nock"
import type { Database, KVStore } from "../../../core/db"
import { initDatabase } from "../../../core/db"
import { CLOUD_OUTBOX_MAX_RETRIES, CloudSyncRepository } from "../../../core/repositories"
import { createKeyfile, readKeyfile } from "../../../core/secrets/keyfile"
import { encrypt, generateDek, wrapDek } from "../../../core/secrets/crypto"
import type { SyncProvider } from "../../../core/sync"
import { DeviceTokenStore } from "../cloud-client"
import { ErrLinkCancelled } from "../cloud-link"
import { DesktopCloudSyncControl } from "../cloud-sync-control"
import {
  CloudAccountIdentityRequiredError,
  CloudAccountMismatchError,
  CloudUnlinkRequiresConfirmationError,
} from "../../../core/services/cloud_sync_control"

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
    nock.disableNetConnect()
  })

  afterEach(() => {
    db.close()
    nock.cleanAll()
    nock.enableNetConnect()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("revokes the device before removing account-scoped local state on unlink", async () => {
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
      cloudWorkspaceName: "Cloud Workspace",
      syncMode: "bi-directional",
      deviceId: "device-1",
      initializationState: "initialized",
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
    repository.setSetting("cloud.workspace_catalog", JSON.stringify([{
      workspaceId: CLOUD_WORKSPACE_ID,
      workspaceName: "Cloud Workspace",
      isPersonal: false,
      effectiveRole: 5,
      canPull: true,
      canPush: true,
      canResolveConflicts: true,
    }]))

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

    expect(control.status()).toMatchObject({
      active: true,
      linkState: "linked",
      syncState: "error",
      state: "error",
      pendingCount: 0,
      deadLetterCount: 1,
      conflictCount: 1,
      device: { deviceId: "device-1", label: "Test Device", clientVersion: "1.0.0" },
      bindings: [{
        workspaceId: WORKSPACE_ID,
        workspaceName: "Local Workspace",
        cloudWorkspaceId: CLOUD_WORKSPACE_ID,
        cloudWorkspaceName: "Cloud Workspace",
        deadLetterCount: 1,
        conflictCount: 1,
      }],
    })
    nock("https://auth.test")
      .post("/oauth/v2/token")
      .reply(200, { id_token: "unlink-id-token" })
    nock("https://api.test")
      .post("/desktop/auth/session", { idToken: "unlink-id-token" })
      .reply(200, { sessionToken: "unlink-session", expiresAt: "2026-07-17T00:00:00Z" })
    nock("https://api.test")
      .post("/apiweave.v1.DeviceService/RevokeDevice", { deviceId: "device-1" })
      .reply(200, {})

    const status = await control.unlink({})

    expect(activeProvider).toBeDefined()
    expect(status).toMatchObject({ linked: false, active: false, workspaceIds: [] })
    expect(repository.countOutbox()).toBe(0)
    expect(repository.listWorkspaceBindings()).toEqual([])
    expect(repository.getCursor(CLOUD_WORKSPACE_ID)).toBeUndefined()
    expect(store.get("SELECT 1 FROM cloud_conflicts LIMIT 1")).toBeUndefined()
    expect(store.get("SELECT 1 FROM cloud_devices LIMIT 1")).toBeUndefined()
    expect(repository.getSetting("cloud.workspace_catalog")).toBeUndefined()
    expect(repository.getSetting("cloud.public_config")).toBeUndefined()
    expect(store.get<{ origin: string; syncMode: string; name: string }>(
      "SELECT origin, syncMode, name FROM workspaces WHERE id = ?",
      [WORKSPACE_ID],
    )).toEqual({ origin: "local", syncMode: "none", name: "Local Workspace" })
    expect(nock.isDone()).toBe(true)
  })

  it("re-queues dead-lettered outbox rows as pending on retry without deleting them", () => {
    const repository = new CloudSyncRepository(store)
    store.set(
      "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
      ["other-workspace", "Other", "other", "cloud", "bi-directional", "{}"],
    )
    repository.enqueueOutbox({
      kind: "workflow",
      record_id: "workflow-1",
      workspace_id: WORKSPACE_ID,
      expected_rev: 0,
      op: "upsert",
      payload: new Uint8Array(),
    })
    repository.enqueueOutbox({
      kind: "workflow",
      record_id: "workflow-2",
      workspace_id: "other-workspace",
      expected_rev: 0,
      op: "upsert",
      payload: new Uint8Array(),
    })
    store.set("UPDATE cloud_outbox SET retry_count = ?", [CLOUD_OUTBOX_MAX_RETRIES])
    expect(repository.countDeadLetterOutbox(WORKSPACE_ID)).toBe(1)

    const requeued = repository.retryDeadLetterOutbox(WORKSPACE_ID)

    expect(requeued).toBe(1)
    expect(repository.countDeadLetterOutbox(WORKSPACE_ID)).toBe(0)
    expect(repository.countPendingOutbox(WORKSPACE_ID)).toBe(1)
    // Only the targeted workspace is affected; the other stays dead-lettered.
    expect(repository.countDeadLetterOutbox("other-workspace")).toBe(1)
    // The row is preserved, not deleted.
    expect(repository.countOutbox()).toBe(2)
  })

  it("discards dead-lettered rows, keeps the binding and local record, and clears the error state", async () => {
    const repository = new CloudSyncRepository(store)
    const tokenStore = new DeviceTokenStore(repository, keyfilePath)
    tokenStore.setTokens("device-dl", "access-token", "refresh-token")
    repository.upsertDevice({
      deviceId: "device-dl",
      label: "Test Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      cloudWorkspaceName: "Cloud Workspace",
      syncMode: "bi-directional",
      deviceId: "device-dl",
      initializationState: "initialized",
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
    repository.setSetting("cloud.public_config", JSON.stringify({
      version: 1,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1],
    }))

    const control = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: { cloudEntryUrl: "https://cloud.test", clientVersion: "1.0.0", deviceLabel: "Test Device" },
      setSyncProviderTarget: () => undefined,
    })
    expect(control.status()).toMatchObject({ syncState: "error", deadLetterCount: 1 })

    const status = control.discardDeadLetters({ workspaceId: WORKSPACE_ID })

    expect(status).toMatchObject({ deadLetterCount: 0, syncState: "idle" })
    expect(repository.countOutbox()).toBe(0)
    // The binding and local workspace record are untouched.
    expect(repository.listWorkspaceBindings()).toHaveLength(1)
    expect(store.get("SELECT 1 FROM workspaces WHERE id = ?", [WORKSPACE_ID])).toBeDefined()
  })

  it("re-queues on retry and reports offline (not a hard error) when the push cannot reach the server", async () => {
    const repository = new CloudSyncRepository(store)
    const tokenStore = new DeviceTokenStore(repository, keyfilePath)
    tokenStore.setTokens("device-retry", "access-token", "refresh-token")
    repository.upsertDevice({
      deviceId: "device-retry",
      label: "Test Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      cloudWorkspaceName: "Cloud Workspace",
      syncMode: "bi-directional",
      deviceId: "device-retry",
      initializationState: "initialized",
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
    repository.setSetting("cloud.public_config", JSON.stringify({
      version: 1,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1],
    }))

    const control = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: { cloudEntryUrl: "https://cloud.test", clientVersion: "1.0.0", deviceLabel: "Test Device" },
      setSyncProviderTarget: () => undefined,
    })

    // No nock interceptor for the push RPC → the transport treats the network
    // failure as offline. The retry must not reject.
    const status = await control.retryDeadLetters({ workspaceId: WORKSPACE_ID })

    expect(status.deadLetterCount).toBe(0)
    expect(status.pendingCount).toBe(1)
    expect(status.syncState).toBe("offline")
    // The row is safely re-queued, never dropped.
    expect(repository.countOutbox()).toBe(1)
  })

  it("preserves local cloud state until an offline disconnect is explicitly confirmed", async () => {
    const repository = new CloudSyncRepository(store)
    const tokenStore = new DeviceTokenStore(repository, keyfilePath)
    tokenStore.setTokens("device-offline", "access-token", "refresh-token")
    repository.upsertDevice({
      deviceId: "device-offline",
      label: "Offline Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      cloudWorkspaceName: "Cloud Workspace",
      syncMode: "bi-directional",
      deviceId: "device-offline",
      initializationState: "initialized",
    })
    repository.enqueueOutbox({
      kind: "workflow",
      record_id: "workflow-offline",
      workspace_id: WORKSPACE_ID,
      expected_rev: 0,
      op: "upsert",
      payload: new TextEncoder().encode(JSON.stringify({ name: "Unsynced" })),
    })
    repository.setSetting("cloud.public_config", JSON.stringify({
      version: 1,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1],
    }))
    const control = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Offline Device",
      },
      setSyncProviderTarget: () => undefined,
    })

    nock("https://auth.test")
      .post("/oauth/v2/token")
      .reply(200, { id_token: "offline-unlink-id-token" })
    nock("https://api.test")
      .post("/desktop/auth/session", { idToken: "offline-unlink-id-token" })
      .reply(200, { sessionToken: "offline-unlink-session", expiresAt: "2026-07-17T00:00:00Z" })
    nock("https://api.test")
      .post("/apiweave.v1.DeviceService/RevokeDevice", { deviceId: "device-offline" })
      .replyWithError("offline")

    await expect(control.unlink({})).rejects.toThrow(CloudUnlinkRequiresConfirmationError)
    expect(tokenStore.hasTokens()).toBe(true)
    expect(repository.countOutbox()).toBe(1)
    expect(repository.listWorkspaceBindings()).toHaveLength(1)

    nock("https://api.test")
      .post("/apiweave.v1.DeviceService/RevokeDevice", { deviceId: "device-offline" })
      .replyWithError("still offline")

    const status = await control.unlink({ localOnly: true })

    expect(status).toMatchObject({ linked: false, active: false, workspaceIds: [] })
    expect(repository.countOutbox()).toBe(0)
    expect(repository.listWorkspaceBindings()).toEqual([])
    expect(store.get<{ origin: string; syncMode: string }>(
      "SELECT origin, syncMode FROM workspaces WHERE id = ?",
      [WORKSPACE_ID],
    )).toEqual({ origin: "local", syncMode: "none" })
    expect(nock.isDone()).toBe(true)
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

  it("aborts an in-flight link before clearing account state on unlink", async () => {
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
    await control.unlink({})

    await expect(linkPromise).rejects.toThrow(ErrLinkCancelled)
    expect(control.status()).toMatchObject({ linked: false, active: false })
  })

  it("automatically resumes a durable first-sync checkpoint after process restart", async () => {
    const repository = new CloudSyncRepository(store)
    const tokenStore = new DeviceTokenStore(repository, keyfilePath)
    tokenStore.setTokens("device-restart", "old-session", "restart-refresh")
    repository.upsertDevice({
      deviceId: "device-restart",
      label: "Restart Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      cloudWorkspaceName: "Cloud Workspace",
      syncMode: "bi-directional",
      deviceId: "device-restart",
      initializationState: "pulling",
    })
    repository.enqueueBaselineOutbox({
      kind: "workspace",
      record_id: WORKSPACE_ID,
      workspace_id: WORKSPACE_ID,
      expected_rev: 0,
      op: "upsert",
      payload: new TextEncoder().encode(JSON.stringify({ name: "Local Workspace" })),
    })
    repository.setSetting("cloud.public_config", JSON.stringify({
      version: 1,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1],
    }))

    nock("https://auth.test")
      .post("/oauth/v2/token")
      .reply(200, { id_token: "restart-id-token" })
    nock("https://api.test")
      .post("/desktop/auth/session", { idToken: "restart-id-token" })
      .reply(200, { sessionToken: "restart-session", expiresAt: "2026-07-17T00:00:00Z" })
    nock("https://api.test")
      .post("/apiweave.v1.SyncService/Hello")
      .reply(200, { protocolVersion: 1, fullResyncRequired: false })
    nock("https://api.test")
      .post("/apiweave.v1.SyncService/PullChanges")
      .reply(200, { changes: [], nextCursor: "0", hasMore: false })
    nock("https://api.test")
      .post("/apiweave.v1.SyncService/PushDeltas")
      .reply(200, {
        outcomes: [{ deltaIndex: 0, status: 1, newRev: "1", rejectionReason: 0, conflictId: "" }],
      })

    new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Restart Device",
      },
      setSyncProviderTarget: () => undefined,
    })

    await expect.poll(() => repository.getWorkspaceBinding(WORKSPACE_ID)?.initializationState)
      .toBe("initialized")
    expect(repository.countBaselineOutbox(WORKSPACE_ID)).toBe(0)
    expect(nock.isDone()).toBe(true)
  })

  it("returns from bind after the durable checkpoint and reports background initialization failures", async () => {
    const repository = new CloudSyncRepository(store)
    store.set(
      "UPDATE workspaces SET settings_json = ? WHERE id = ?",
      [JSON.stringify({ description: null, isPersonal: false, deletedAt: null }), WORKSPACE_ID],
    )
    const tokenStore = new DeviceTokenStore(repository, keyfilePath)
    tokenStore.setTokens("device-bind", "bind-session", "bind-refresh")
    repository.upsertDevice({
      deviceId: "device-bind",
      label: "Bind Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    repository.setSetting("cloud.public_config", JSON.stringify({
      version: 1,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1],
    }))
    repository.setSetting("cloud.workspace_catalog", JSON.stringify([{
      workspaceId: CLOUD_WORKSPACE_ID,
      workspaceName: "Cloud Workspace",
      isPersonal: true,
      effectiveRole: 5,
      canPull: true,
      canPush: true,
      canResolveConflicts: true,
    }]))
    nock("https://auth.test")
      .post("/oauth/v2/token")
      .reply(200, { id_token: "bind-id-token" })
    nock("https://api.test")
      .post("/desktop/auth/session", { idToken: "bind-id-token" })
      .reply(200, { sessionToken: "bind-session", expiresAt: "2026-07-17T00:00:00Z" })
    nock("https://api.test")
      .post("/apiweave.v1.SyncService/Hello")
      .reply(503, { code: "UNAVAILABLE" })
    const control = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Bind Device",
      },
      setSyncProviderTarget: () => undefined,
    })

    const status = await control.bindWorkspace({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
    })

    expect(status).toMatchObject({
      active: true,
      syncState: "initializing",
      bindings: [{ workspaceId: WORKSPACE_ID, initializationState: "pulling" }],
    })
    expect(store.get<{ origin: string }>("SELECT origin FROM workspaces WHERE id = ?", [WORKSPACE_ID]))
      .toEqual({ origin: "cloud" })
    await expect.poll(() => repository.getWorkspaceBinding(WORKSPACE_ID)?.lastError)
      .toBe("Something went wrong talking to the cloud. Sync will retry automatically.")
    expect(control.status().syncState).toBe("error")
    expect(nock.isDone()).toBe(true)
  })

  it("persists authentication-required state after an invalid refresh token", async () => {
    const repository = new CloudSyncRepository(store)
    new DeviceTokenStore(repository, keyfilePath).setTokens("device-auth", "old-session", "invalid-refresh")
    repository.upsertDevice({
      deviceId: "device-auth",
      label: "Auth Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      cloudWorkspaceName: "Cloud Workspace",
      syncMode: "bi-directional",
      deviceId: "device-auth",
      initializationState: "initialized",
    })
    repository.setSetting("cloud.account_identity", JSON.stringify({ accountId: "account-auth" }))
    repository.setSetting("cloud.public_config", JSON.stringify({
      version: 1,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1],
    }))
    nock("https://auth.test").post("/oauth/v2/token").reply(400, { error: "invalid_grant" })

    const control = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Auth Device",
      },
      setSyncProviderTarget: () => undefined,
    })

    await expect(control.pull()).rejects.toThrow("unauthorized")
    expect(control.status()).toMatchObject({
      linked: true,
      linkState: "authenticationRequired",
      syncState: "error",
      account: { accountId: "account-auth" },
    })

    const restarted = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Auth Device",
      },
      setSyncProviderTarget: () => undefined,
    })
    expect(restarted.status().linkState).toBe("authenticationRequired")
  })

  it("reports offline separately without requiring account relink", async () => {
    const repository = new CloudSyncRepository(store)
    new DeviceTokenStore(repository, keyfilePath).setTokens("device-offline-status", "old-session", "refresh-token")
    repository.upsertDevice({
      deviceId: "device-offline-status",
      label: "Offline Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      cloudWorkspaceName: "Cloud Workspace",
      syncMode: "bi-directional",
      deviceId: "device-offline-status",
      initializationState: "initialized",
    })
    repository.setSetting("cloud.account_identity", JSON.stringify({ accountId: "account-offline" }))
    repository.setSetting("cloud.public_config", JSON.stringify({
      version: 1,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1],
    }))
    nock("https://auth.test").post("/oauth/v2/token").replyWithError("network unavailable")
    const control = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Offline Device",
      },
      setSyncProviderTarget: () => undefined,
    })

    await expect(control.pull()).rejects.toThrow("network unavailable")
    expect(control.status()).toMatchObject({ linkState: "linked", syncState: "offline" })
    expect(repository.getSetting("cloud.authentication_required")).toBeUndefined()
  })

  it("refreshes the authorized catalog and unbinds without deleting local content", async () => {
    const repository = new CloudSyncRepository(store)
    new DeviceTokenStore(repository, keyfilePath).setTokens("device-catalog", "old-session", "catalog-refresh")
    repository.upsertDevice({
      deviceId: "device-catalog",
      label: "Catalog Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      cloudWorkspaceName: "Old Cloud Name",
      syncMode: "bi-directional",
      deviceId: "device-catalog",
      initializationState: "initialized",
    })
    repository.setSetting("cloud.public_config", JSON.stringify({
      version: 1,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1],
    }))
    nock("https://auth.test").post("/oauth/v2/token").reply(200, { id_token: "catalog-id-token" })
    nock("https://api.test")
      .post("/desktop/auth/session", { idToken: "catalog-id-token" })
      .reply(200, { sessionToken: "catalog-session", expiresAt: "2026-07-17T00:00:00Z" })
    nock("https://api.test")
      .post("/apiweave.v1.DeviceService/ListSyncWorkspaces", {})
      .reply(200, {
        workspaces: [{
          workspaceId: CLOUD_WORKSPACE_ID,
          workspaceName: "Current Cloud Name",
          isPersonal: true,
          effectiveRole: "SYNC_WORKSPACE_ROLE_ADMIN",
          capabilities: { canPull: true, canPush: true, canResolveConflicts: true },
        }],
      })
    const control = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Catalog Device",
      },
      setSyncProviderTarget: () => undefined,
    })

    const refreshed = await control.refreshWorkspaceCatalog()
    expect(refreshed.workspaceCatalog).toMatchObject([{ workspaceName: "Current Cloud Name" }])

    const unbound = control.unbindWorkspace({ workspaceId: WORKSPACE_ID })
    expect(unbound).toMatchObject({ active: false, workspaceIds: [], bindings: [] })
    expect(store.get<{ name: string; origin: string; syncMode: string }>(
      "SELECT name, origin, syncMode FROM workspaces WHERE id = ?",
      [WORKSPACE_ID],
    )).toEqual({ name: "Local Workspace", origin: "local", syncMode: "none" })
    expect(nock.isDone()).toBe(true)
  })

  it("rejects relink when the existing binding account cannot be verified or does not match", async () => {
    const repository = new CloudSyncRepository(store)
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      cloudWorkspaceName: "Cloud Workspace",
      syncMode: "bi-directional",
      initializationState: "initialized",
    })
    const config = {
      version: 1 as const,
      webBaseUrl: "https://cloud.test",
      apiBaseUrl: "https://api.test",
      oidcIssuer: "https://auth.test",
      desktopClientId: "desktop-test",
      minimumDesktopVersion: "0.1.0",
      syncProtocolVersions: [1] as readonly number[],
    }
    const missingIdentity = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Account Device",
      },
      configClient: async () => config,
      setSyncProviderTarget: () => undefined,
    })
    await expect(missingIdentity.link({})).rejects.toThrow(CloudAccountIdentityRequiredError)

    repository.setSetting("cloud.account_identity", JSON.stringify({ accountId: "original-account" }))
    const dek = generateDek()
    const mismatched = new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: {
        cloudEntryUrl: "https://cloud.test",
        clientVersion: "1.0.0",
        deviceLabel: "Account Device",
      },
      configClient: async () => config,
      linkClient: async (linkConfig) => {
        expect(linkConfig.expectedAccountId).toBe("original-account")
        return {
          account: { accountId: "different-account" },
          device: {
            deviceId: "different-device",
            label: "Account Device",
            clientVersion: "1.0.0",
            publicKey: new Uint8Array(32),
            createdAt: new Date().toISOString(),
          },
          workspaces: [],
          encryptedRefreshToken: encrypt("replacement-refresh", dek, "test"),
          wrappedDek: wrapDek(dek, readKeyfile(keyfilePath).masterKek),
          accessToken: "replacement-session",
        }
      },
      setSyncProviderTarget: () => undefined,
    })
    await expect(mismatched.link({})).rejects.toThrow(CloudAccountMismatchError)
    expect(repository.getSetting("cloud.device_id")).toBeUndefined()
    expect(repository.getSetting("cloud.account_identity")).toBe(JSON.stringify({ accountId: "original-account" }))
  })
})
