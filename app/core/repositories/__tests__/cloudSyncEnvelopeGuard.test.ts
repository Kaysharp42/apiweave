/**
 * The last guard before the local tables. The transport opens every envelope
 * before a change reaches the repository, so ciphertext arriving here means a
 * payload took a path that skipped it — and it must fail loudly rather than be
 * stored as an unreadable record.
 *
 * The rule is the server's own (`IsSealedEnvelope`): any top-level `e2ee` key,
 * not the narrower shape the server happens to accept on push today. A guard
 * for the payload that got past the transport cannot be the one that trusts the
 * transport's version number.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { CloudSyncRepository, ErrForbiddenCloudPayload } from "../index"
import { ChangeOp, RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"

const WORKSPACE_ID = "ws-cloud-envelope"

let db: InitializedDatabase

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  db.kvStore.set(
    "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
    [WORKSPACE_ID, "Cloud", "cloud-envelope", "cloud", "bi-directional", "{}"],
  )
})

afterEach(() => {
  db.close()
})

function upsert(payload: object, recordId = "workflow-sealed") {
  return {
    cursor: 1n,
    workspaceId: WORKSPACE_ID,
    kind: RecordKind.WORKFLOW,
    recordId,
    rev: 1n,
    op: ChangeOp.UPSERT,
    payload: new TextEncoder().encode(JSON.stringify(payload)),
  }
}

const SEALED = { kid: "a3f19c02b7d4e881", n: "AAAAAAAAAAAAAAAA", ct: "c2VhbGVk" }

describe("CloudSyncRepository sealed-envelope guard", () => {
  it("refuses the envelope version in use", () => {
    const repository = new CloudSyncRepository(db.kvStore)

    expect(() => repository.applyChange(upsert({ e2ee: 1, ...SEALED })))
      .toThrow(ErrForbiddenCloudPayload)
  })

  it("refuses an envelope claiming any other version", () => {
    const repository = new CloudSyncRepository(db.kvStore)

    expect(() => repository.applyChange(upsert({ e2ee: 2, ...SEALED })))
      .toThrow(ErrForbiddenCloudPayload)
    expect(() => repository.applyChange(upsert({ e2ee: "1", ...SEALED })))
      .toThrow(ErrForbiddenCloudPayload)
    expect(() => repository.applyChange(upsert({ e2ee: null, ...SEALED })))
      .toThrow(ErrForbiddenCloudPayload)
  })

  it("applies a plaintext record", () => {
    const repository = new CloudSyncRepository(db.kvStore)

    expect(repository.applyChange(
      upsert({ name: "Checkout", nodes: [], edges: [], variables: {} }, "workflow-plain"),
    )).toBe("applied")
  })
})
