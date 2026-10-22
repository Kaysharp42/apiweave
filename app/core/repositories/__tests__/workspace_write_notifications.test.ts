import { afterEach, describe, expect, it } from "vitest"
import type { WorkflowChangedEvent } from "@shared/types/WorkflowChangedEvent"
import { initDatabase, type InitializedDatabase } from "../../db"
import { CollectionRepository, EnvironmentRepository, WorkflowRepository, WorkspaceRepository } from "../index"

interface Store {
  readonly db: InitializedDatabase
  readonly workspaces: WorkspaceRepository
  readonly collections: CollectionRepository
  readonly environments: EnvironmentRepository
  readonly workflows: WorkflowRepository
  /** Every workspace id an observer heard, in order. */
  readonly heard: string[]
  readonly workflowEvents: WorkflowChangedEvent[]
}

const opened: InitializedDatabase[] = []

function openStore(): Store {
  const db = initDatabase({ databasePath: ":memory:" })
  opened.push(db)
  const heard: string[] = []
  const workflowEvents: WorkflowChangedEvent[] = []
  const note = (workspaceId: string): void => {
    heard.push(workspaceId)
  }
  return {
    db,
    workspaces: new WorkspaceRepository(db.kvStore, note),
    collections: new CollectionRepository(db.kvStore, note),
    environments: new EnvironmentRepository(db.kvStore, note),
    workflows: new WorkflowRepository(db.kvStore, (event) => workflowEvents.push(event)),
    heard,
    workflowEvents,
  }
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close()
})

describe("workspace write notifications", () => {
  it("announce every successful write once, naming the workspace, and nothing that changed no row", () => {
    const store = openStore()
    const ws = store.workspaces.create({ name: "A", slug: "a" }).workspaceId
    store.workspaces.update(ws, { name: "A2" })
    const project = store.collections.create({ workspaceId: ws, name: "P" }).collectionId
    store.collections.update(project, { name: "P2" })
    store.collections.incrementWorkflowCount(project)
    const environment = store.environments.create({ workspaceId: ws, name: "E" }).environmentId
    store.environments.setVariable(environment, "k", "v")
    store.collections.delete(project)
    store.environments.delete(environment)
    expect(store.heard).toEqual(Array.from({ length: 9 }, () => ws))

    store.heard.length = 0
    expect(store.collections.update("missing", { name: "x" })).toBeUndefined()
    expect(store.collections.delete("missing")).toBe(false)
    expect(store.environments.update("missing", { name: "x" })).toBeUndefined()
    expect(store.environments.delete("missing")).toBe(false)
    expect(store.workspaces.delete("missing")).toBe(false)
    expect(store.heard).toEqual([])
  })

  it("announce both workspaces of a move", () => {
    const store = openStore()
    const from = store.workspaces.create({ name: "From", slug: "from" }).workspaceId
    const to = store.workspaces.create({ name: "To", slug: "to" }).workspaceId
    const project = store.collections.create({ workspaceId: from, name: "P" }).collectionId
    const environment = store.environments.create({ workspaceId: from, name: "E" }).environmentId
    const workflow = store.workflows.create({ workspaceId: from, name: "W" }).workflowId
    store.heard.length = 0
    store.workflowEvents.length = 0

    store.collections.setWorkspace(project, to)
    store.environments.setWorkspace(environment, to)
    store.workflows.setWorkspace(workflow, to)

    expect(store.heard).toEqual([from, to, from, to])
    expect(store.workflowEvents).toEqual([
      { kind: "upsert", workflow: expect.objectContaining({ workflowId: workflow, workspaceId: to }), movedFrom: from },
    ])
  })

  it("hold announcements until the outermost commit, and drop them with a rollback", () => {
    const store = openStore()
    const ws = store.workspaces.create({ name: "A", slug: "a" }).workspaceId
    store.heard.length = 0

    store.workspaces.transaction(() => {
      store.collections.create({ workspaceId: ws, name: "P" })
      store.environments.transaction(() => store.environments.create({ workspaceId: ws, name: "E" }))
      expect(store.heard).toEqual([])
    })
    expect(store.heard).toEqual([ws, ws])

    store.heard.length = 0
    expect(() =>
      store.collections.transaction(() => {
        store.environments.create({ workspaceId: ws, name: "Rolled back" })
        store.workspaces.update(ws, { name: "Rolled back" })
        throw new Error("rollback")
      }),
    ).toThrow("rollback")
    expect(store.heard).toEqual([])
    expect(store.environments.listByWorkspace(ws).items.map((environment) => environment.name)).toEqual(["E"])
  })

  it("announce a deleted workspace after the row is gone", () => {
    const store = openStore()
    const ws = store.workspaces.create({ name: "A", slug: "a" }).workspaceId
    store.heard.length = 0
    let existedWhenHeard: boolean | undefined
    const workspaces = new WorkspaceRepository(store.db.kvStore, (workspaceId) => {
      existedWhenHeard = workspaces.getById(workspaceId) !== undefined
    })
    expect(workspaces.delete(ws)).toBe(true)
    expect(existedWhenHeard).toBe(false)
  })
})
