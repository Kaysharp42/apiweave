import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../scope_resolver"
import { CollectionService } from "../collection_service"
import { WorkflowService } from "../workflow_service"
import type { WorkflowNode } from "@shared/types/WorkflowNode"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let environments: EnvironmentRepository
let collections: CollectionRepository
let workflowService: WorkflowService
let collectionService: CollectionService

const permissions = new LocalOwnerProvider()
const sync = new LocalOnlySyncProvider()

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  environments = new EnvironmentRepository(db.kvStore)
  collections = new CollectionRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  const scopeResolver = new ScopeResolver(existence)
  workflowService = new WorkflowService(
    workflows,
    sync,
    permissions,
    scopeResolver,
    collections,
    environments,
  )
  collectionService = new CollectionService(
    collections,
    workflows,
    sync,
    permissions,
    scopeResolver,
  )
})

afterEach(() => db.close())

function seedWorkspace(slug: string): string {
  return workspaces.create({ name: slug, slug }).workspaceId
}

/** A minimal runnable graph, plus a Call Workflow node when a target is given. */
function graph(targetWorkflowId?: string): WorkflowNode[] {
  const nodes: WorkflowNode[] = [
    { nodeId: "start-1", type: "start", position: { x: 0, y: 0 } },
  ]
  if (targetWorkflowId !== undefined) {
    nodes.push({
      nodeId: "call-1",
      type: "workflow",
      position: { x: 100, y: 0 },
      config: { targetWorkflowId, targetWorkflowName: "Callee" },
    })
  }
  return nodes
}

function callTargetOf(nodes: readonly WorkflowNode[]): string | null | undefined {
  const call = nodes.find((node) => node.nodeId === "call-1")
  return call?.type === "workflow" ? call.config?.targetWorkflowId : undefined
}

describe("WorkflowService.moveToWorkspace", () => {
  it("moves the workflow and clears the references that cannot follow", async () => {
    const source = seedWorkspace("source")
    const target = seedWorkspace("target")
    const env = environments.create({ workspaceId: source, name: "Staging" })
    const project = collections.create({ workspaceId: source, name: "Checkout" })
    const callee = workflows.create({ workspaceId: source, name: "Callee" })
    const workflow = workflows.create({
      workspaceId: source,
      name: "Mover",
      collectionId: project.collectionId,
      selectedEnvironmentId: env.environmentId,
      nodes: graph(callee.workflowId),
    })

    const moved = await workflowService.moveToWorkspace(
      source,
      workflow.workflowId,
      target,
      null,
    )

    expect(moved.workspaceId).toBe(target)
    expect(moved.collectionId).toBeNull()
    expect(moved.selectedEnvironmentId).toBeNull()
    // The callee stayed behind, so the target it pointed at is gone.
    expect(callTargetOf(moved.nodes)).toBeNull()

    // Existence-hiding both ways: gone from the source, present in the target.
    expect(workflows.getByIdInWorkspace(workflow.workflowId, source)).toBeUndefined()
    expect(workflows.getByIdInWorkspace(workflow.workflowId, target)).toBeDefined()
    expect(workflows.listByWorkspace(source).items.map((w) => w.workflowId)).not.toContain(
      workflow.workflowId,
    )
  })

  it("leaves the moved workflow saveable — the reason the references are cleared", async () => {
    const source = seedWorkspace("source")
    const target = seedWorkspace("target")
    const callee = workflows.create({ workspaceId: source, name: "Callee" })
    const workflow = workflows.create({
      workspaceId: source,
      name: "Mover",
      nodes: graph(callee.workflowId),
    })

    const moved = await workflowService.moveToWorkspace(
      source,
      workflow.workflowId,
      target,
      null,
    )

    // Before the fix this threw `target workflow ... not found` — the move
    // succeeded and the user's next ordinary edit was the thing that broke.
    await expect(
      workflowService.update(target, workflow.workflowId, { nodes: moved.nodes }),
    ).resolves.toMatchObject({ workflowId: workflow.workflowId })
  })

  it("attaches the workflow to a project in the destination when one is named", async () => {
    const source = seedWorkspace("source")
    const target = seedWorkspace("target")
    const destinationProject = collections.create({ workspaceId: target, name: "Arrivals" })
    const workflow = workflows.create({ workspaceId: source, name: "Mover" })

    const moved = await workflowService.moveToWorkspace(
      source,
      workflow.workflowId,
      target,
      destinationProject.collectionId,
    )

    expect(moved.collectionId).toBe(destinationProject.collectionId)
    expect(
      workflows.listByCollection(target, destinationProject.collectionId).items,
    ).toHaveLength(1)
  })

  it("rejects a destination project that belongs to another workspace", async () => {
    const source = seedWorkspace("source")
    const target = seedWorkspace("target")
    const elsewhere = collections.create({ workspaceId: source, name: "Stay put" })
    const workflow = workflows.create({ workspaceId: source, name: "Mover" })

    await expect(
      workflowService.moveToWorkspace(
        source,
        workflow.workflowId,
        target,
        elsewhere.collectionId,
      ),
    ).rejects.toThrow(/not found/)

    // The rejection must leave the workflow where it was.
    expect(workflows.getById(workflow.workflowId)?.workspaceId).toBe(source)
  })

  it("rejects a move into the workspace the workflow is already in", async () => {
    const source = seedWorkspace("source")
    const workflow = workflows.create({ workspaceId: source, name: "Mover" })

    await expect(
      workflowService.moveToWorkspace(source, workflow.workflowId, source, null),
    ).rejects.toThrow(/already in this workspace/)
  })

  it("reports an unknown destination workspace as not_found", async () => {
    const source = seedWorkspace("source")
    const workflow = workflows.create({ workspaceId: source, name: "Mover" })

    await expect(
      workflowService.moveToWorkspace(source, workflow.workflowId, "ws-nope", null),
    ).rejects.toThrow(/workspace ws-nope not found/)
  })

  it("reports a workflow outside the source workspace as not_found", async () => {
    const source = seedWorkspace("source")
    const other = seedWorkspace("other")
    const target = seedWorkspace("target")
    const workflow = workflows.create({ workspaceId: other, name: "Not yours" })

    await expect(
      workflowService.moveToWorkspace(source, workflow.workflowId, target, null),
    ).rejects.toThrow(/not found/)
  })
})

describe("CollectionService.moveToWorkspace", () => {
  it("carries the project's workflows across and clears their environments", async () => {
    const source = seedWorkspace("source")
    const target = seedWorkspace("target")
    const env = environments.create({ workspaceId: source, name: "Staging" })
    const project = collections.create({ workspaceId: source, name: "Checkout" })
    const first = workflows.create({
      workspaceId: source,
      name: "First",
      collectionId: project.collectionId,
      selectedEnvironmentId: env.environmentId,
    })
    const second = workflows.create({
      workspaceId: source,
      name: "Second",
      collectionId: project.collectionId,
    })

    const moved = await collectionService.moveToWorkspace(
      source,
      project.collectionId,
      target,
    )

    expect(moved.workspaceId).toBe(target)
    expect(moved.workflowCount).toBe(2)
    for (const workflowId of [first.workflowId, second.workflowId]) {
      const relocated = workflows.getById(workflowId)
      expect(relocated?.workspaceId).toBe(target)
      // Membership survives precisely because the project came too.
      expect(relocated?.collectionId).toBe(project.collectionId)
      expect(relocated?.selectedEnvironmentId).toBeNull()
    }
    expect(collections.listByWorkspace(source).items).toHaveLength(0)
    expect(workflows.listByCollection(target, project.collectionId).items).toHaveLength(2)
  })

  it("keeps a call between two workflows in the project and drops one pointing outside it", async () => {
    const source = seedWorkspace("source")
    const target = seedWorkspace("target")
    const project = collections.create({ workspaceId: source, name: "Checkout" })
    const insider = workflows.create({
      workspaceId: source,
      name: "Insider",
      collectionId: project.collectionId,
    })
    const outsider = workflows.create({ workspaceId: source, name: "Outsider" })
    const callsInsider = workflows.create({
      workspaceId: source,
      name: "Calls insider",
      collectionId: project.collectionId,
      nodes: graph(insider.workflowId),
    })
    const callsOutsider = workflows.create({
      workspaceId: source,
      name: "Calls outsider",
      collectionId: project.collectionId,
      nodes: graph(outsider.workflowId),
    })

    await collectionService.moveToWorkspace(source, project.collectionId, target)

    expect(callTargetOf(workflows.getById(callsInsider.workflowId)?.nodes ?? [])).toBe(
      insider.workflowId,
    )
    expect(
      callTargetOf(workflows.getById(callsOutsider.workflowId)?.nodes ?? []),
    ).toBeNull()
    // The one left behind never moved.
    expect(workflows.getById(outsider.workflowId)?.workspaceId).toBe(source)
  })

  it("rejects a move into the workspace the project is already in", async () => {
    const source = seedWorkspace("source")
    const project = collections.create({ workspaceId: source, name: "Checkout" })

    await expect(
      collectionService.moveToWorkspace(source, project.collectionId, source),
    ).rejects.toThrow(/already in this workspace/)
  })

  it("reports an unknown destination workspace as not_found", async () => {
    const source = seedWorkspace("source")
    const project = collections.create({ workspaceId: source, name: "Checkout" })

    await expect(
      collectionService.moveToWorkspace(source, project.collectionId, "ws-nope"),
    ).rejects.toThrow(/workspace ws-nope not found/)
  })
})
