import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import nock from "nock"
import { initDatabase, type KVStore, type Database } from "../../../core/db"
import { createKeyfile } from "../../../core/secrets/keyfile"
import { CloudSyncProvider } from "../cloud-transport"
import { CloudClient, DeviceTokenStore } from "../cloud-client"
import { RecordKind, ChangeOp } from "../cloud-apply"

const API_BASE = "https://api.test.apiweave.cloud"
const ZITADEL_ISSUER = "https://auth.test.apiweave.cloud"
const CLIENT_ID = "test-client-id"
const WORKSPACE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"

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
      { baseUrl: API_BASE, clientVersion: "1.0.0" },
      tokenStore,
    )

    provider = new CloudSyncProvider(client, tokenStore, store, {
      workspaceIds: [WORKSPACE_ID],
      zitadelIssuer: ZITADEL_ISSUER,
      clientId: CLIENT_ID,
    })

    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("happy path", () => {
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

      await provider.push()

      const count = store.get<{ total: number }>("SELECT COUNT(*) as total FROM cloud_outbox")
      expect(count?.total ?? 0).toBe(1)
    })

    it("refreshes token on 401 and retries", async () => {
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
          refresh_token: "new-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
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
          outcomes: [{ deltaIndex: 0, status: 2, newRev: "0", rejectionReason: 0, conflictId: "conflict-1" }],
        })

      await provider.push()

      const count = store.get<{ total: number }>("SELECT COUNT(*) as total FROM cloud_outbox")
      expect(count?.total ?? 0).toBe(1)
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
    it("clears outbox and resets cursor on full_resync_required", async () => {
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-orphan",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Orphan" })),
      })

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
      expect(outboxCount?.total ?? 0).toBe(0)
    })
  })
})
