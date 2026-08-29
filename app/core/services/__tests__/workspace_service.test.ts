import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import type { WorkflowChangedEvent } from "@shared/types/WorkflowChangedEvent"
import { WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../scope_resolver"
import { WorkspaceService } from "../workspace_service"

let db: InitializedDatabase
let svc: WorkspaceService
let workflows: WorkflowRepository
/** Everything the workflow repository announced — see the delete-cascade suite. */
let changes: WorkflowChangedEvent[]

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  changes = []
  workflows = new WorkflowRepository(db.kvStore, (event) => changes.push(event))
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: () => false,
  }
  svc = new WorkspaceService(workspaces, workflows, new LocalOnlySyncProvider(), new ScopeResolver(existence))
})

afterEach(() => db.close())

describe("WorkspaceService — personal workspace idempotency guard", () => {
  it("returns the existing personal workspace instead of creating a dupe", async () => {
    const first = await svc.create({ name: "Personal", slug: "personal", isPersonal: true })
    const second = await svc.create({ name: "Personal", slug: "personal", isPersonal: true })

    expect(second.workspaceId).toBe(first.workspaceId)
    expect(second.slug).toBe("personal")
    const all = await svc.list()
    expect(all.filter((ws) => ws.isPersonal)).toHaveLength(1)
  })

  it("still creates a non-personal workspace when isPersonal is false", async () => {
    const personal = await svc.create({ name: "Personal", slug: "personal", isPersonal: true })
    const team = await svc.create({ name: "Team", slug: "team", isPersonal: false })

    expect(team.workspaceId).not.toBe(personal.workspaceId)
    const all = await svc.list()
    expect(all).toHaveLength(2)
  })

  it("treats omitted isPersonal as personal (default) and dedupes", async () => {
    const first = await svc.create({ name: "Personal" })
    const second = await svc.create({ name: "Personal" })

    expect(second.workspaceId).toBe(first.workspaceId)
  })
})

describe("WorkspaceService — personal workspace invariant on update", () => {
  it("rejects promoting a second workspace to personal", async () => {
    await svc.create({ name: "Personal", slug: "personal", isPersonal: true })
    const team = await svc.create({ name: "Team", slug: "team", isPersonal: false })

    await expect(svc.update(team.workspaceId, { isPersonal: true })).rejects.toThrow(
      "another workspace is already the personal workspace",
    )
  })

  it("rejects unsetting the only personal workspace", async () => {
    const personal = await svc.create({ name: "Personal", slug: "personal", isPersonal: true })

    await expect(svc.update(personal.workspaceId, { isPersonal: false })).rejects.toThrow(
      "cannot unset the only personal workspace",
    )
  })

  it("allows a no-op update that keeps the same workspace personal", async () => {
    const personal = await svc.create({ name: "Personal", slug: "personal", isPersonal: true })

    const updated = await svc.update(personal.workspaceId, { isPersonal: true })

    expect(updated.isPersonal).toBe(true)
  })
})

describe("WorkspaceService — provision hook", () => {
  let hookDb: InitializedDatabase
  let onCreated: ReturnType<typeof vi.fn>
  let hookedSvc: WorkspaceService

  beforeEach(() => {
    hookDb = initDatabase({ databasePath: ":memory:" })
    const workspaces = new WorkspaceRepository(hookDb.kvStore)
    const existence: ScopeExistence = {
      workspaceExists: (id) => workspaces.getById(id) !== undefined,
      environmentExists: () => false,
    }
    onCreated = vi.fn()
    hookedSvc = new WorkspaceService(
      workspaces,
      new WorkflowRepository(hookDb.kvStore),
      new LocalOnlySyncProvider(),
      new ScopeResolver(existence),
      onCreated,
    )
  })

  afterEach(() => hookDb.close())

  it("fires the hook after creating a new workspace (cloud can provision it)", async () => {
    await hookedSvc.create({ name: "Team", slug: "team", isPersonal: false })
    expect(onCreated).toHaveBeenCalledOnce()
  })

  it("does not fire the hook when a personal create is a dedupe no-op", async () => {
    await hookedSvc.create({ name: "Personal", slug: "personal", isPersonal: true })
    onCreated.mockClear()
    await hookedSvc.create({ name: "Personal", slug: "personal", isPersonal: true })
    expect(onCreated).not.toHaveBeenCalled()
  })
})

describe("WorkspaceService — deleting a workspace announces the workflows it takes", () => {
  it("emits a delete event per workflow, attached ones included", async () => {
    const ws = await svc.create({ name: "Team", slug: "team", isPersonal: false })
    const loose = workflows.create({ workspaceId: ws.workspaceId, name: "Loose" })
    const attached = workflows.create({
      workspaceId: ws.workspaceId,
      name: "In a project",
      collectionId: "col-1",
    })
    changes.length = 0

    await svc.delete(ws.workspaceId)

    // Without this the FK cascade removes both rows silently and an open canvas
    // keeps autosaving into a workspace that is gone.
    // Order is the repository's listing order, which no consumer depends on.
    expect(changes).toEqual(
      expect.arrayContaining([
        { kind: "delete", workspaceId: ws.workspaceId, workflowId: loose.workflowId },
        { kind: "delete", workspaceId: ws.workspaceId, workflowId: attached.workflowId },
      ]),
    )
    expect(changes).toHaveLength(2)
    expect(workflows.listByWorkspace(ws.workspaceId, true).items).toEqual([])
  })

  it("leaves another workspace's workflows alone", async () => {
    const doomed = await svc.create({ name: "Doomed", slug: "doomed", isPersonal: false })
    const keeper = await svc.create({ name: "Keeper", slug: "keeper", isPersonal: false })
    workflows.create({ workspaceId: doomed.workspaceId, name: "Goes" })
    const survivor = workflows.create({ workspaceId: keeper.workspaceId, name: "Stays" })
    changes.length = 0

    await svc.delete(doomed.workspaceId)

    expect(changes.map((event) => event.workspaceId)).toEqual([doomed.workspaceId])
    expect(workflows.getById(survivor.workflowId)).toBeDefined()
  })
})
