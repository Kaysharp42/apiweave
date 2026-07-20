import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import nock from "nock"
import { initDatabase, type KVStore, type Database } from "../../../core/db"
import { CLOUD_OUTBOX_MAX_RETRIES, CloudSyncRepository } from "../../../core/repositories"
import { encrypt, generateDek, wrapDek } from "../../../core/secrets/crypto"
import { createKeyfile, readKeyfile } from "../../../core/secrets/keyfile"
import { CloudSyncProvider } from "../cloud-transport"
import { CloudClient, DeviceTokenStore } from "../cloud-client"
import { RecordKind, ChangeOp } from "../cloud-apply"

const API_BASE = "https://api.test.apiweave.cloud"
const ZITADEL_ISSUER = "https://auth.test.apiweave.cloud"
const CLIENT_ID = "test-client-id"
const WORKSPACE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
const CLOUD_WORKSPACE_ID = "01CLOUDWORKSPACE00000000000"
const SECOND_WORKSPACE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW"
const SECOND_CLOUD_WORKSPACE_ID = "01CLOUDWORKSPACE00000000001"

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
    new CloudSyncRepository(store).upsertDevice({
      deviceId: "device-123",
      label: "Test Device",
      clientVersion: "1.0.0",
      publicKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    })

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

  describe("timestamp format regression", () => {
    // A cloud-applied upsert hitting the ON CONFLICT UPDATE branch must write
    // updatedAt in ISO-8601 UTC (…T…Z), matching TimestampSchema (z.iso.datetime()).
    // Regression: the branch previously used SQLite datetime('now')
    // ("YYYY-MM-DD HH:MM:SS"), which fails validation and broke every workspace/
    // workflow listing after a first sync applied cloud revisions.
    const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

    it("writes an ISO-8601 updatedAt when applying a cloud upsert to an existing record", () => {
      const repository = new CloudSyncRepository(store)
      // WORKSPACE_ID already exists at rev 1 (beforeEach) → this hits ON CONFLICT UPDATE.
      repository.applyChange({
        cursor: 1n,
        workspaceId: WORKSPACE_ID,
        kind: RecordKind.WORKSPACE,
        recordId: WORKSPACE_ID,
        rev: 5n,
        op: ChangeOp.UPSERT,
        payload: new TextEncoder().encode(JSON.stringify({ name: "Renamed", slug: "renamed" })),
      })
      const rows = store.query<{ updatedAt: string }>(
        "SELECT updatedAt FROM workspaces WHERE id = ?",
        [WORKSPACE_ID],
      )
      expect(rows[0]?.updatedAt).toMatch(ISO_UTC)
    })
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

    it("does not restore rotated credentials from a refresh that finishes after unlink", () => {
      const inFlightRefresh = tokenStore.loadRefreshToken()
      expect(inFlightRefresh).toBeDefined()

      tokenStore.clearTokens()
      inFlightRefresh?.rotate("late-rotated-refresh")
      inFlightRefresh?.setAccessToken("late-session")

      expect(tokenStore.hasTokens()).toBe(false)
      expect(tokenStore.getRefreshToken()).toBeUndefined()
      expect(tokenStore.getAccessToken()).toBeUndefined()
    })

    it("installs encrypted device credentials atomically inside an outer transaction", () => {
      const repository = new CloudSyncRepository(store)
      const atomicTokenStore = new DeviceTokenStore(repository, keyfilePath)
      const transactionSpy = vi.spyOn(repository, "transaction")
      const dek = generateDek()
      const masterKek = readKeyfile(keyfilePath).masterKek
      const encryptedRefresh = encrypt("atomic-refresh", dek, "kek-desktop-link")
      const wrappedDek = wrapDek(dek, masterKek)

      repository.transaction(() => {
        atomicTokenStore.setEncryptedTokens("atomic-device", encryptedRefresh, wrappedDek)
      })

      expect(transactionSpy).toHaveBeenCalledTimes(2)
      expect(atomicTokenStore.getDeviceId()).toBe("atomic-device")
      expect(atomicTokenStore.getRefreshToken()).toBe("atomic-refresh")

      expect(() => repository.transaction(() => {
        atomicTokenStore.setEncryptedTokens("rolled-back-device", encryptedRefresh, wrappedDek)
        throw new Error("roll back outer link transaction")
      })).toThrow("roll back outer link transaction")
      expect(atomicTokenStore.getDeviceId()).toBe("atomic-device")
      expect(atomicTokenStore.getRefreshToken()).toBe("atomic-refresh")
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
            futureWorkspaceField: "ignored",
          }],
          futureCatalogField: "ignored",
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
        .reply(200, {
          loserPayload: Buffer.from("loser-copy").toString("base64"),
          futureLoserField: "ignored",
        })

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

    it("tolerates future protobuf fields and enum values", async () => {
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, {
          protocolVersion: 1,
          fullResyncRequired: false,
          futureHelloField: "ignored",
        })
      nock(API_BASE)
        .post("/apiweave.v1.DeviceService/ListSyncWorkspaces", {})
        .reply(200, {
          workspaces: [{
            workspaceId: CLOUD_WORKSPACE_ID,
            workspaceName: "Future Role",
            effectiveRole: "SYNC_WORKSPACE_ROLE_FUTURE",
            futureWorkspaceField: true,
          }],
        })

      const hello = await client.hello()
      const catalog = await client.listSyncWorkspaces()

      expect(hello.protocolVersion).toBe(1)
      expect(catalog.workspaces[0]?.effectiveRole).toBe(0)
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

    it("uses the server revision domain after a high-revision local baseline uploads", () => {
      const repository = new CloudSyncRepository(store)
      const baselineId = repository.enqueueBaselineOutbox({
        kind: "workflow",
        record_id: "workflow-revision-domain",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Baseline", rev: 8 })),
      })
      repository.markOutboxApplied(baselineId, 1)

      provider.recordMutation({
        workspaceId: WORKSPACE_ID,
        kind: RecordKind.WORKFLOW,
        recordId: "workflow-revision-domain",
        expectedRev: 8,
        op: ChangeOp.UPSERT,
        payload: new TextEncoder().encode(JSON.stringify({ name: "Edited", rev: 9 })),
      })

      expect(store.get<{ expected_rev: number }>(
        "SELECT expected_rev FROM cloud_outbox WHERE record_id = ?",
        ["workflow-revision-domain"],
      )).toEqual({ expected_rev: 1 })
    })

    it("pulls changes and applies them to local store", async () => {
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, {
          protocolVersion: 1,
          serverNow: "2026-07-11T12:00:00Z",
          fullResyncRequired: false,
          futureHelloField: "ignored",
        })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [
            {
              cursor: "99",
              workspaceId: { value: WORKSPACE_ID },
              kind: RecordKind.PROJECT,
              recordId: "project-1",
              rev: "1",
              op: ChangeOp.UPSERT,
              payload: Buffer.from(JSON.stringify({
                collectionId: "project-1",
                workspaceId: WORKSPACE_ID,
                name: "Synced Project",
                workflowOrder: ["workflow-1"],
                workflowOrderItems: [{
                  workflowId: "workflow-1",
                  order: 2,
                  enabled: false,
                  continueOnFail: false,
                }],
              })).toString("base64"),
            },
            {
              cursor: "100",
              workspaceId: { value: WORKSPACE_ID },
              kind: RecordKind.WORKFLOW,
              recordId: "workflow-1",
              rev: "5",
              op: ChangeOp.UPSERT,
              payload: Buffer.from(JSON.stringify({
                name: "Synced Workflow",
                nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} }],
                edges: [],
                variables: {},
              })).toString("base64"),
              futureChangeField: "ignored",
            },
          ],
          nextCursor: "100",
          hasMore: false,
          serverNow: "2026-07-11T12:00:00Z",
          futurePullField: "ignored",
        })

      await provider.pull()

      const workflow = store.get<{ id: string; name: string; graph_json: string }>(
        "SELECT id, name, graph_json FROM workflows WHERE id = ?",
        ["workflow-1"],
      )
      expect(workflow).toBeDefined()
      expect(workflow?.name).toBe("Synced Workflow")
      expect(workflow?.graph_json).toContain('"nodeId":"start"')
      expect(store.get<{ workflow_ids_json: string }>(
        "SELECT workflow_ids_json FROM collections WHERE id = ?",
        ["project-1"],
      )?.workflow_ids_json).toBe('[{"workflowId":"workflow-1","order":2,"enabled":false,"continueOnFail":false}]')
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
              futureOutcomeField: "ignored",
            },
          ],
          futurePushField: "ignored",
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
            deltas?: Array<{ workspaceId?: { value?: string }; recordId?: string; payload?: string }>
          }
          const delta = request.deltas?.[0]
          const payload = JSON.parse(Buffer.from(delta?.payload ?? "", "base64").toString("utf8")) as {
            workspaceId?: string
          }
          return delta?.workspaceId?.value === CLOUD_WORKSPACE_ID
            && delta.recordId === CLOUD_WORKSPACE_ID
            && payload.workspaceId === CLOUD_WORKSPACE_ID
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

    it("maps workspace-scoped environment references at the cloud boundary", async () => {
      const mappedProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID }],
      })
      mappedProvider.enqueue({
        kind: "environment",
        record_id: "environment-mapped",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({
          environmentId: "environment-mapped",
          workspaceId: WORKSPACE_ID,
          name: "Mapped Environment",
          variables: {},
          secrets: { API_KEY: { reference: `workspace:${WORKSPACE_ID}:API_KEY` } },
          scopeType: "workspace",
          scopeId: WORKSPACE_ID,
        })),
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas", (body) => {
          const request = body as { deltas?: Array<{ payload?: string }> }
          const payload = JSON.parse(Buffer.from(request.deltas?.[0]?.payload ?? "", "base64").toString("utf8")) as {
            workspaceId?: string
            scopeId?: string
            secrets?: { API_KEY?: { reference?: string } }
          }
          return payload.workspaceId === CLOUD_WORKSPACE_ID
            && payload.scopeId === CLOUD_WORKSPACE_ID
            && payload.secrets?.API_KEY?.reference === `workspace:${CLOUD_WORKSPACE_ID}:API_KEY`
        })
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 1, newRev: "1", rejectionReason: 0, conflictId: "" }],
        })

      await mappedProvider.push()

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [{
            cursor: "1",
            workspaceId: { value: CLOUD_WORKSPACE_ID },
            kind: RecordKind.ENVIRONMENT,
            recordId: "environment-from-cloud",
            rev: "1",
            op: ChangeOp.UPSERT,
            payload: Buffer.from(JSON.stringify({
              environmentId: "environment-from-cloud",
              workspaceId: CLOUD_WORKSPACE_ID,
              name: "Cloud Environment",
              variables: {},
              secrets: { API_KEY: { reference: `workspace:${CLOUD_WORKSPACE_ID}:API_KEY` } },
              scopeType: "workspace",
              scopeId: CLOUD_WORKSPACE_ID,
            })).toString("base64"),
          }],
          nextCursor: "1",
          hasMore: false,
        })

      await mappedProvider.pull()

      expect(store.get<{ settings_json: string }>(
        "SELECT settings_json FROM environments WHERE id = ?",
        ["environment-from-cloud"],
      )?.settings_json).toContain(`workspace:${WORKSPACE_ID}:API_KEY`)
      expect(nock.isDone()).toBe(true)
    })

    it("resumes durable first sync by pulling before pushing the baseline", async () => {
      const repository = new CloudSyncRepository(store)
      repository.upsertWorkspaceBinding({
        workspaceId: WORKSPACE_ID,
        cloudWorkspaceId: CLOUD_WORKSPACE_ID,
        cloudWorkspaceName: "Cloud Workspace",
        syncMode: "bi-directional",
        deviceId: "device-123",
        initializationState: "pulling",
      })
      repository.enqueueBaselineOutbox({
        kind: "workflow",
        record_id: "workflow-baseline",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({
          name: "Local Baseline",
          graph: { nodes: [], edges: [] },
          variables: {},
        })),
      })
      const initializingProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID }],
      })
      let pulled = false

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(() => {
          pulled = true
          return [200, { changes: [], nextCursor: "0", hasMore: false }]
        })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas", () => pulled)
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 1, newRev: "1", rejectionReason: 0, conflictId: "" }],
        })

      await initializingProvider.initializeWorkspace(WORKSPACE_ID)

      expect(repository.getWorkspaceBinding(WORKSPACE_ID)?.initializationState).toBe("initialized")
      expect(repository.countBaselineOutbox(WORKSPACE_ID)).toBe(0)
      expect(nock.isDone()).toBe(true)
    })

    it("keeps a divergent same-ID baseline as a sanitized first-sync conflict", async () => {
      store.set(
        "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          "workflow-overlap",
          WORKSPACE_ID,
          WORKSPACE_ID,
          "Local",
          "local",
          JSON.stringify({ nodes: [{ config: { body: "local-private-body" } }], edges: [] }),
          "{}",
          "{}",
        ],
      )
      const repository = new CloudSyncRepository(store)
      repository.upsertWorkspaceBinding({
        workspaceId: WORKSPACE_ID,
        cloudWorkspaceId: CLOUD_WORKSPACE_ID,
        cloudWorkspaceName: "Cloud Workspace",
        syncMode: "bi-directional",
        deviceId: "device-123",
        initializationState: "pulling",
      })
      repository.enqueueBaselineOutbox({
        kind: "workflow",
        record_id: "workflow-overlap",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({
          name: "Local",
          graph: { nodes: [{ config: { body: "local-secret" } }], edges: [] },
          variables: { apiToken: "local-secret" },
        })),
      })
      const initializingProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID }],
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [{
            cursor: "1",
            workspaceId: { value: CLOUD_WORKSPACE_ID },
            kind: RecordKind.WORKFLOW,
            recordId: "workflow-overlap",
            rev: "1",
            op: ChangeOp.UPSERT,
            payload: Buffer.from(JSON.stringify({
              name: "Cloud",
              graph: { nodes: [{ config: { body: "" } }], edges: [] },
              variables: {},
            })).toString("base64"),
          }],
          nextCursor: "1",
          hasMore: false,
        })

      await initializingProvider.initializeWorkspace(WORKSPACE_ID)

      expect(repository.getWorkspaceBinding(WORKSPACE_ID)?.initializationState).toBe("pushing")
      expect(repository.countBaselineOutbox(WORKSPACE_ID)).toBe(1)
      const [conflict] = repository.listConflicts(false)
      expect(conflict?.recordId).toBe("workflow-overlap")
      expect(Buffer.from(conflict?.localPayload ?? []).toString("utf8")).not.toContain("local-secret")
      expect(Buffer.from(conflict?.cloudPayload ?? []).toString("utf8")).not.toContain("cloud-secret")
      repository.enqueueOutbox({
        kind: "workflow",
        record_id: "workflow-overlap",
        workspace_id: WORKSPACE_ID,
        expected_rev: 1,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Edited After Conflict" })),
      })
      if (conflict !== undefined) {
        repository.resolveConflict(conflict.conflictId, "local")
      }
      expect(store.get<{ graph_json: string }>("SELECT graph_json FROM workflows WHERE id = ?", ["workflow-overlap"])?.graph_json)
        .toContain("local-private-body")
      expect(Buffer.from(store.get<{ payload: Buffer }>(
        "SELECT payload FROM cloud_outbox WHERE record_id = ?",
        ["workflow-overlap"],
      )?.payload ?? []).toString("utf8")).toContain("Edited After Conflict")
      expect(nock.isDone()).toBe(true)
    })

    it("absorbs an equivalent same-ID baseline without uploading a duplicate", async () => {
      const repository = new CloudSyncRepository(store)
      repository.upsertWorkspaceBinding({
        workspaceId: WORKSPACE_ID,
        cloudWorkspaceId: CLOUD_WORKSPACE_ID,
        cloudWorkspaceName: "Cloud Workspace",
        syncMode: "bi-directional",
        deviceId: "device-123",
        initializationState: "pulling",
      })
      repository.enqueueBaselineOutbox({
        kind: "workflow",
        record_id: "workflow-equivalent",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({
          workflowId: "workflow-equivalent",
          workspaceId: WORKSPACE_ID,
          name: "Equivalent",
          graph: { nodes: [], edges: [] },
          variables: {},
          rev: 7,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
        })),
      })
      const initializingProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID }],
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [{
            cursor: "1",
            workspaceId: { value: CLOUD_WORKSPACE_ID },
            kind: RecordKind.WORKFLOW,
            recordId: "workflow-equivalent",
            rev: "3",
            op: ChangeOp.UPSERT,
            payload: Buffer.from(JSON.stringify({
              workflowId: "workflow-equivalent",
              workspaceId: CLOUD_WORKSPACE_ID,
              name: "Equivalent",
              graph: { nodes: [], edges: [] },
              variables: {},
              rev: 3,
              createdAt: "2025-12-01T00:00:00Z",
              updatedAt: "2026-02-01T00:00:00Z",
            })).toString("base64"),
          }],
          nextCursor: "1",
          hasMore: false,
        })

      await initializingProvider.initializeWorkspace(WORKSPACE_ID)

      expect(repository.countBaselineOutbox(WORKSPACE_ID)).toBe(0)
      expect(repository.countPendingConflicts()).toBe(0)
      expect(repository.getWorkspaceBinding(WORKSPACE_ID)?.initializationState).toBe("initialized")
      expect(nock.isDone()).toBe(true)
    })

    it("preserves and rebases a local edit made after an equivalent baseline snapshot", async () => {
      store.set(
        "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["workflow-edited", WORKSPACE_ID, WORKSPACE_ID, "Edited After Snapshot", "edited", "{}", "{}", "{}", 8],
      )
      const repository = new CloudSyncRepository(store)
      repository.upsertWorkspaceBinding({
        workspaceId: WORKSPACE_ID,
        cloudWorkspaceId: CLOUD_WORKSPACE_ID,
        cloudWorkspaceName: "Cloud Workspace",
        syncMode: "bi-directional",
        deviceId: "device-123",
        initializationState: "pulling",
      })
      repository.enqueueBaselineOutbox({
        kind: "workflow",
        record_id: "workflow-edited",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({
          name: "Before Edit",
          graph: { nodes: [], edges: [] },
          variables: {},
        })),
      })
      repository.enqueueOutbox({
        kind: "workflow",
        record_id: "workflow-edited",
        workspace_id: WORKSPACE_ID,
        expected_rev: 1,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({
          name: "Edited After Snapshot",
          graph: { nodes: [], edges: [] },
          variables: {},
        })),
      })
      const initializingProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID }],
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [{
            cursor: "1",
            workspaceId: { value: CLOUD_WORKSPACE_ID },
            kind: RecordKind.WORKFLOW,
            recordId: "workflow-edited",
            rev: "3",
            op: ChangeOp.UPSERT,
            payload: Buffer.from(JSON.stringify({
              name: "Before Edit",
              graph: { nodes: [], edges: [] },
              variables: {},
            })).toString("base64"),
          }],
          nextCursor: "1",
          hasMore: false,
        })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas", (body) => {
          const request = body as { deltas?: Array<{ expectedRev?: string; payload?: string }> }
          const delta = request.deltas?.[0]
          const payload = JSON.parse(Buffer.from(delta?.payload ?? "", "base64").toString("utf8")) as { name?: string }
          return delta?.expectedRev === "3" && payload.name === "Edited After Snapshot"
        })
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 1, newRev: "4", rejectionReason: 0, conflictId: "" }],
        })

      await initializingProvider.initializeWorkspace(WORKSPACE_ID)

      expect(store.get<{ name: string }>("SELECT name FROM workflows WHERE id = ?", ["workflow-edited"]))
        .toEqual({ name: "Edited After Snapshot" })
      expect(repository.countOutbox()).toBe(0)
      expect(repository.getWorkspaceBinding(WORKSPACE_ID)?.initializationState).toBe("initialized")
      expect(nock.isDone()).toBe(true)
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

    it("does not rewind a durable cursor when an empty page returns zero", async () => {
      const repository = new CloudSyncRepository(store)
      repository.setCursor(WORKSPACE_ID, 42n, 7n)
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges", (body) => {
          const request = body as { cursor?: string }
          return request.cursor === "42"
        })
        .reply(200, { changes: [], nextCursor: "0", hasMore: false })

      await provider.pull()

      expect(repository.getCursor(WORKSPACE_ID)).toEqual({ cursor: 42n, lastRev: 7n })
      expect(nock.isDone()).toBe(true)
    })

    it("does not pull an initialized push-only binding", async () => {
      const repository = new CloudSyncRepository(store)
      repository.upsertWorkspaceBinding({
        workspaceId: WORKSPACE_ID,
        cloudWorkspaceId: CLOUD_WORKSPACE_ID,
        cloudWorkspaceName: "Push Only",
        syncMode: "push",
        deviceId: "device-123",
        initializationState: "initialized",
      })
      const pushOnlyProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID }],
      })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })

      await pushOnlyProvider.pull()

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
    it("dead-letters outbox rows outside the configured bindings and still drains healthy workspaces", async () => {
      store.set(
        "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
        [SECOND_WORKSPACE_ID, "Unbound Workspace", "unbound-workspace", "local", "none", "{}"],
      )
      const orphanId = provider.enqueue({
        kind: "workflow",
        record_id: "workflow-unbound",
        workspace_id: SECOND_WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Unbound" })),
      })
      const boundId = provider.enqueue({
        kind: "workflow",
        record_id: "workflow-bound",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Bound" })),
      })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 1, newRev: "1", rejectionReason: 0, conflictId: "" }],
        })

      await expect(provider.push()).rejects.toThrow("1 cloud outbox row(s) have no workspace binding")

      expect(store.get("SELECT 1 FROM cloud_outbox WHERE id = ?", [boundId])).toBeUndefined()
      expect(store.get<{ retry_count: number; failure_reason: string }>(
        "SELECT retry_count, failure_reason FROM cloud_outbox WHERE id = ?",
        [orphanId],
      )).toEqual({
        retry_count: CLOUD_OUTBOX_MAX_RETRIES,
        failure_reason: "cloud workspace binding is unavailable",
      })
      expect(nock.isDone()).toBe(true)
    })

    it("marks malformed legacy payloads failed instead of wedging on the same row", async () => {
      const outboxId = provider.enqueue({
        kind: "workflow",
        record_id: "workflow-malformed",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify(["legacy-array-payload"])),
      })

      await expect(provider.push()).rejects.toThrow("Cloud outbox payload must be a JSON object")

      expect(store.get<{ retry_count: number; next_retry_at: number }>(
        "SELECT retry_count, next_retry_at FROM cloud_outbox WHERE id = ?",
        [outboxId],
      )).toMatchObject({ retry_count: 1 })
      expect(store.get<{ next_retry_at: number }>(
        "SELECT next_retry_at FROM cloud_outbox WHERE id = ?",
        [outboxId],
      )?.next_retry_at ?? 0).toBeGreaterThan(Date.now())
    })

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
      expect(row?.failure_reason).toBe("Can't reach the cloud right now. Sync will resume when you're back online.")
    })

    it("continues pulling later workspace bindings after one workspace fails", async () => {
      store.set(
        "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
        [SECOND_WORKSPACE_ID, "Second Workspace", "second-workspace", "cloud", "bi-directional", "{}"],
      )
      const repository = new CloudSyncRepository(store)
      repository.upsertWorkspaceBinding({
        workspaceId: WORKSPACE_ID,
        cloudWorkspaceId: CLOUD_WORKSPACE_ID,
        cloudWorkspaceName: "Failing Workspace",
        syncMode: "bi-directional",
        deviceId: "device-123",
        initializationState: "initialized",
      })
      repository.upsertWorkspaceBinding({
        workspaceId: SECOND_WORKSPACE_ID,
        cloudWorkspaceId: SECOND_CLOUD_WORKSPACE_ID,
        cloudWorkspaceName: "Healthy Workspace",
        syncMode: "bi-directional",
        deviceId: "device-123",
        initializationState: "initialized",
      })
      const isolatedProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [
          { workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID },
          { workspaceId: SECOND_WORKSPACE_ID, cloudWorkspaceId: SECOND_CLOUD_WORKSPACE_ID },
        ],
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges", (body) => {
          const request = body as { workspaceId?: { value?: string } }
          return request.workspaceId?.value === CLOUD_WORKSPACE_ID
        })
        .reply(503, { code: "UNAVAILABLE" })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges", (body) => {
          const request = body as { workspaceId?: { value?: string } }
          return request.workspaceId?.value === SECOND_CLOUD_WORKSPACE_ID
        })
        .reply(200, {
          changes: [{
            cursor: "1",
            workspaceId: { value: SECOND_CLOUD_WORKSPACE_ID },
            kind: RecordKind.WORKFLOW,
            recordId: "workflow-second-workspace",
            rev: "1",
            op: ChangeOp.UPSERT,
            payload: Buffer.from(JSON.stringify({
              name: "Pulled Despite Neighbor Failure",
              nodes: [],
              edges: [],
              variables: {},
            })).toString("base64"),
          }],
          nextCursor: "1",
          hasMore: false,
        })

      await expect(isolatedProvider.pull()).rejects.toThrow("503")

      expect(store.get<{ workspace_id: string; name: string }>(
        "SELECT workspace_id, name FROM workflows WHERE id = ?",
        ["workflow-second-workspace"],
      )).toEqual({ workspace_id: SECOND_WORKSPACE_ID, name: "Pulled Despite Neighbor Failure" })
      expect(repository.getWorkspaceBinding(WORKSPACE_ID)?.lastError).toBe("Something went wrong talking to the cloud. Sync will retry automatically.")
      expect(repository.getWorkspaceBinding(SECOND_WORKSPACE_ID)?.lastSyncedAt).not.toBeNull()
      expect(nock.isDone()).toBe(true)
    })

    it("continues pushing later workspace bindings after one workspace fails", async () => {
      store.set(
        "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
        [SECOND_WORKSPACE_ID, "Second Workspace", "second-workspace", "cloud", "bi-directional", "{}"],
      )
      const repository = new CloudSyncRepository(store)
      for (const binding of [
        { workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID, name: "Failing Workspace" },
        { workspaceId: SECOND_WORKSPACE_ID, cloudWorkspaceId: SECOND_CLOUD_WORKSPACE_ID, name: "Healthy Workspace" },
      ]) {
        repository.upsertWorkspaceBinding({
          workspaceId: binding.workspaceId,
          cloudWorkspaceId: binding.cloudWorkspaceId,
          cloudWorkspaceName: binding.name,
          syncMode: "bi-directional",
          deviceId: "device-123",
          initializationState: "initialized",
        })
        repository.enqueueOutbox({
          kind: "workflow",
          record_id: `workflow-${binding.workspaceId}`,
          workspace_id: binding.workspaceId,
          expected_rev: 0,
          op: "upsert",
          payload: new TextEncoder().encode(JSON.stringify({ name: binding.name })),
        })
      }
      const isolatedProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [
          { workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID },
          { workspaceId: SECOND_WORKSPACE_ID, cloudWorkspaceId: SECOND_CLOUD_WORKSPACE_ID },
        ],
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas", (body) => {
          const request = body as { deltas?: Array<{ workspaceId?: { value?: string } }> }
          return request.deltas?.[0]?.workspaceId?.value === CLOUD_WORKSPACE_ID
        })
        .replyWithError("first workspace unavailable")
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas", (body) => {
          const request = body as { deltas?: Array<{ workspaceId?: { value?: string } }> }
          return request.deltas?.[0]?.workspaceId?.value === SECOND_CLOUD_WORKSPACE_ID
        })
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 1, newRev: "1", rejectionReason: 0, conflictId: "" }],
        })

      await expect(isolatedProvider.push()).rejects.toThrow("first workspace unavailable")

      expect(store.get<{ retry_count: number }>(
        "SELECT retry_count FROM cloud_outbox WHERE workspace_id = ?",
        [WORKSPACE_ID],
      )).toEqual({ retry_count: 1 })
      expect(store.get(
        "SELECT 1 FROM cloud_outbox WHERE workspace_id = ?",
        [SECOND_WORKSPACE_ID],
      )).toBeUndefined()
      expect(repository.getWorkspaceBinding(WORKSPACE_ID)?.lastError).toBe("Can't reach the cloud right now. Sync will resume when you're back online.")
      expect(repository.getWorkspaceBinding(SECOND_WORKSPACE_ID)?.lastSyncedAt).not.toBeNull()
      expect(nock.isDone()).toBe(true)
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
            newRev: "4",
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
      expect(new CloudSyncRepository(store).getConflict("conflict-1")?.cloudRev).toBe(4)
      expect(new CloudSyncRepository(store).listPendingOutbox(100, Number.MAX_SAFE_INTEGER)).toEqual([])
    })

    it("does not send later queued mutations for a record after the first row conflicts", async () => {
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-conflict-chain",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "First" })),
      })
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-conflict-chain",
        workspace_id: WORKSPACE_ID,
        expected_rev: 1,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Second" })),
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .once()
        .reply(200, {
          outcomes: [{
            deltaIndex: 0,
            status: 2,
            newRev: "0",
            rejectionReason: 0,
            conflictId: "conflict-chain",
            winnerPayload: Buffer.from(JSON.stringify({ name: "Cloud", rev: 1 })).toString("base64"),
          }],
        })

      await provider.push()

      expect(new CloudSyncRepository(store).countOutbox()).toBe(2)
      expect(nock.isDone()).toBe(true)
    })

    it("records an empty cloud conflict winner as a tombstone at the authoritative revision", async () => {
      provider.enqueue({
        kind: "workflow",
        record_id: "workflow-cloud-deleted",
        workspace_id: WORKSPACE_ID,
        expected_rev: 2,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Local" })),
      })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .reply(200, {
          outcomes: [{
            deltaIndex: 0,
            status: 2,
            newRev: "5",
            rejectionReason: 0,
            conflictId: "conflict-cloud-deleted",
          }],
        })

      await provider.push()

      expect(new CloudSyncRepository(store).getConflict("conflict-cloud-deleted")).toMatchObject({
        cloudRev: 5,
        cloudOp: "tombstone",
      })
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
      expect(row?.failure_reason).toContain("couldn't apply a change")
      expect(row?.failure_reason).not.toContain("conflict-1")
      expect(repository.listPendingOutbox(100, Number.MAX_SAFE_INTEGER)).toEqual([])
      expect(repository.countDeadLetterOutbox()).toBe(1)
      expect(nock.isDone()).toBe(true)
    })

    it("dead-letters a rejected baseline immediately and completes first-sync state", async () => {
      const repository = new CloudSyncRepository(store)
      repository.upsertWorkspaceBinding({
        workspaceId: WORKSPACE_ID,
        cloudWorkspaceId: CLOUD_WORKSPACE_ID,
        cloudWorkspaceName: "Rejected Baseline",
        syncMode: "bi-directional",
        deviceId: "device-123",
        initializationState: "pushing",
      })
      const baselineId = repository.enqueueBaselineOutbox({
        kind: "workflow",
        record_id: "workflow-rejected-baseline",
        workspace_id: WORKSPACE_ID,
        expected_rev: 0,
        op: "upsert",
        payload: new TextEncoder().encode(JSON.stringify({ name: "Rejected Baseline" })),
      })
      const initializingProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [{ workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID }],
      })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PushDeltas")
        .reply(200, {
          outcomes: [{ deltaIndex: 0, status: 3, newRev: "0", rejectionReason: 4, conflictId: "" }],
        })

      await initializingProvider.push()

      expect(repository.getWorkspaceBinding(WORKSPACE_ID)).toMatchObject({
        initializationState: "initialized",
        lastError: expect.stringContaining("couldn't apply a change"),
      })
      expect(repository.countBaselineOutbox(WORKSPACE_ID)).toBe(0)
      expect(repository.countDeadLetterOutbox(WORKSPACE_ID)).toBe(1)
      expect(store.get<{ retry_count: number; failure_reason: string }>(
        "SELECT retry_count, failure_reason FROM cloud_outbox WHERE id = ?",
        [baselineId],
      )).toMatchObject({
        retry_count: CLOUD_OUTBOX_MAX_RETRIES,
        failure_reason: expect.stringContaining("couldn't apply a change"),
      })
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
              graph: { nodes: [{ config: { body: "" } }], edges: [] },
              variables: {},
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

    it("rejects nested workflow credentials from another authorized client", async () => {
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: false })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges")
        .reply(200, {
          changes: [{
            cursor: "201",
            workspaceId: { value: WORKSPACE_ID },
            kind: RecordKind.WORKFLOW,
            recordId: "workflow-forbidden",
            rev: "1",
            op: ChangeOp.UPSERT,
            payload: Buffer.from(JSON.stringify({
              name: "Forbidden",
              nodes: [{ config: { headers: [{ key: "Authorization", value: "Bearer nested-secret" }] } }],
              edges: [],
              variables: {},
            })).toString("base64"),
          }],
          nextCursor: "201",
          hasMore: false,
        })

      await expect(provider.pull()).rejects.toThrow("forbidden field")

      expect(store.get("SELECT 1 FROM workflows WHERE id = ?", ["workflow-forbidden"])).toBeUndefined()
    })
  })

  describe("environment references", () => {
    it("applies deleted and repointed cloud references while preserving local-only material", () => {
      store.set(
        "INSERT INTO environments (id, workspace_id, scopeId, name, slug, variables_json, settings_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          "environment-references",
          WORKSPACE_ID,
          WORKSPACE_ID,
          "Before Pull",
          "before-pull",
          "{}",
          JSON.stringify({
            secrets: {
              REPOINTED: { reference: `workspace:${WORKSPACE_ID}:OLD_NAME` },
              REMOVED: { reference: `workspace:${WORKSPACE_ID}:REMOVED` },
              LOCAL_ONLY: { sealed: "local-ciphertext-handle" },
            },
          }),
        ],
      )
      const repository = new CloudSyncRepository(store)

      repository.applyChange({
        cursor: 1n,
        workspaceId: WORKSPACE_ID,
        kind: RecordKind.ENVIRONMENT,
        recordId: "environment-references",
        rev: 2n,
        op: ChangeOp.UPSERT,
        payload: new TextEncoder().encode(JSON.stringify({
          name: "After Pull",
          variables: {},
          scopeType: "workspace",
          secrets: {
            REPOINTED: { reference: `workspace:${CLOUD_WORKSPACE_ID}:NEW_NAME` },
            LOCAL_ONLY: { reference: `workspace:${CLOUD_WORKSPACE_ID}:LOCAL_ONLY` },
          },
        })),
      })

      const settings = JSON.parse(store.get<{ settings_json: string }>(
        "SELECT settings_json FROM environments WHERE id = ?",
        ["environment-references"],
      )?.settings_json ?? "{}") as { secrets?: Record<string, unknown> }
      expect(settings.secrets).toEqual({
        REPOINTED: { reference: `workspace:${WORKSPACE_ID}:NEW_NAME` },
        LOCAL_ONLY: {
          sealed: "local-ciphertext-handle",
          reference: `workspace:${WORKSPACE_ID}:LOCAL_ONLY`,
        },
      })
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
      expect(repository.getCursor(WORKSPACE_ID)).toEqual({ cursor: 0n, lastRev: 0n })
      expect(repository.getFullSync(WORKSPACE_ID)).toBeTypeOf("number")
    })

    it("continues full resync for healthy workspaces after another workspace fails", async () => {
      store.set(
        "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
        [SECOND_WORKSPACE_ID, "Second Workspace", "second-workspace", "cloud", "bi-directional", "{}"],
      )
      const repository = new CloudSyncRepository(store)
      for (const binding of [
        { workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID, name: "Failing Workspace" },
        { workspaceId: SECOND_WORKSPACE_ID, cloudWorkspaceId: SECOND_CLOUD_WORKSPACE_ID, name: "Healthy Workspace" },
      ]) {
        repository.upsertWorkspaceBinding({
          workspaceId: binding.workspaceId,
          cloudWorkspaceId: binding.cloudWorkspaceId,
          cloudWorkspaceName: binding.name,
          syncMode: "bi-directional",
          deviceId: "device-123",
          initializationState: "initialized",
        })
        repository.setCursor(binding.cloudWorkspaceId, 99n, 12n)
      }
      const isolatedProvider = new CloudSyncProvider(client, tokenStore, store, {
        workspaceBindings: [
          { workspaceId: WORKSPACE_ID, cloudWorkspaceId: CLOUD_WORKSPACE_ID },
          { workspaceId: SECOND_WORKSPACE_ID, cloudWorkspaceId: SECOND_CLOUD_WORKSPACE_ID },
        ],
      })

      nock(API_BASE)
        .post("/apiweave.v1.SyncService/Hello")
        .reply(200, { protocolVersion: 1, fullResyncRequired: true })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges", (body) => {
          const request = body as { workspaceId?: { value?: string } }
          return request.workspaceId?.value === CLOUD_WORKSPACE_ID
        })
        .reply(503, { code: "UNAVAILABLE" })
      nock(API_BASE)
        .post("/apiweave.v1.SyncService/PullChanges", (body) => {
          const request = body as { workspaceId?: { value?: string } }
          return request.workspaceId?.value === SECOND_CLOUD_WORKSPACE_ID
        })
        .reply(200, { changes: [], nextCursor: "0", hasMore: false })

      await expect(isolatedProvider.pull()).rejects.toThrow("503")

      expect(repository.getCursor(CLOUD_WORKSPACE_ID)).toBeUndefined()
      expect(repository.getFullSync(CLOUD_WORKSPACE_ID)).toBeUndefined()
      expect(repository.getCursor(SECOND_CLOUD_WORKSPACE_ID)).toEqual({ cursor: 0n, lastRev: 0n })
      expect(repository.getFullSync(SECOND_CLOUD_WORKSPACE_ID)).toBeTypeOf("number")
      expect(repository.getWorkspaceBinding(WORKSPACE_ID)?.lastError).toBe("Something went wrong talking to the cloud. Sync will retry automatically.")
      expect(repository.getWorkspaceBinding(SECOND_WORKSPACE_ID)?.lastSyncedAt).not.toBeNull()
      expect(nock.isDone()).toBe(true)
    })
  })
})
