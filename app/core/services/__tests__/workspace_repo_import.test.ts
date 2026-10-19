import { afterEach, expect, it, vi } from "vitest"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import { initDatabase, type InitializedDatabase } from "../../db"
import { CollectionRepository, EnvironmentRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { workspaceSnapshot, type WorkspaceSnapshot } from "../workspace_repo_format"
import { WorkspaceRepoImporter } from "../workspace_repo_import"

interface Store {
  readonly db: InitializedDatabase
  readonly workspaces: WorkspaceRepository
  readonly collections: CollectionRepository
  readonly workflows: WorkflowRepository
  readonly environments: EnvironmentRepository
  readonly workspaceId: string
  readonly importer: WorkspaceRepoImporter
  readonly changes: Array<{ readonly kind: string; readonly workflowId?: string }>
}

const stores: Store[] = []

function openStore(): Store {
  const db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const changes: Array<{ readonly kind: string; readonly workflowId?: string }> = []
  const workflows = new WorkflowRepository(db.kvStore, (event) => changes.push({ kind: event.kind, workflowId: event.workflowId }))
  const environments = new EnvironmentRepository(db.kvStore)
  const workspaceId = workspaces.create({ name: "Workspace", slug: "workspace", description: "local description" }).workspaceId
  const store = {
    db,
    workspaces,
    collections,
    workflows,
    environments,
    workspaceId,
    importer: new WorkspaceRepoImporter(workspaces, collections, workflows, environments),
    changes,
  }
  stores.push(store)
  return store
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const store of stores.splice(0)) store.db.close()
})

function seedUserEnvironment(store: Store): void {
  store.db.kvStore.set(
    "INSERT INTO environments (id, workspace_id, scopeType, scopeId, name, slug, variables_json, settings_json) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)",
    ["env-user", store.workspaceId, "owner", "User env", "user-env", "{}", JSON.stringify({ description: null, swaggerDocUrl: null, baseEnvironmentId: null, secrets: {}, isDefault: true })],
  )
}

function seed(store: Store): void {
  const project = store.collections.create({
    collectionId: "proj-main",
    workspaceId: store.workspaceId,
    name: "Main",
    workflowOrder: [{ workflowId: "wf-stale", order: 0, enabled: false, continueOnFail: true }],
  })
  store.environments.create({ environmentId: "env-main", workspaceId: store.workspaceId, name: "Main env", isDefault: true, variables: { token: "local-env-token" } })
  store.workflows.create({
    workflowId: "wf-member",
    workspaceId: store.workspaceId,
    collectionId: project.collectionId,
    name: "Member",
    variables: { password: "local-password", apiKey: "local-api-key" },
    nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } } as WorkflowNode],
  })
  store.workflows.create({
    workflowId: "wf-free",
    workspaceId: store.workspaceId,
    name: "Free workflow",
    nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } } as WorkflowNode],
  })
}

function snapshotOf(store: Store): WorkspaceSnapshot {
  const environments = store.environments.listByWorkspace(store.workspaceId).items
  return workspaceSnapshot({
    workspace: store.workspaces.getById(store.workspaceId)!,
    projects: store.collections.listByWorkspace(store.workspaceId).items,
    workflows: store.workflows.listByWorkspace(store.workspaceId, true).items,
    environments,
  })
}

function withSnapshot(snapshot: WorkspaceSnapshot, edit: (draft: {
  workspace: WorkspaceSnapshot["workspace"]
  projects: Array<WorkspaceSnapshot["projects"][number]>
  workflows: Array<WorkspaceSnapshot["workflows"][number]>
  environments: Array<WorkspaceSnapshot["environments"][number]>
}) => void): WorkspaceSnapshot {
  const draft = {
    workspace: { ...snapshot.workspace },
    projects: snapshot.projects.map((project) => ({ ...project, workflowOrder: [...project.workflowOrder] })),
    workflows: snapshot.workflows.map((workflow) => ({ ...workflow, variables: { ...workflow.variables }, nodes: [...workflow.nodes] })),
    environments: snapshot.environments.map((environment) => ({ ...environment, variables: { ...environment.variables } })),
  }
  edit(draft)
  return draft
}

it("WorkspaceRepoImporter upserts by id, removes absent workspace records and preserves user environments", () => {
    const store = openStore()
    seed(store)
    const snapshot = snapshotOf(store)
    store.collections.create({ collectionId: "proj-extra", workspaceId: store.workspaceId, name: "Extra" })
    store.workflows.create({ workflowId: "wf-extra", workspaceId: store.workspaceId, name: "Extra" })
    store.environments.create({ environmentId: "env-extra", workspaceId: store.workspaceId, name: "Extra" })
    store.db.kvStore.set(
      "INSERT INTO environments (id, workspace_id, scopeType, scopeId, name, slug, variables_json, settings_json) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)",
      ["env-user", store.workspaceId, "owner", "User env", "user-env", "{}", JSON.stringify({ description: null, swaggerDocUrl: null, baseEnvironmentId: null, secrets: {}, isDefault: true })],
    )
    store.changes.length = 0

    store.importer.apply(store.workspaceId, snapshot)

    expect(store.collections.listByWorkspace(store.workspaceId).items.map((project) => project.collectionId)).toEqual(["proj-main"])
    expect(store.workflows.listByWorkspace(store.workspaceId, true).items.map((workflow) => workflow.workflowId).sort()).toEqual(["wf-free", "wf-member"])
    expect(store.environments.listByWorkspace(store.workspaceId).items.map((environment) => environment.environmentId).sort()).toEqual(["env-main", "env-user"])
    expect(store.changes).toEqual([{ kind: "delete", workflowId: "wf-extra" }])
})

it("WorkspaceRepoImporter keeps redacted literals, but replaces a genuinely changed value and returns the folder warning", () => {
    const store = openStore()
    seed(store)
    const snapshot = snapshotOf(store)
    const redacted = store.importer.apply(store.workspaceId, snapshot)
    expect(store.workflows.getById("wf-member")?.variables.password).toBe("local-password")
    expect(redacted).toEqual([])

    const changed = withSnapshot(snapshot, (draft) => {
      const workflow = draft.workflows.find((item) => item.workflowId === "wf-member")!
      ;(workflow.variables as Record<string, unknown>)["password"] = "changed-password"
      ;(workflow.variables as Record<string, unknown>)["unavailableCredential"] = "<SECRET>"
    })
    const warnings = store.importer.apply(store.workspaceId, changed)
    expect(store.workflows.getById("wf-member")?.variables.password).toBe("changed-password")
    expect(store.workflows.getById("wf-member")?.variables.apiKey).toBe("local-api-key")
    expect(warnings).toEqual([expect.stringContaining('Workflow \'Member\' has the placeholder "<SECRET>"')])
})

it("WorkspaceRepoImporter rolls back all writes and withholds workflow notifications when an import fails", () => {
    const store = openStore()
    seed(store)
    const snapshot = snapshotOf(store)
    const invalid = withSnapshot(snapshot, (draft) => {
      draft.workspace.name = "should roll back"
      const item = draft.workflows.find((workflow) => workflow.workflowId === "wf-member")!
      ;(item.nodes as unknown[])[0] = { nodeId: "bad", type: "not-a-node", position: { x: 0, y: 0 } }
    })
    store.changes.length = 0

    expect(() => store.importer.apply(store.workspaceId, invalid)).toThrow()
    expect(store.workspaces.getById(store.workspaceId)?.name).toBe("Workspace")
    expect(store.changes).toEqual([])
})

it("WorkspaceRepoImporter records git revisions only for changed workflows and leaves identical imports untouched", () => {
    const store = openStore()
    seed(store)
    const snapshot = snapshotOf(store)
    const changed = withSnapshot(snapshot, (draft) => { draft.workflows.find((workflow) => workflow.workflowId === "wf-member")!.name = "Changed" })

    store.importer.apply(store.workspaceId, changed)
    expect(store.workflows.revisions.list("wf-member").map((revision) => revision.source)).toEqual(["git"])
    expect(store.workflows.revisions.list("wf-free")).toEqual([])
    const notifications = [...store.changes]
    store.importer.apply(store.workspaceId, changed)
    expect(store.workflows.revisions.list("wf-member")).toHaveLength(1)
    expect(store.changes).toEqual(notifications)
})

it("WorkspaceRepoImporter makes an identical first import without revisions or workflow notifications", () => {
    const store = openStore()
    seed(store)
    const snapshot = snapshotOf(store)
    store.changes.length = 0

    store.importer.apply(store.workspaceId, snapshot)

    expect(store.workflows.revisions.list("wf-member")).toEqual([])
    expect(store.workflows.revisions.list("wf-free")).toEqual([])
    expect(store.changes).toEqual([])
})

it("WorkspaceRepoImporter resolves defaults deterministically and preserves project order and project-less workflows", () => {
    const store = openStore()
    seed(store)
    const snapshot = snapshotOf(store)
    const unusual = withSnapshot(snapshot, (draft) => {
      draft.projects[0] = { ...draft.projects[0]!, workflowOrder: [
        { workflowId: "wf-not-a-member", enabled: false, continueOnFail: true },
        { workflowId: "wf-member", enabled: true, continueOnFail: false },
        { workflowId: "wf-member", enabled: false, continueOnFail: true },
        { workflowId: "wf-does-not-exist", enabled: true, continueOnFail: false },
      ] }
      draft.environments.push({ ...draft.environments[0]!, environmentId: "env-second", name: "Second", isDefault: true })
      draft.environments[0] = { ...draft.environments[0]!, isDefault: true }
    })
    store.importer.apply(store.workspaceId, unusual)

    expect(store.environments.listByWorkspace(store.workspaceId).items.filter((environment) => environment.isDefault).map((environment) => environment.environmentId)).toEqual(["env-main"])
    expect(store.collections.getById("proj-main")?.workflowOrder).toEqual([
      { workflowId: "wf-not-a-member", order: 0, enabled: false, continueOnFail: true },
      { workflowId: "wf-member", order: 1, enabled: true, continueOnFail: false },
      { workflowId: "wf-member", order: 2, enabled: false, continueOnFail: true },
      { workflowId: "wf-does-not-exist", order: 3, enabled: true, continueOnFail: false },
    ])
    expect(store.workflows.getById("wf-free")?.collectionId).toBeNull()

    const oneClaim = withSnapshot(snapshotOf(store), (draft) => {
      draft.environments.forEach((environment) => { environment.isDefault = environment.environmentId === "env-second" })
    })
    store.importer.apply(store.workspaceId, oneClaim)
    expect(store.environments.listByWorkspace(store.workspaceId).items.filter((environment) => environment.isDefault).map((environment) => environment.environmentId)).toEqual(["env-second"])

    const noClaims = withSnapshot(snapshotOf(store), (draft) => { draft.environments.forEach((environment) => { environment.isDefault = false }) })
    store.importer.apply(store.workspaceId, noClaims)
    expect(store.environments.getById("env-second")?.isDefault).toBe(true)
})

it("WorkspaceRepoImporter repairs a missing workspace default without changing a user-scoped default", () => {
    const store = openStore()
    seed(store)
    store.environments.update("env-main", { isDefault: false })
    seedUserEnvironment(store)
    const snapshot = snapshotOf(store)

    const warnings = store.importer.apply(store.workspaceId, snapshot)

    expect(store.environments.getById("env-main")?.isDefault).toBe(true)
    expect(store.environments.getById("env-user")?.isDefault).toBe(true)
    expect(warnings).toEqual(["No default environment was set; 'env-main' is now the workspace default."])
})

it("WorkspaceRepoImporter detaches selections for deleted environments but preserves user-scoped selections", () => {
    const store = openStore()
    seed(store)
    store.environments.create({ environmentId: "env-removed", workspaceId: store.workspaceId, name: "Removed" })
    seedUserEnvironment(store)
    store.workflows.update("wf-member", { selectedEnvironmentId: "env-removed" })
    store.workflows.update("wf-free", { selectedEnvironmentId: "env-user" })
    const snapshot = withSnapshot(snapshotOf(store), (draft) => {
      draft.environments = draft.environments.filter((environment) => environment.environmentId !== "env-removed")
    })

    store.importer.apply(store.workspaceId, snapshot)

    expect(store.workflows.getById("wf-member")?.selectedEnvironmentId).toBeNull()
    expect(store.workflows.getById("wf-free")?.selectedEnvironmentId).toBe("env-user")
    expect(store.environments.getById("env-removed")).toBeUndefined()
})

it("WorkspaceRepoImporter refuses workflows attached to a project absent from the snapshot before writing", () => {
    const store = openStore()
    seed(store)
    const snapshot = withSnapshot(snapshotOf(store), (draft) => {
      draft.workspace.name = "must not write"
      const workflow = draft.workflows.find((item) => item.workflowId === "wf-free")!
      ;(workflow as { projectId: string | null }).projectId = "proj-ghost"
    })

    expect(() => store.importer.apply(store.workspaceId, snapshot)).toThrow(/workflow wf-free names project proj-ghost.*missing from the snapshot/)
    expect(store.workspaces.getById(store.workspaceId)?.name).toBe("Workspace")
})

it("WorkspaceRepoImporter rolls back a deletion-stage failure and discards queued notifications", () => {
    const store = openStore()
    seed(store)
    const snapshot = snapshotOf(store)
    store.collections.create({ collectionId: "proj-extra", workspaceId: store.workspaceId, name: "Extra" })
    store.workflows.create({ workflowId: "wf-extra", workspaceId: store.workspaceId, name: "Extra" })
    store.changes.length = 0
    vi.spyOn(store.collections, "delete").mockImplementation(() => { throw new Error("late delete failure") })

    expect(() => store.importer.apply(store.workspaceId, snapshot)).toThrow("late delete failure")
    expect(store.workflows.getById("wf-extra")).toBeDefined()
    expect(store.collections.getById("proj-extra")).toBeDefined()
    expect(store.changes).toEqual([])
})

it("WorkspaceRepoImporter refuses a snapshot whose workspace id differs from the target", () => {
    const store = openStore()
    seed(store)
    const snapshot = withSnapshot(snapshotOf(store), (draft) => { draft.workspace.workspaceId = "another-workspace" })
    expect(() => store.importer.apply(store.workspaceId, snapshot)).toThrow(/does not match target workspace/)
})
