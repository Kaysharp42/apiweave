import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { RunArtifactRepository, RunRepository, WorkflowRepository, WorkspaceRepository } from "../index"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let runs: RunRepository
let artifacts: RunArtifactRepository

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const SECOND_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20])
let seedCounter = 0

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
  artifacts = new RunArtifactRepository(db.kvStore)
})

afterEach(() => db.close())

function seedRun(): { workspaceId: string; runId: string } {
  seedCounter += 1
  const workspaceId = workspaces.create({ name: `Local ${seedCounter}`, slug: `local-${seedCounter}` }).workspaceId
  const workflowId = workflows.create({ workspaceId, name: "wf" }).workflowId
  return { workspaceId, runId: runs.create({ workspaceId, workflowId }).runId }
}

function save(runId: string, nodeId = "browser-1", body = JPEG): string {
  return artifacts.save({ runId, nodeId, kind: "screenshot", mime: "image/jpeg", body })
}

describe("RunArtifactRepository", () => {
  it("stores a screenshot and reads its bytes back by id", () => {
    const { runId } = seedRun()
    const artifactId = save(runId)

    expect(artifacts.get(artifactId)).toEqual({ runId, mime: "image/jpeg", body: JPEG })
    const listed = artifacts.listForRun(runId)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ artifactId, nodeId: "browser-1", kind: "screenshot", mime: "image/jpeg", size: JPEG.length })
    expect(listed[0]?.createdAt).toEqual(expect.any(String))
  })

  it("reports the run that owns an artifact, so every artifact stays in one workspace", () => {
    const first = seedRun()
    const second = seedRun()
    const firstArtifact = save(first.runId)
    const secondArtifact = save(second.runId)

    expect(artifacts.get(firstArtifact)?.runId).toBe(first.runId)
    expect(artifacts.get(secondArtifact)?.runId).toBe(second.runId)
    expect(artifacts.listForRun(second.runId).map((item) => item.artifactId)).toEqual([secondArtifact])
  })

  it("lists a run's artifacts in the order they were stored, without bodies", () => {
    const { runId } = seedRun()
    const first = save(runId, "browser-1", JPEG)
    const second = save(runId, "browser-2", SECOND_JPEG)

    const listed = artifacts.listForRun(runId)
    expect(listed.map((item) => item.artifactId)).toEqual([first, second])
    expect(listed.map((item) => item.nodeId)).toEqual(["browser-1", "browser-2"])
    expect(listed.map((item) => item.size)).toEqual([JPEG.length, SECOND_JPEG.length])
    expect(Object.keys(listed[0] ?? {})).not.toContain("body")
  })

  it("deletes a run's artifacts with the run, through the repository delete path", () => {
    const { workspaceId, runId } = seedRun()
    save(runId)
    runs.updateStatus(runId, "failed")

    expect(runs.delete(runId, workspaceId)).toBe(true)
    expect(artifacts.listForRun(runId)).toEqual([])
    expect(db.kvStore.get("SELECT count(*) AS n FROM run_artifacts", [])).toEqual({ n: 0 })
  })

  it("drops a run's artifacts where its node results are cleared (load mode)", () => {
    const { runId } = seedRun()
    save(runId)

    runs.clearNodeResults(runId)
    expect(artifacts.listForRun(runId)).toEqual([])
  })
})
