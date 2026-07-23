import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  RunRepository,
  SecretRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../index"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let runs: RunRepository
let environments: EnvironmentRepository
let collections: CollectionRepository
let secrets: SecretRepository

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
  environments = new EnvironmentRepository(db.kvStore)
  collections = new CollectionRepository(db.kvStore)
  secrets = new SecretRepository(db.kvStore)
})

afterEach(() => {
  db.close()
})

function seedWorkspace(): string {
  return workspaces.create({ name: "Local", slug: `local-${Math.floor(Math.random() * 1e9)}` }).workspaceId
}

describe("WorkspaceRepository", () => {
  it("enforces origin/syncMode defaults on create", () => {
    const workspace = workspaces.create({ name: "Personal", slug: "personal" })
    expect(workspace).toMatchObject({ origin: "local", syncMode: "none", isPersonal: true, rev: 1 })
    expect(workspace.workspaceId).toHaveLength(26)
    expect(workspace.createdAt).toEqual(expect.any(String))
  })

  it("round-trips by id and slug, and updates description", () => {
    const created = workspaces.create({ name: "Team", slug: "team", description: "hi" })
    expect(workspaces.getById(created.workspaceId)?.description).toBe("hi")
    expect(workspaces.getBySlug("team")?.workspaceId).toBe(created.workspaceId)

    const updated = workspaces.update(created.workspaceId, { description: "bye" })
    expect(updated?.description).toBe("bye")
    expect(updated?.rev).toBe(2)
  })

  it("returns undefined/false for unknown ids", () => {
    expect(workspaces.getById("nope")).toBeUndefined()
    expect(workspaces.update("nope", { name: "x" })).toBeUndefined()
    expect(workspaces.delete("nope")).toBe(false)
  })

  it("rolls back a repo write when its transaction throws", () => {
    expect(() =>
      db.kvStore.transaction(() => {
        workspaces.create({ name: "Doomed", slug: "doomed" })
        throw new Error("boom")
      }),
    ).toThrow("boom")
    expect(workspaces.getBySlug("doomed")).toBeUndefined()
  })
})

describe("SecretRepository", () => {
  // Regression: env-scoped secrets must bind workspace_id to the owning workspace,
  // not to scopeId (an environmentId), or the FK to workspaces() insert-fails.
  it("persists and deletes an environment-scoped secret against SQLite", () => {
    const workspaceId = seedWorkspace()
    const env = environments.create({ workspaceId, name: "Prod" })

    const meta = secrets.put({
      name: "TOKEN",
      scopeType: "environment",
      scopeId: env.environmentId,
      workspaceId,
      keyId: "k1",
      sealed: new TextEncoder().encode("sealed-bytes"),
    })
    expect(meta).toMatchObject({ name: "TOKEN", scopeType: "environment", scopeId: env.environmentId })

    expect(secrets.getByScopeAndName("environment", env.environmentId, "TOKEN")?.keyId).toBe("k1")
    expect(secrets.remove("environment", env.environmentId, "TOKEN")).toBe(true)
    expect(secrets.getByScopeAndName("environment", env.environmentId, "TOKEN")).toBeNull()
  })
})

describe("WorkflowRepository", () => {
  it("round-trips a workflow and bumps rev on each update (QA: rev-bump)", () => {
    const workspaceId = seedWorkspace()
    const created = workflows.create({
      workspaceId,
      name: "demo",
      nodes: [{ nodeId: "n1", type: "start", position: { x: 0, y: 0 } }],
      variables: { base: "https://api.test" },
      tags: ["smoke"],
    })
    expect(created.rev).toBe(1)
    expect(created.nodes).toHaveLength(1)
    expect(created.variables).toEqual({ base: "https://api.test" })
    expect(created.tags).toEqual(["smoke"])

    const byId = workflows.getById(created.workflowId)
    expect(byId?.rev).toBe(1)

    const renamed = workflows.update(created.workflowId, { name: "demo2" })
    expect(renamed?.name).toBe("demo2")
    expect(renamed?.rev).toBe(2)
    expect(renamed?.updatedAt).not.toBe(created.updatedAt)

    const described = workflows.update(created.workflowId, { description: "new" })
    expect(described?.rev).toBe(3)
    expect(described?.description).toBe("new")
  })

  it("filters collection-attached workflows from the default workspace listing", () => {
    const workspaceId = seedWorkspace()
    workflows.create({ workspaceId, name: "loose" })
    workflows.create({ workspaceId, name: "grouped", collectionId: "col-1" })

    const loose = workflows.listByWorkspace(workspaceId)
    expect(loose.total).toBe(1)
    expect(loose.items[0]?.name).toBe("loose")

    const everything = workflows.listByWorkspace(workspaceId, true)
    expect(everything.total).toBe(2)

    expect(workflows.listByCollection("col-1").total).toBe(1)
    expect(workflows.countByCollection("col-1")).toBe(1)
  })

  it("scopes getByIdInWorkspace and cascades when its workspace is deleted", () => {
    const workspaceId = seedWorkspace()
    const other = seedWorkspace()
    const workflow = workflows.create({ workspaceId, name: "scoped" })
    expect(workflows.getByIdInWorkspace(workflow.workflowId, workspaceId)).toBeDefined()
    expect(workflows.getByIdInWorkspace(workflow.workflowId, other)).toBeUndefined()

    workspaces.delete(workspaceId)
    expect(workflows.getById(workflow.workflowId)).toBeUndefined()
  })
})

describe("RunRepository", () => {
  function seedRun(): { workspaceId: string; workflowId: string; runId: string } {
    const workspaceId = seedWorkspace()
    const workflowId = workflows.create({ workspaceId, name: "wf" }).workflowId
    const runId = runs.create({ workspaceId, workflowId }).runId
    return { workspaceId, workflowId, runId }
  }

  it("stamps startedAt/completedAt/duration across a status lifecycle", () => {
    const { runId } = seedRun()
    expect(runs.getById(runId)?.status).toBe("pending")

    const running = runs.updateStatus(runId, "running")
    expect(running?.status).toBe("running")
    expect(running?.startedAt).toEqual(expect.any(String))
    expect(running?.completedAt).toBeNull()

    const done = runs.updateStatus(runId, "completed")
    expect(done?.completedAt).toEqual(expect.any(String))
    expect(done?.duration).toBeGreaterThanOrEqual(0)
  })

  it("spills a large node body to the side table and cascades on delete (QA: side-table-cascade)", () => {
    const { runId } = seedRun()
    const body = Buffer.alloc(2 * 1024 * 1024, "x")
    expect(runs.putNodeBody(runId, "http-1", body)).toBe("side")

    const count = db.kvStore.get<{ n: number }>("SELECT count(*) AS n FROM run_responses WHERE run_id = ?", [runId])
    expect(count?.n).toBe(1)

    const stored = db.kvStore.get<{ response_body_size: number }>(
      "SELECT response_body_size FROM runs WHERE id = ?",
      [runId],
    )
    expect(stored?.response_body_size).toBe(0)

    const fetched = runs.getNodeBody(runId, "http-1")
    expect(fetched?.length).toBe(body.length)
    expect(Buffer.isBuffer(fetched)).toBe(true)

    runs.delete(runId)
    const after = db.kvStore.get<{ n: number }>("SELECT count(*) AS n FROM run_responses WHERE run_id = ?", [runId])
    expect(after?.n).toBe(0)
  })

  it("keeps sub-threshold bodies inline (not in the side table)", () => {
    const { runId } = seedRun()
    const small = Buffer.alloc(50 * 1024, "y")
    expect(runs.putNodeBody(runId, "http-1", small)).toBe("inline")
    expect(runs.getNodeBody(runId, "http-1")).toBeUndefined()
  })

  it("lists by workflow and finds the latest failed run", () => {
    const { workflowId } = seedRun()
    const workspaceId = workflows.getById(workflowId)!.workspaceId
    const failed = runs.create({ workspaceId, workflowId })
    runs.updateStatus(failed.runId, "failed", "kaboom")

    expect(runs.listByWorkflow(workflowId, workspaceId).total).toBe(2)
    const latestFailed = runs.getLatestFailedRun(workflowId, workspaceId)
    expect(latestFailed?.runId).toBe(failed.runId)
    expect(latestFailed?.error).toBe("kaboom")
  })

  it("scopes run reads to the workspace, hiding another workspace's runs", () => {
    const { workflowId, workspaceId } = seedRun()
    const failed = runs.create({ workspaceId, workflowId })
    runs.updateStatus(failed.runId, "failed", "kaboom")
    const otherWorkspaceId = seedWorkspace()

    // Same workflowId, wrong workspace: a foreign caller sees nothing.
    expect(runs.listByWorkflow(workflowId, otherWorkspaceId).total).toBe(0)
    expect(runs.getLatestRun(workflowId, otherWorkspaceId)).toBeUndefined()
    expect(runs.getLatestFailedRun(workflowId, otherWorkspaceId)).toBeUndefined()
  })
})

describe("EnvironmentRepository", () => {
  it("normalizes swaggerDocUrl and manages variables", () => {
    const workspaceId = seedWorkspace()
    const env = environments.create({ workspaceId, name: "dev", swaggerDocUrl: "   " })
    expect(env.swaggerDocUrl).toBeNull()

    const withVar = environments.setVariable(env.environmentId, "host", "api.dev")
    expect(withVar?.variables).toEqual({ host: "api.dev" })
    expect(withVar?.rev).toBeGreaterThan(env.rev)

    const cleared = environments.deleteVariable(env.environmentId, "host")
    expect(cleared?.variables).toEqual({})
  })
})

describe("CollectionRepository", () => {
  it("tracks workflow counts and never goes negative", () => {
    const workspaceId = seedWorkspace()
    const collection = collections.create({ workspaceId, name: "suite" })
    expect(collection.workflowCount).toBe(0)
    expect(collection.continueOnFail).toBe(true)

    expect(collections.incrementWorkflowCount(collection.collectionId)?.workflowCount).toBe(1)
    expect(collections.decrementWorkflowCount(collection.collectionId)?.workflowCount).toBe(0)
    expect(collections.decrementWorkflowCount(collection.collectionId)?.workflowCount).toBe(0)
    expect(collections.setWorkflowCount(collection.collectionId, 5)?.workflowCount).toBe(5)
  })
})
