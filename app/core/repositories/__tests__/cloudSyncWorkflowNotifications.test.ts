/**
 * The open-canvas broadcast for workflow rows that cloud sync writes with raw
 * SQL. `WorkflowRepository` never sees these, so the notification and its
 * transaction discipline live in `CloudSyncRepository` — and both have to
 * survive the places that re-wrap the repository around a transaction handle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { CloudSyncRepository } from "../index"
import { ChangeOp, RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"

const WORKSPACE_ID = "ws-cloud-notify"
const WORKFLOW_ID = "workflow-notify-1"

let db: InitializedDatabase
let observed: Array<{ workspaceId: string; workflowId: string; deleted: boolean }>
let observer: (workspaceId: string, workflowId: string, deleted: boolean) => void

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  db.kvStore.set(
    "INSERT INTO workspaces (id, name, slug, origin, syncMode, settings_json) VALUES (?, ?, ?, ?, ?, ?)",
    [WORKSPACE_ID, "Cloud", "cloud-notify", "cloud", "bi-directional", "{}"],
  )
  observed = []
  observer = (workspaceId, workflowId, deleted) => {
    observed.push({ workspaceId, workflowId, deleted })
  }
})

afterEach(() => {
  db.close()
})

function workflowUpsert(rev: bigint, name = "Pulled") {
  return {
    cursor: rev,
    workspaceId: WORKSPACE_ID,
    kind: RecordKind.WORKFLOW,
    recordId: WORKFLOW_ID,
    rev,
    op: ChangeOp.UPSERT,
    payload: new TextEncoder().encode(
      JSON.stringify({ name, nodes: [], edges: [], variables: {} }),
    ),
  }
}

describe("CloudSyncRepository workflow notifications", () => {
  it("reports a pulled upsert to the observer", () => {
    const repository = new CloudSyncRepository(db.kvStore, observer)

    repository.applyChange(workflowUpsert(4n))

    expect(observed).toEqual([
      { workspaceId: WORKSPACE_ID, workflowId: WORKFLOW_ID, deleted: false },
    ])
  })

  it("holds a pulled upsert until the surrounding transaction commits", () => {
    const repository = new CloudSyncRepository(db.kvStore, observer)

    repository.transaction((tx) => {
      tx.applyChange(workflowUpsert(4n))
      // The renderer hydrates and marks the tab clean on this snapshot; a later
      // statement in the same transaction can still roll the row back.
      expect(observed).toEqual([])
    })

    expect(observed).toHaveLength(1)
  })

  it("discards a pulled upsert whose transaction rolls back", () => {
    const repository = new CloudSyncRepository(db.kvStore, observer)

    expect(() =>
      repository.transaction((tx) => {
        tx.applyChange(workflowUpsert(4n))
        // Stands in for the `setCursor` / `upsertRecordState` that follow an
        // apply inside the same pull transaction.
        throw new Error("cursor write failed")
      }),
    ).toThrow("cursor write failed")

    expect(observed).toEqual([])
    expect(db.kvStore.get("SELECT id FROM workflows WHERE id = ?", [WORKFLOW_ID])).toBeUndefined()
  })

  it("reports a pulled tombstone as a deletion", () => {
    const repository = new CloudSyncRepository(db.kvStore, observer)
    repository.applyChange(workflowUpsert(4n))
    observed = []

    repository.applyChange({
      cursor: 5n,
      workspaceId: WORKSPACE_ID,
      kind: RecordKind.WORKFLOW,
      recordId: WORKFLOW_ID,
      rev: 5n,
      op: ChangeOp.TOMBSTONE,
      payload: new Uint8Array(),
      deletedAt: new Date().toISOString(),
    })

    expect(observed).toEqual([
      { workspaceId: WORKSPACE_ID, workflowId: WORKFLOW_ID, deleted: true },
    ])
  })

  it("keeps the observer when resolveConflict re-wraps the repository", () => {
    const repository = new CloudSyncRepository(db.kvStore, observer)
    insertWorkflowConflict("conflict-resolve-1")

    repository.resolveConflict("conflict-resolve-1", "cloud")

    // Conflict resolution is the only path that writes the winning graph, and
    // it runs on a repository built around the transaction handle.
    expect(observed).toEqual([
      { workspaceId: WORKSPACE_ID, workflowId: WORKFLOW_ID, deleted: false },
    ])
    expect(
      db.kvStore.get<{ name: string }>("SELECT name FROM workflows WHERE id = ?", [WORKFLOW_ID])?.name,
    ).toBe("Cloud Workflow")
  })

  it("keeps the observer when resolveConflictMerged re-wraps the repository", () => {
    const repository = new CloudSyncRepository(db.kvStore, observer)
    insertWorkflowConflict("conflict-merged-1")

    repository.resolveConflictMerged(
      "conflict-merged-1",
      12,
      new TextEncoder().encode(
        JSON.stringify({ name: "Merged Workflow", nodes: [], edges: [], variables: {} }),
      ),
    )

    expect(observed).toEqual([
      { workspaceId: WORKSPACE_ID, workflowId: WORKFLOW_ID, deleted: false },
    ])
  })

  it("keeps the observer when reconcileRemoteResolvedConflict re-wraps the repository", () => {
    const repository = new CloudSyncRepository(db.kvStore, observer)
    insertWorkflowConflict("conflict-remote-1")

    repository.reconcileRemoteResolvedConflict(
      "conflict-remote-1",
      new TextEncoder().encode(
        JSON.stringify({ name: "Local Workflow", nodes: [], edges: [], variables: {} }),
      ),
    )

    expect(observed.map((entry) => entry.workflowId)).toContain(WORKFLOW_ID)
  })

  it("survives an observer that throws, without failing the write", () => {
    const throwing = vi.fn(() => {
      throw new Error("webContents destroyed")
    })
    const repository = new CloudSyncRepository(db.kvStore, throwing)

    expect(() => repository.applyChange(workflowUpsert(4n))).not.toThrow()
    expect(throwing).toHaveBeenCalledOnce()
    expect(db.kvStore.get("SELECT id FROM workflows WHERE id = ?", [WORKFLOW_ID])).toBeDefined()
  })
})

function insertWorkflowConflict(conflictId: string): void {
  const local = { name: "Local Workflow", nodes: [], edges: [], variables: {} }
  const cloud = { name: "Cloud Workflow", nodes: [], edges: [], variables: {} }
  db.kvStore.set(
    `INSERT INTO cloud_conflicts (
      conflict_id, server_conflict_id, workspace_id, kind, record_id, base_rev,
      local_payload, cloud_payload, local_rev, cloud_rev, local_op, cloud_op,
      winner, status, createdAt, resolvedAt, merge_residual_paths
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conflictId,
      conflictId,
      WORKSPACE_ID,
      "workflow",
      WORKFLOW_ID,
      5,
      Buffer.from(JSON.stringify(local)),
      Buffer.from(JSON.stringify(cloud)),
      7,
      9,
      "upsert",
      "upsert",
      null,
      "pending",
      new Date().toISOString(),
      null,
      JSON.stringify([]),
    ],
  )
}
