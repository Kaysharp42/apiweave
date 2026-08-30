import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import nock from "nock"

// safeStorage is main-process-only and absent under vitest, so the keychain is
// a reversible in-memory stand-in. `wdek-cache.ts` refuses to cache on an
// untrustworthy backend, which is why the backend is named here too.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "kwallet5",
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, "utf-8"),
    decryptString: (buffer: Buffer) => buffer.toString("utf-8").replace(/^sealed:/, ""),
  },
}))

import type { Database, KVStore } from "../../../core/db"
import { initDatabase } from "../../../core/db"
import { AppSettingsRepository, CloudSyncRepository, WorkspaceRepository } from "../../../core/repositories"
import { createKeyfile } from "../../../core/secrets/keyfile"
import { DeviceTokenStore } from "../cloud-client"
import { DesktopCloudSyncControl } from "../cloud-sync-control"
import {
  CloudWorkspaceEncryptionInvalidError,
  CloudWorkspaceEncryptionSettledError,
  CloudWorkspaceLockedError,
  CloudWorkspacePassphraseAdminOnlyError,
} from "../../../core/services/cloud_sync_control"
import { clearWorkspaceEncryption, WorkspaceLocked, workspaceWdek } from "../workspace-keys"
import { cacheWdek } from "../wdek-cache"
import { createEncryptionBundle } from "../workspace-encryption"

const WORKSPACE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
const CLOUD_WORKSPACE_ID = "01CLOUDWORKSPACE00000000000"
const ACCOUNT_ID = "account-1"
const PASSPHRASE = "correct horse battery staple"
const DEVICE_SERVICE = "/apiweave.v1.DeviceService"

// One derivation is ~200ms; every test that needs an e2ee workspace reuses this.
const provisioned = createEncryptionBundle(PASSPHRASE)

/** Narrow the captured request body, so the assertions below read straight. */
function requireBundle(sent: Record<string, string> | undefined): Record<string, string> {
  if (sent === undefined) {
    throw new Error("no encryption bundle reached the wire")
  }
  return sent
}

describe("DesktopCloudSyncControl workspace encryption", () => {
  let db: Database
  let store: KVStore
  let settings: AppSettingsRepository
  let repository: CloudSyncRepository
  let tempDir: string
  let keyfilePath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cloud-e2ee-test-"))
    keyfilePath = join(tempDir, "keyfile.json")
    createKeyfile(keyfilePath)
    const initialized = initDatabase({ databasePath: join(tempDir, "test.db") })
    db = initialized.database
    store = initialized.kvStore
    settings = new AppSettingsRepository(store)
    repository = new CloudSyncRepository(store)
    // Through the repository, not raw SQL: `deletedAt` lives inside
    // `settings_json` and the reconciler filters on it being exactly `null`.
    new WorkspaceRepository(store).createWithId({
      id: WORKSPACE_ID,
      name: "Local Workspace",
      slug: "local-workspace",
      isPersonal: false,
      origin: "local",
      syncMode: "none",
    })
    clearWorkspaceEncryption()
    nock.disableNetConnect()
  })

  afterEach(() => {
    clearWorkspaceEncryption()
    db.close()
    nock.cleanAll()
    nock.enableNetConnect()
    rmSync(tempDir, { recursive: true, force: true })
  })

  /** A linked device, with the cloud config and account identity already stored. */
  function linked(): void {
    new DeviceTokenStore(repository, keyfilePath).setTokens("device-1", "access-token", "refresh-token")
    repository.upsertDevice({
      deviceId: "device-1",
      label: "Test Device",
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
    repository.setSetting("cloud.account_identity", JSON.stringify({ accountId: ACCOUNT_ID }))
    // The control builds its own DeviceTokenStore, so it starts with no
    // in-memory session and refreshes once before its first RPC.
    nock("https://auth.test").post("/oauth/v2/token")
      .reply(200, { id_token: "id-token", refresh_token: "refresh-token-2" })
    nock("https://api.test").post("/desktop/auth/session", { idToken: "id-token" })
      .reply(200, { sessionToken: "session-1", expiresAt: "2099-01-01T00:00:00.000Z" })
  }

  function bindWorkspace(): void {
    repository.upsertWorkspaceBinding({
      workspaceId: WORKSPACE_ID,
      cloudWorkspaceId: CLOUD_WORKSPACE_ID,
      cloudWorkspaceName: "Cloud Workspace",
      syncMode: "bi-directional",
      deviceId: "device-1",
      initializationState: "initialized",
    })
  }

  function control(): DesktopCloudSyncControl {
    return new DesktopCloudSyncControl({
      store,
      keyfilePath,
      defaults: { cloudEntryUrl: "https://cloud.test", clientVersion: "1.0.0", deviceLabel: "Test Device" },
      setSyncProviderTarget: () => undefined,
    })
  }

  // ─── Launch unlock ─────────────────────────────────────────────────────────

  it("registers a cached WDEK for an e2ee workspace at launch", () => {
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "e2ee")
    cacheWdek(settings, WORKSPACE_ID, provisioned.wdek)

    const status = control().status()

    expect(Buffer.from(workspaceWdek(WORKSPACE_ID) ?? new Uint8Array()))
      .toEqual(Buffer.from(provisioned.wdek))
    expect(status.bindings[0]?.encryption).toBe("unlocked")
  })

  it("registers an e2ee workspace as locked when the cache is missing", () => {
    // Another machine, a cleared keychain, or a Linux box with no keyring.
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "e2ee")

    const status = control().status()

    expect(() => workspaceWdek(WORKSPACE_ID)).toThrow(WorkspaceLocked)
    expect(status.bindings[0]?.encryption).toBe("locked")
  })

  it("never registers a key for a plaintext workspace", () => {
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "none")

    const status = control().status()

    expect(workspaceWdek(WORKSPACE_ID)).toBeNull()
    expect(status.bindings[0]?.encryption).toBe("plaintext")
  })

  it("treats an unclassified workspace as locked, not as plaintext", () => {
    // UNSPECIFIED (or a server that never sent the field) must never be read as
    // "plaintext" — pushing it in the clear would commit it to plaintext
    // forever, because the server enforces encryption_mode write-once.
    linked()
    bindWorkspace()

    const status = control().status()

    expect(() => workspaceWdek(WORKSPACE_ID)).toThrow(WorkspaceLocked)
    expect(status.bindings[0]?.encryption).toBe("unknown")
  })

  it("backfills a missing encryption mode with one catalog refresh at launch", async () => {
    // Upgrading from a pre-E2EE build: the persisted catalog predates
    // `encryptionMode`, so the binding launches unclassified — locked, never
    // pushed — until the catalog is refetched. Launch does that itself.
    linked()
    bindWorkspace()
    let listed = 0
    // Spare auth interceptors, so a second refresh reaches ListSyncWorkspaces
    // instead of dying at the session handshake — "once" must mean once, not
    // "ran out of credentials".
    nock("https://auth.test").post("/oauth/v2/token").times(2)
      .reply(200, { id_token: "id-token", refresh_token: "refresh-token-3" })
    nock("https://api.test").post("/desktop/auth/session", { idToken: "id-token" }).times(2)
      .reply(200, { sessionToken: "session-2", expiresAt: "2099-01-01T00:00:00.000Z" })
    // Deliberately more interceptors than the single call expected: a second
    // refresh is counted here instead of vanishing into disableNetConnect.
    nock("https://api.test").post(`${DEVICE_SERVICE}/ListSyncWorkspaces`).times(3).reply(200, () => {
      listed += 1
      return {
        workspaces: [{
          workspaceId: CLOUD_WORKSPACE_ID,
          workspaceName: "Cloud Workspace",
          isPersonal: false,
          effectiveRole: "SYNC_WORKSPACE_ROLE_ADMIN",
          capabilities: { canPull: true, canPush: true, canResolveConflicts: true },
          encryptionMode: "WORKSPACE_ENCRYPTION_MODE_E2EE",
        }],
      }
    })
    nock("https://api.test").post(`${DEVICE_SERVICE}/ListSyncTeams`).times(3).reply(200, {})

    const subject = control()
    expect(subject.status().bindings[0]?.encryption).toBe("unknown")

    await vi.waitFor(() => expect(settings.get(`cloud.e2ee.mode.${WORKSPACE_ID}`)).toBe("e2ee"))
    expect(subject.status().bindings[0]?.encryption).toBe("locked")
    // Once per process: the refresh reconciles, and reconciling can reactivate.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(listed).toBe(1)
  })

  // ─── Unlock ────────────────────────────────────────────────────────────────

  function nockGetEncryption(): nock.Scope {
    return nock("https://api.test")
      .post(`${DEVICE_SERVICE}/GetWorkspaceEncryption`, { workspaceId: CLOUD_WORKSPACE_ID })
      .reply(200, {
        mode: "WORKSPACE_ENCRYPTION_MODE_E2EE",
        wrappedWdek: provisioned.bundle.wrappedWdek,
        kdfSalt: provisioned.bundle.kdfSalt,
        kdfParams: provisioned.bundle.kdfParams,
        wdekFingerprint: provisioned.bundle.wdekFingerprint,
      })
  }

  it("unlocks with the right passphrase and registers the key", async () => {
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "e2ee")
    const scope = nockGetEncryption()

    const status = await control().unlockWorkspace({ workspaceId: WORKSPACE_ID, passphrase: PASSPHRASE })

    expect(Buffer.from(workspaceWdek(WORKSPACE_ID) ?? new Uint8Array()))
      .toEqual(Buffer.from(provisioned.wdek))
    expect(status.bindings[0]?.encryption).toBe("unlocked")
    // Cached, so the next launch does not prompt again.
    expect(settings.get(`cloud.e2ee.wdek.${WORKSPACE_ID}`)).toBeDefined()
    expect(scope.isDone()).toBe(true)
  })

  it("reports a wrong passphrase distinguishably and registers nothing", async () => {
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "e2ee")
    nockGetEncryption()
    const subject = control()

    await expect(subject.unlockWorkspace({ workspaceId: WORKSPACE_ID, passphrase: "wrong" }))
      .rejects.toMatchObject({ name: "CloudWorkspacePassphraseIncorrectError" })

    expect(() => workspaceWdek(WORKSPACE_ID)).toThrow(WorkspaceLocked)
    expect(settings.get(`cloud.e2ee.wdek.${WORKSPACE_ID}`)).toBeUndefined()
    expect(subject.status().bindings[0]?.encryption).toBe("locked")
  })

  it("locks a workspace back to locked, not back to plaintext", () => {
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "e2ee")
    cacheWdek(settings, WORKSPACE_ID, provisioned.wdek)
    const subject = control()

    const status = subject.lockWorkspace({ workspaceId: WORKSPACE_ID })

    expect(() => workspaceWdek(WORKSPACE_ID)).toThrow(WorkspaceLocked)
    expect(settings.get(`cloud.e2ee.wdek.${WORKSPACE_ID}`)).toBeUndefined()
    expect(status.bindings[0]?.encryption).toBe("locked")
  })

  // ─── The pending-decision gate ─────────────────────────────────────────────

  /** ListSyncWorkspaces + ListSyncTeams, both empty: nothing to pair with. */
  function nockEmptyCatalog(): void {
    nock("https://api.test").post(`${DEVICE_SERVICE}/ListSyncWorkspaces`).reply(200, {})
    nock("https://api.test").post(`${DEVICE_SERVICE}/ListSyncTeams`).reply(200, {})
  }

  it("does not provision or push a workspace whose encryption decision is pending", async () => {
    linked()
    nockEmptyCatalog()
    // Deliberately NO EnsureSyncWorkspace interceptor: reaching it would be the
    // bug. nock.disableNetConnect turns any such call into a failure.
    const subject = control()

    const status = await subject.refreshWorkspaceCatalog()

    expect(repository.getWorkspaceBinding(WORKSPACE_ID)).toBeUndefined()
    expect(repository.countPendingOutbox(WORKSPACE_ID)).toBe(0)
    expect(status.encryptionDecisionPending).toEqual([
      { workspaceId: WORKSPACE_ID, workspaceName: "Local Workspace" },
    ])
  })

  it("provisions with a valid bundle once encryption is chosen", async () => {
    linked()
    nockEmptyCatalog()
    let sent: Record<string, string> | undefined
    nock("https://api.test")
      .post(`${DEVICE_SERVICE}/EnsureSyncWorkspace`, (body: Record<string, unknown>) => {
        sent = body["encryption"] as Record<string, string> | undefined
        return true
      })
      .reply(200, {
        workspaceId: WORKSPACE_ID,
        workspaceName: "Local Workspace",
        isPersonal: false,
        effectiveRole: 5,
        capabilities: { canPull: true, canPush: true, canResolveConflicts: true },
        encryptionMode: "WORKSPACE_ENCRYPTION_MODE_E2EE",
      })

    const status = await control().setWorkspaceEncryption({
      workspaceId: WORKSPACE_ID,
      passphrase: PASSPHRASE,
    })

    // The bundle actually reached the wire and satisfies the server's rules.
    const bundle = requireBundle(sent)
    expect(bundle["mode"]).toBe("WORKSPACE_ENCRYPTION_MODE_E2EE")
    expect(Buffer.from(bundle["wrappedWdek"], "base64")).toHaveLength(60)
    expect(Buffer.from(bundle["kdfSalt"], "base64").length).toBeGreaterThanOrEqual(16)
    expect(bundle["wdekFingerprint"]).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.parse(bundle["kdfParams"])).toMatchObject({ N: 131072 })

    expect(repository.getWorkspaceBinding(WORKSPACE_ID)).toBeDefined()
    expect(status.bindings[0]?.encryption).toBe("unlocked")
    expect(status.encryptionDecisionPending).toEqual([])
    expect(workspaceWdek(WORKSPACE_ID)).not.toBeNull()
  })

  it("believes the server's answer, not its own request", async () => {
    // EnsureSyncWorkspace silently ignores `encryption` on a workspace that
    // already exists. Asking for E2EE and being told NONE must leave the
    // workspace plaintext with no key held — otherwise every record would be
    // sealed under a key the server does not know about.
    linked()
    nockEmptyCatalog()
    nock("https://api.test")
      .post(`${DEVICE_SERVICE}/EnsureSyncWorkspace`)
      .reply(200, {
        workspaceId: WORKSPACE_ID,
        workspaceName: "Local Workspace",
        isPersonal: false,
        effectiveRole: 5,
        capabilities: { canPull: true, canPush: true, canResolveConflicts: true },
        encryptionMode: "WORKSPACE_ENCRYPTION_MODE_NONE",
      })

    const status = await control().setWorkspaceEncryption({
      workspaceId: WORKSPACE_ID,
      passphrase: PASSPHRASE,
    })

    expect(status.bindings[0]?.encryption).toBe("plaintext")
    expect(workspaceWdek(WORKSPACE_ID)).toBeNull()
    expect(settings.get(`cloud.e2ee.wdek.${WORKSPACE_ID}`)).toBeUndefined()
  })

  it("provisions in the clear once encryption is explicitly declined", async () => {
    linked()
    nockEmptyCatalog()
    let sent: unknown = "unset"
    nock("https://api.test")
      .post(`${DEVICE_SERVICE}/EnsureSyncWorkspace`, (body: Record<string, unknown>) => {
        sent = body["encryption"]
        return true
      })
      .reply(200, {
        workspaceId: WORKSPACE_ID,
        workspaceName: "Local Workspace",
        isPersonal: false,
        effectiveRole: 5,
        capabilities: { canPull: true, canPush: true, canResolveConflicts: true },
        encryptionMode: "WORKSPACE_ENCRYPTION_MODE_NONE",
      })

    const status = await control().declineWorkspaceEncryption({ workspaceId: WORKSPACE_ID })

    expect(sent).toBeUndefined()
    expect(repository.getWorkspaceBinding(WORKSPACE_ID)).toBeDefined()
    expect(status.bindings[0]?.encryption).toBe("plaintext")
    expect(status.encryptionDecisionPending).toEqual([])
  })

  it("refuses to change a mode the server has already committed", async () => {
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "none")
    const subject = control()

    await expect(subject.setWorkspaceEncryption({ workspaceId: WORKSPACE_ID, passphrase: PASSPHRASE }))
      .rejects.toThrow(CloudWorkspaceEncryptionSettledError)

    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "e2ee")
    await expect(subject.declineWorkspaceEncryption({ workspaceId: WORKSPACE_ID }))
      .rejects.toThrow(CloudWorkspaceEncryptionSettledError)
  })

  it("sends one bundle when creating an encrypted Team workspace", async () => {
    const TEAM_WORKSPACE_ID = "01TEAMWORKSPACE000000000000"
    linked()
    repository.setSetting("cloud.team_catalog", JSON.stringify([
      { teamId: "team-1", teamName: "Team", isPersonal: false, canCreateWorkspaces: true },
    ]))
    let sent: Record<string, string> | undefined
    let requestId: unknown
    nock("https://api.test")
      .post(`${DEVICE_SERVICE}/CreateSyncWorkspace`, (body: Record<string, unknown>) => {
        sent = body["encryption"] as Record<string, string> | undefined
        requestId = body["requestId"]
        return true
      })
      .reply(200, {
        workspaceId: TEAM_WORKSPACE_ID,
        workspaceName: "Team Workspace",
        teamId: "team-1",
        teamName: "Team",
        isPersonal: false,
        effectiveRole: 5,
        capabilities: { canPull: true, canPush: true, canResolveConflicts: true },
        encryptionMode: "WORKSPACE_ENCRYPTION_MODE_E2EE",
      })

    const created = await control().createTeamWorkspace({
      name: "Team Workspace",
      slug: "team-workspace",
      teamId: "team-1",
      passphrase: PASSPHRASE,
    })

    expect(created.workspaceId).toBe(TEAM_WORKSPACE_ID)
    expect(typeof requestId).toBe("string")
    const bundle = requireBundle(sent)
    expect(Buffer.from(bundle["wrappedWdek"], "base64")).toHaveLength(60)
    expect(bundle["wdekFingerprint"]).toMatch(/^[0-9a-f]{16}$/)
    // The key that was wrapped is the key the transport now holds.
    expect(workspaceWdek(TEAM_WORKSPACE_ID)).not.toBeNull()
    expect(settings.get(`cloud.e2ee.mode.${TEAM_WORKSPACE_ID}`)).toBe("e2ee")
  })

  // ─── Changing the passphrase ───────────────────────────────────────────────

  /** An e2ee workspace whose key this device holds — the only state a rewrap runs from. */
  function unlockedWorkspace(): void {
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "e2ee")
    cacheWdek(settings, WORKSPACE_ID, provisioned.wdek)
  }

  function nockSetPassphrase(status: number, body: unknown): void {
    nock("https://api.test").post(`${DEVICE_SERVICE}/SetWorkspacePassphrase`).reply(status, body)
  }

  it("refuses to rewrap a workspace whose key this device does not hold", async () => {
    // Typed, not a bare Error: an untyped failure skips the IPC mapping and
    // reaches the renderer wrapped in Electron's "Error invoking remote method"
    // prefix, with no code to branch on.
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "e2ee")

    await expect(control().setWorkspaceEncryption({ workspaceId: WORKSPACE_ID, passphrase: PASSPHRASE }))
      .rejects.toThrow(CloudWorkspaceLockedError)
  })

  it("names the admin rule when the server refuses the rewrap", async () => {
    unlockedWorkspace()
    // connect-go maps PermissionDenied to HTTP 403 (connectCodeToHTTP).
    nockSetPassphrase(403, { code: "permission_denied", message: "forbidden" })
    const subject = control()

    await expect(subject.setWorkspaceEncryption({ workspaceId: WORKSPACE_ID, passphrase: "a much longer one" }))
      .rejects.toThrow(CloudWorkspacePassphraseAdminOnlyError)

    // A refused rewrap must not cost this device the key it already had.
    expect(subject.status().bindings[0]?.encryption).toBe("unlocked")
  })

  it("reports a fingerprint the server does not recognise as unusable settings", async () => {
    unlockedWorkspace()
    // The zero-row update is FailedPrecondition, which Connect sends as HTTP 400.
    nockSetPassphrase(400, { code: "failed_precondition", message: "wdek_fingerprint does not match" })
    const subject = control()

    await expect(subject.setWorkspaceEncryption({ workspaceId: WORKSPACE_ID, passphrase: "a much longer one" }))
      .rejects.toThrow(CloudWorkspaceEncryptionInvalidError)
    expect(subject.status().bindings[0]?.encryption).toBe("unlocked")
  })

  it("forgets a workspace's key material on unbind", () => {
    linked()
    bindWorkspace()
    settings.set(`cloud.e2ee.mode.${WORKSPACE_ID}`, "e2ee")
    cacheWdek(settings, WORKSPACE_ID, provisioned.wdek)

    control().unbindWorkspace({ workspaceId: WORKSPACE_ID })

    expect(settings.get(`cloud.e2ee.wdek.${WORKSPACE_ID}`)).toBeUndefined()
    expect(settings.get(`cloud.e2ee.mode.${WORKSPACE_ID}`)).toBeUndefined()
    expect(workspaceWdek(WORKSPACE_ID)).toBeNull()
  })
})
