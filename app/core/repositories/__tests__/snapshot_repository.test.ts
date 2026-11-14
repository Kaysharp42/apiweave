import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { SnapshotRepository } from "../index"

let db: InitializedDatabase
let snapshots: SnapshotRepository

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  snapshots = new SnapshotRepository(db.kvStore)
})

afterEach(() => {
  db.close()
})

describe("SnapshotRepository", () => {
  it("has no baseline until one is written", () => {
    expect(snapshots.read("wf-1", "node-1", 0)).toBeUndefined()
  })

  it("round-trips a value and replaces it in place", () => {
    snapshots.write("wf-1", "node-1", 0, { total: 900 }, "2026-01-01T00:00:00.000Z")
    expect(snapshots.read("wf-1", "node-1", 0)).toEqual({ value: { total: 900 }, updatedAt: "2026-01-01T00:00:00.000Z" })

    snapshots.write("wf-1", "node-1", 0, { total: 950 }, "2026-02-02T00:00:00.000Z")
    expect(snapshots.read("wf-1", "node-1", 0)).toMatchObject({ value: { total: 950 } })
  })

  it("keys a baseline by workflow, node and rule, so rules never collide", () => {
    snapshots.write("wf-1", "node-1", 0, "first", "2026-01-01T00:00:00.000Z")
    snapshots.write("wf-1", "node-1", 1, "second", "2026-01-01T00:00:00.000Z")
    snapshots.write("wf-1", "node-2", 0, "other node", "2026-01-01T00:00:00.000Z")
    snapshots.write("wf-2", "node-1", 0, "other workflow", "2026-01-01T00:00:00.000Z")
    expect(snapshots.read("wf-1", "node-1", 0)?.value).toBe("first")
    expect(snapshots.read("wf-1", "node-1", 1)?.value).toBe("second")
    expect(snapshots.read("wf-1", "node-2", 0)?.value).toBe("other node")
    expect(snapshots.read("wf-2", "node-1", 0)?.value).toBe("other workflow")
  })

  it("removes one baseline, and all of a workflow's", () => {
    snapshots.write("wf-1", "node-1", 0, "a", "2026-01-01T00:00:00.000Z")
    snapshots.write("wf-1", "node-1", 1, "b", "2026-01-01T00:00:00.000Z")
    snapshots.remove("wf-1", "node-1", 0)
    expect(snapshots.read("wf-1", "node-1", 0)).toBeUndefined()
    expect(snapshots.read("wf-1", "node-1", 1)?.value).toBe("b")
    snapshots.removeWorkflow("wf-1")
    expect(snapshots.read("wf-1", "node-1", 1)).toBeUndefined()
  })
})
