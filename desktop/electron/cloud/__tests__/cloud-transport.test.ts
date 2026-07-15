import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import nock from "nock"
import { initDatabase, type KVStore, type Database } from "../../../core/db"
import { CLOUD_OUTBOX_MAX_RETRIES, CloudSyncRepository } from "../../../core/repositories"
import { createKeyfile } from "../../../core/secrets/keyfile"
import { CloudSyncProvider } from "../cloud-transport"
import { CloudClient, DeviceTokenStore } from "../cloud-client"
import { RecordKind, ChangeOp } from "../cloud-apply"

const API_BASE = "https://api.test.apiweave.cloud"
const ZITADEL_ISSUER = "https://auth.test.apiweave.cloud"
const CLIENT_ID = "test-client-id"
const WORKSPACE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
const CLOUD_WORKSPACE_ID = "01CLOUDWORKSPACE00000000000"

describe("CloudSyncProvider", () => {
  let db: Database
  let store: KVStore
  let keyfilePath: string
  let tempDir: string
  let tokenStore: DeviceTokenStore
  let client: CloudClient
  let provider: CloudSyncProvider

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cloud-transport-test-"))
    keyfilePath = join(tempDir, "keyfile.json")
    createKeyfile(keyfilePath)

    const dbPath = join(tempDir, "test.db")
    const initialized = initDatabase({ databasePath: dbPath })
    db = initialized.database
    store = initialized.kvStore

    // Create a workspace for FK constraints
    store.set(
      "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
      [WORKSPACE_ID, "Test Workspace", "test-workspace", "cloud", "bi-directional", "{}"],
    )

    tokenStore = new DeviceTokenStore(store, keyfilePath)
    tokenStore.setTokens("device-123", "access-token-xyz", "refresh-token-abc")

    client = new CloudClient(
      {
        baseUrl: API_BASE,
        clientVersion: "1.0.0",
        zitadelIssuer: ZITADEL_ISSUER,
        clientId: CLIENT_ID,
      },
      tokenStore,
    )

    provider = new CloudSyncProvider(client, tokenStore, store, {
      workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: WORKSPACE_ID }],
    })

    nock.disableNetConnect()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    nock.cleanAll()
    nock.enableNetConnect()
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("happy path", () => {
    it("keeps app sessions and plaintext refresh tokens out of SQLite", () => {
      const sessionCanary = "session-canary-must-stay-in-memory"
      const refreshCanary = "refresh-canary-must-be-encrypted"
      tokenStore.setTokens("device-canary", sessionCanary, refreshCanary)

      const settings = store.query<{ key: string; value: string }>(
        "SELECT key, value FROM app_settings WHERE key LIKE 'cloud.%' ORDER BY key",
      )
      const persisted = JSON.stringify(settings)
      expect(settings.some((setting) => setting.key === "cloud.access_token")).toBe(false)
      expect(persisted).not.toContain(sessionCanary)
      expect(persisted).not.toContain(refreshCanary)
      expect(tokenStore.getAccessToken()).toBe(sessionCanary)
      expect(tokenStore.getRefreshToken()).toBe(refreshCanary)
    })

    it("deletes legacy plaintext app sessions when the token store starts", () => {
      store.set(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        ["cloud.access_token", "legacy-session-canary"],
      )

      const restartedStore = new DeviceTokenStore(store, keyfilePath)

      expect(restartedStore.getAccessToken()).toBeUndefined()
      expect(store.get("SELECT value FROM app_settings WHERE key = 'cloud.access_token'")).toBeUndefined()
    })

    it("routes catalog, revoke, resolve, and loser RPCs through the authenticated client", async () => {
      nock(API_BASE)
        .post("/apiweave.v1.DeviceService/ListSyncWorkspaces", {})
        .reply(200, {
          workspaces: [{
            workspaceId: CLOUD_WORKSPACE_ID,
            workspaceName: "Personal",
            teamId: "",
            teamName: "",
            isPersonal: true,
            effectiveRole: "SYNC_WORKSPACE_ROLE_ADMIN",
            capabilities: { canPull: true, canPush: true, canResolveConflicts: true },
          }],
        })
      nock(API_BASE)
        .post("/apiweave.v1.DeviceService/RevokeDevice", { deviceId: "device-123" })
        .reply(200, {})
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/ResolveConflict", {
          conflictId: "conflict-123",
          winner: "CONFLICT_WINNER_LOCAL",
          deviceId: "device-123",
        })
        .reply(200, {})
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/FetchLoser", { conflictId: "conflict-123" })
        .reply(200, { loserPayload: Buffer.from("loser-copy").toString("base64") })

      const catalog = await client.listSyncWorkspaces()
      await client.revokeDevice("device-123")
      await client.resolveConflict("conflict-123", "local")
      const loser = await client.fetchLoser("conflict-123")

      expect(catalog.workspaces[0]).toMatchObject({
        workspaceId: CLOUD_WORKSPACE_ID,
        effectiveRole: 5,
      })
      expect(Buffer.from(loser.loserPayload).toString("utf8")).toBe("loser-copy")
      expect(nock.isDone()).toBe(true)
    })

    it("records local mutations into the durable outbox", () => {
      provider.recordMutation({
        workspaceId: WORKSPACE_ID,
        kind: RecordKind.WORKFLOW,
        recordId: "workflow-local",
        expectedRev: 2,
        op: ChangeOp.UPSERT,
        payload: new TextEncoder().encode(JSON.stringify({ name: "Local" })),
      })
      provider.recordMutation({
        workspaceId: "01OTHERWORKSPACE0000000000",
        kind: RecordKind.WORKFLOW,
        recordId: "workflow-skipped",
        expectedRev: 0,
        op: ChangeOp.UPSERT,
        payload: new TextEncoder().encode(JSON.stringify({ name: "Skipped" })),
      })

      const rows = store.query<{ record_id: string; expected_rev: number; kind: string }>(
        "SELECT record_id, expected_rev, kind FROM cloud_outbox ORDER BY created_at ASC",
      )
      expect(rows).toEqual([{ record_id: "workflow-local", expected_rev: 2, kind: "workflow" }])
    })

    it("pulls changes and applies them to local store", async () => {
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, {
          protocolVersion: 1,
          serverNow: "2026-07-11T12:00:00Z",
          fullResyncRequired: false,
        })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [
            {
              cursor: "100",
              workspaceId: { value: WORKSPACE_ID },
              kind: RecordKind.WORKFLOW,
              recordId: "workflow-1",
              rev: "5",
              op: ChangeOp.UPSERT,
              payload: Buffer.from(JSON.stringify({
                name: "Synced Workflow",
                graph: { nodes: [], edges: [] },
                variables: {},
              })).toString("base64"),
            },
          ],
          nextCursor: "100",
          hasMore: false,
          serverNow: "2026-07-11T12:00:00Z",
        })

      await provider.pull()

      const workflow = store.get<{ id: string; name: string }>(
        "SELECT id, name FROM workflows WHERE id = ?",
        ["workflow-1"],
      )
      expect(workflow).toBeDefined()
      expect(workflow?.name).toBe("Synced Workflow")
    })

    it("pushes outbox entries to server", async () => {
      const outboxId = provider.enqueue({
        kind: "workflow",
        record_id: "workflow-2",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({
          name: "Local Workflow",
          graph: { nodes: [], edges: [] },
        })),
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .reply(200, {
          outcomes: [
            {
              deltaIndex: 0,
              status: 1, // APPLIED
              newRev: "1",
              rejectionReason: 0,
              conflictId: "",
            },
          ],
        })

      await provider.push()

      const remaining = store.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM cloud_outbox WHERE id = ?",
        [outboxId],
      )
      expect(remaining?.count ?? 0).toBe(0)
    })

    it("uses each outbox row as the idempotency boundary", async () => {
      const firstId = provider.enqueue({
        kind: "workflow",
        record_id: "workflow-first",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "First" })),
      })
      const secondId = provider.enqueue({
        kind: "workflow",
        record_id: "workflow-second",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Second" })),
      })
      const seenKeys: string[] = []

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas", (body) => {
          const request = body as { idempotencyKey?: string; deltas?: unknown[] }
          seenKeys.push(request.idempotencyKey ?? "")
          return request.deltas?.length === 1
        })
        .times(2)
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 1, newRev: "1", rejectionReason: 0, conflictId: "" }],
        })

      await provider.push()

      expect(seenKeys).toEqual([firstId, secondId])
    })

    it("maps local workspace IDs to cloud IDs in both transport directions", async () => {
      const mappedProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID }],
      })
      mappedProvider.recordMutation({
        workspaceId: WORKSPACE_ID,
        kind: RecordKind.WORKSPACE,
        recordId: WORKSPACE_ID,
        expectedRev: 0,
        op: ChangeOp.UPSERT,
        payload: new TextEncoder().encode(JSON.stringify({ name: "Mapped" })),
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas", (body) => {
          const request = body as {
            deltas?: Array<{ workspaceId?: { value?: string }; recordId?: string }>
          }
          const delta = request.deltas?.[0]
          return delta?.workspaceId?.value === CLOUD_WORKSPACE_ID && delta.recordId === CLOUD_WORKSPACE_ID
        })
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 1, newRev: "1", rejectionReason: 0, conflictId: "" }],
        })

      await mappedProvider.push()

      expect(store.get<{ total: number }>("SELECT COUNT(*) AS total FROM cloud_outbox")?.total).toBe(0)

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, {
          protocolVersion: 1,
          serverNow: "2026-07-11T12:00:00Z",
          fullResyncRequired: false,
        })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges", (body) => {
          const request = body as { workspaceId?: { value?: string } }
          return request.workspaceId?.value === CLOUD_WORKSPACE_ID
        })
        .reply(200, {
          changes: [{
            cursor: "50",
            workspaceId: { value: CLOUD_WORKSPACE_ID },
            kind: RecordKind.WORKSPACE,
            recordId: CLOUD_WORKSPACE_ID,
            rev: "2",
            op: ChangeOp.UPSERT,
            payload: Buffer.from(JSON.stringify({ name: "Mapped From Cloud" })).toString("base64"),
          }],
          nextCursor: "50",
          hasMore: false,
        })

      await mappedProvider.pull()

      expect(store.get<{ name: string }>("SELECT name FROM workspaces WHERE id = ?", [WORKSPACE_ID]))
        .toEqual({ name: "Mapped From Cloud" })
      expect(store.get("SELECT 1 FROM workspaces WHERE id = ?", [CLOUD_WORKSPACE_ID])).toBeUndefined()
    })

    it("handles offline edit, restart, reconnect cycle", async () => {
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-offline",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Offline Edit" })),
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 1, newRev: "1", rejectionReason: 0, conflictId: "" }],
        })

      await provider.push()

      const count = store.get<{ total: number }>("SELECT COUNT(*) as total FROM cloud_outbox")
      expect(count?.total ?? 0).toBe(0)
    })

    it("refreshes during pull after an RPC returns 401", async () => {
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(401, { code: "UNAUTHENTICATED" })
      nock(ZITADEL_ISSUER)
        .post("/oauth/v2/token")
        .reply(200, { id_token: "pull-id-token", refresh_token: "pull-rotated-refresh" })
      nock(API_BASE)
        .post("/desktop/auth/session", { idToken: "pull-id-token" })
        .reply(200, { sessionToken: "pull-session-token", expiresAt: "2026-07-12T00:00:00Z" })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, { changes: [], nextCursor: "0", hasMore: false })

      await provider.pull()

      expect(tokenStore.getAccessToken()).toBe("pull-session-token")
      expect(tokenStore.getRefreshToken()).toBe("pull-rotated-refresh")
      expect(nock.isDone()).toBe(true)
    })

    it("reacquires an app session from encrypted refresh material after restart", async () => {
      const restartedTokenStore = new DeviceTokenStore(store, keyfilePath)
      const restartedClient = new CloudClient({
        baseUrl: API_BASE,
        clientVersion: "1.0.0",
        zitadelIssuer: ZITADEL_ISSUER,
        clientId: CLIENT_ID,
      }, restartedTokenStore)
      const restartedProvider = new CloudSyncProvider(restartedClient, restartedTokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: WORKSPACE_ID }],
      })
      expect(restartedTokenStore.getAccessToken()).toBeUndefined()

      nock(ZITADEL_ISSUER)
        .post("/oauth/v2/token")
        .reply(200, { id_token: "restart-id-token" })
      nock(API_BASE)
        .post("/desktop/auth/session", { idToken: "restart-id-token" })
        .reply(200, { sessionToken: "restart-session-token", expiresAt: "2026-07-12T00:00:00Z" })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, { changes: [], nextCursor: "0", hasMore: false })

      await restartedProvider.pull()

      expect(restartedTokenStore.getAccessToken()).toBe("restart-session-token")
      expect(nock.isDone()).toBe(true)
    })

    it("stops after one refresh when the retried RPC is still unauthorized", async () => {
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .times(2)
        .reply(401, { code: "UNAUTHENTICATED" })
      nock(ZITADEL_ISSUER)
        .post("/oauth/v2/token")
        .once()
        .reply(200, { id_token: "single-retry-id-token" })
      nock(API_BASE)
        .post("/desktop/auth/session", { idToken: "single-retry-id-token" })
        .once()
        .reply(200, { sessionToken: "single-retry-session", expiresAt: "2026-07-12T00:00:00Z" })

      await expect(provider.pull()).rejects.toThrow("unauthorized")

      expect(nock.isDone()).toBe(true)
    })
  })

  describe("negative scenarios", () => {
    it("preserves outbox on network loss", async () => {
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-netfail",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Net Fail" })),
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .replyWithError("network error")

      await expect(provider.push()).rejects.toThrow("network error")

      const row = store.get<{ retry_count: number; next_retry_at: number; failure_reason: string }>(
        "SELECT retry_count, next_retry_at, failure_reason FROM cloud_outbox",
      )
      expect(row?.retry_count).toBe(1)
      expect(row?.next_retry_at ?? 0).toBeGreaterThan(Date.now())
      expect(row?.failure_reason).toBe("transport error: Error")
    })

    it("refreshes token on 401 and retries", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-expired",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Expired" })),
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .reply(401, { code: "UNAUTHENTICATED" })

      nock(ZITADEL_ISSUER)
        .post("/oauth/v2/token")
        .reply(200, {
          access_token: "new-access-token",
          id_token: "new-id-token",
          refresh_token: "new-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        })

      nock(API_BASE)
        .post("/desktop/auth/session", { idToken: "new-id-token" })
        .reply(200, {
          sessionToken: "new-session-token",
          expiresAt: "2026-07-12T00:00:00Z",
        })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 1, newRev: "1", rejectionReason: 0, conflictId: "" }],
        })

      await provider.push()

      const count = store.get<{ total: number }>("SELECT COUNT(*) as total FROM cloud_outbox")
      expect(count?.total ?? 0).toBe(0)
      expect(tokenStore.getAccessToken()).toBe("new-session-token")
      expect(tokenStore.getRefreshToken()).toBe("new-refresh-token")
      expect(JSON.stringify(store.query<{ key: string; value: string }>(
        "SELECT key, value FROM app_settings WHERE key LIKE 'cloud.%'",
      ))).not.toContain("new-session-token")
      const logs = JSON.stringify(logSpy.mock.calls)
      expect(logs).not.toContain("new-session-token")
      expect(logs).not.toContain("new-refresh-token")
    })

    it("preserves outbox on stale revision conflict", async () => {
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-stale",
        workspace_id: WORKSPACE_ID,
        expected_rev: 1,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Stale" })),
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .reply(200, {
          outcomes: [{
            deltaIndex: 0,
            status: 2,
            newRev: "0",
            rejectionReason: 0,
            conflictId: "conflict-1",
            winnerPayload: Buffer.from(JSON.stringify({ name: "Cloud", rev: 4 })).toString("base64"),
            loserPayload: Buffer.from(JSON.stringify({ name: "Stale" })).toString("base64"),
          }],
        })

      await provider.push()

      const count = store.get<{ total: number }>("SELECT COUNT(*) as total FROM cloud_outbox")
      expect(count?.total ?? 0).toBe(1)
      expect(store.get<{ status: string; server_conflict_id: string }>(
        "SELECT status, server_conflict_id FROM cloud_conflicts WHERE conflict_id = ?",
        ["conflict-1"],
      )).toEqual({ status: "pending", server_conflict_id: "conflict-1" })
      expect(new CloudSyncRepository(store).listPendingOutbox(100, Number.MAX_SAFE_INTEGER)).toEqual([])
    })

    it("dead-letters a mutation after the retry ceiling", async () => {
      const outboxId = provider.enqueue({
        kind: "workflow",
        record_id: "workflow-permanently-rejected",
        workspace_id: WORKSPACE_ID,
        expected_rev: 1,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Rejected" })),
      })
      store.set(
        "UPDATE cloud_outbox SET retry_count = ?, next_retry_at = 0 WHERE id = ?",
        [CLOUD_OUTBOX_MAX_RETRIES - 1, outboxId],
      )

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 3, newRev: "0", rejectionReason: 4, conflictId: "conflict-1" }],
        })

      await provider.push()
      await provider.push()

      const row = store.get<{ retry_count: number; failure_reason: string }>(
        "SELECT retry_count, failure_reason FROM cloud_outbox WHERE id = ?",
        [outboxId],
      )
      const repository = new CloudSyncRepository(store)
      expect(row?.retry_count).toBe(CLOUD_OUTBOX_MAX_RETRIES)
      expect(row?.failure_reason).toContain("conflictId=conflict-1")
      expect(repository.listPendingOutbox(100, Number.MAX_SAFE_INTEGER)).toEqual([])
      expect(repository.countDeadLetterOutbox()).toBe(1)
      expect(nock.isDone()).toBe(true)
    })

    it("throws on incompatible protocol version", async () => {
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, {
          protocolVersion: 99,
          serverNow: "2026-07-11T12:00:00Z",
          fullResyncRequired: false,
        })

      await expect(provider.pull()).rejects.toThrow("protocol mismatch")
    })

    it("does not overwrite a newer local revision during pull", async () => {
      store.set(
        "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["workflow-newer", WORKSPACE_ID, WORKSPACE_ID, "Local Newer", "local-newer", "{}", "{}", "{}", 5],
      )
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, {
          protocolVersion: 1,
          serverNow: "2026-07-11T12:00:00Z",
          fullResyncRequired: false,
        })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [{
            cursor: "300",
            workspaceId: { value: WORKSPACE_ID },
            kind: RecordKind.WORKFLOW,
            recordId: "workflow-newer",
            rev: "3",
            op: ChangeOp.UPSERT,
            payload: Buffer.from(JSON.stringify({ name: "Older Cloud", graph: {}, variables: {} })).toString("base64"),
          }],
          nextCursor: "300",
          hasMore: false,
        })

      await provider.pull()

      const workflow = store.get<{ name: string; rev: number }>(
        "SELECT name, rev FROM workflows WHERE id = ?",
        ["workflow-newer"],
      )
      expect(workflow).toEqual({ name: "Local Newer", rev: 5 })
    })

    it("creates a sanitized conflict when a pull overtakes a dirty local record", async () => {
      store.set(
        "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["workflow-dirty", WORKSPACE_ID, WORKSPACE_ID, "Local Dirty", "local-dirty", "{}", "{}", "{}", 6],
      )
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-dirty",
        workspace_id: WORKSPACE_ID,
        expected_rev: 5,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({
          name: "Local Dirty",
          graph: {
            nodes: [{ config: { headers: [{ key: "Authorization", value: "Bearer local-secret" }] } }],
            edges: [],
          },
          variables: { API_TOKEN: "local-secret" },
          rev: 6,
        })),
      })
      const states: string[] = []
      const conflictProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: WORKSPACE_ID }],
      }, (state) => states.push(state))

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [{
            cursor: "400",
            workspaceId: { value: WORKSPACE_ID },
            kind: RecordKind.WORKFLOW,
            recordId: "workflow-dirty",
            rev: "6",
            op: ChangeOp.UPSERT,
            payload: Buffer.from(JSON.stringify({
              name: "Cloud Concurrent",
              graph: { nodes: [{ config: { body: "cloud-secret-body" } }], edges: [] },
              variables: { PASSWORD: "cloud-secret" },
              rev: 6,
            })).toString("base64"),
          }],
          nextCursor: "400",
          hasMore: false,
        })

      await conflictProvider.pull()

      expect(store.get<{ name: string; rev: number }>(
        "SELECT name, rev FROM workflows WHERE id = ?",
        ["workflow-dirty"],
      )).toEqual({ name: "Local Dirty", rev: 6 })
      const repository = new CloudSyncRepository(store)
      const [conflict] = repository.listConflicts(false)
      expect(conflict).toMatchObject({
        workspaceId: WORKSPACE_ID,
        recordId: "workflow-dirty",
        baseRev: 5,
        localRev: 6,
        cloudRev: 6,
        status: "pending",
      })
      const localSnapshot = JSON.parse(Buffer.from(conflict?.localPayload ?? []).toString("utf8")) as {
        variables?: Record<string, unknown>
        graph?: { nodes?: Array<{ config?: { headers?: unknown[] } }> }
      }
      const cloudSnapshot = JSON.parse(Buffer.from(conflict?.cloudPayload ?? []).toString("utf8")) as {
        variables?: Record<string, unknown>
        graph?: { nodes?: Array<{ config?: { body?: string } }> }
      }
      expect(localSnapshot.variables).toEqual({})
      expect(localSnapshot.graph?.nodes?.[0]?.config?.headers).toEqual([])
      expect(cloudSnapshot.variables).toEqual({})
      expect(cloudSnapshot.graph?.nodes?.[0]?.config?.body).toBe("")
      expect(repository.listPendingOutbox(100, Number.MAX_SAFE_INTEGER)).toEqual([])
      expect(states.at(-1)).toBe("conflict")
    })
  })

  describe("forbidden payload", () => {
    it("rejects server-pushed payload with secrets", async () => {
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, {
          protocolVersion: 1,
          serverNow: "2026-07-11T12:00:00Z",
          fullResyncRequired: false,
        })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [
            {
              cursor: "200",
              workspaceId: { value: WORKSPACE_ID },
              kind: RecordKind.ENVIRONMENT,
              recordId: "env-forbidden",
              rev: "1",
              op: ChangeOp.UPSERT,
              payload: Buffer.from(JSON.stringify({
                name: "Forbidden Env",
                variables: {},
                secrets: { API_KEY: "secret-value" },
              })).toString("base64"),
            },
          ],
          nextCursor: "200",
          hasMore: false,
        })

      await expect(provider.pull()).rejects.toThrow("forbidden field")

      const env = store.get<{ id: string }>(
        "SELECT id FROM environments WHERE id = ?",
        ["env-forbidden"],
      )
      expect(env).toBeUndefined()
    })
  })

  describe("full resync", () => {
    it("preserves pending and dead-letter outbox rows while resetting the cursor", async () => {
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-orphan",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Orphan" })),
      })
      const deadLetterId = provider.enqueue({
        kind: "workflow",
        record_id: "workflow-dead-letter",
        workspace_id: WORKSPACE_ID,
        expected_rev: 1,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Dead Letter" })),
      })
      store.set("UPDATE cloud_outbox SET retry_count = ? WHERE id = ?", [CLOUD_OUTBOX_MAX_RETRIES, deadLetterId])
      const repository = new CloudSyncRepository(store)
      repository.setCursor(WORKSPACE_ID, 99n, 12n)

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, {
          protocolVersion: 1,
          serverNow: "2026-07-11T12:00:00Z",
          fullResyncRequired: true,
        })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [],
          nextCursor: "0",
          hasMore: false,
        })

      await provider.pull()

      const outboxCount = store.get<{ total: number }>("SELECT COUNT(*) as total FROM cloud_outbox")
      expect(outboxCount?.total ?? 0).toBe(2)
      expect(repository.countDeadLetterOutbox()).toBe(1)
      expect(repository.getCursor(WORKSPACE_ID)).toBeUndefined()
      expect(repository.getFullSync(WORKSPACE_ID)).toBeTypeOf("number")
    })
  })
})
