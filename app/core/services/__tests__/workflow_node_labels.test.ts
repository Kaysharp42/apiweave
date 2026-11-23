import { beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { ScopeResolver } from "../scope_resolver"
import { WorkflowService } from "../workflow_service"
import type { WorkflowNode } from "@shared/types/WorkflowNode"

let db: InitializedDatabase
let workflows: WorkflowRepository
let service: WorkflowService
let workspaceId: string

const fill = (nodeId: string): WorkflowNode =>
  ({
    nodeId,
    type: "browser",
    position: { x: 0, y: 0 },
    config: { action: "fill", locator: { kind: "label", value: "Email address" }, value: "a@example.test" },
  }) as WorkflowNode

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  const scopeResolver = new ScopeResolver({
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: () => false,
  })
  service = new WorkflowService(workflows, scopeResolver)
  workspaceId = workspaces.create({ name: "Local", slug: "local" }).workspaceId
})

describe("a browser node written without a label", () => {
  it("is named after its action and target on create", async () => {
    const created = await service.create(workspaceId, { name: "Login", nodes: [fill("email")] })
    expect(created.nodes[0]?.label).toBe("Fill Email address")
  })

  it("is named after its action and target when a patch adds it", async () => {
    const created = await service.create(workspaceId, { name: "Login" })
    const patched = await service.patch(workspaceId, created.workflowId, { upsertNodes: [fill("email")] })
    expect(patched.nodes.find((node) => node.nodeId === "email")?.label).toBe("Fill Email address")
  })

  it("keeps the label the author sent", async () => {
    const created = await service.create(workspaceId, {
      name: "Login",
      nodes: [{ ...fill("email"), label: "Email field" } as WorkflowNode],
    })
    expect(created.nodes[0]?.label).toBe("Email field")
  })

  it("leaves other node types alone", async () => {
    const created = await service.create(workspaceId, {
      name: "Login",
      nodes: [{ nodeId: "wait", type: "delay", position: { x: 0, y: 0 }, config: { duration: 1 } } as WorkflowNode],
    })
    expect(created.nodes[0]?.label).toBeUndefined()
  })

  it("does not resurrect a label the user cleared on an existing node", async () => {
    // Seeded through the repository, not the service: the stored node is what
    // the canvas leaves after a user clears a label, and a later patch must
    // keep it rather than rename the step.
    const workflowId = workflows.create({ workspaceId, name: "Login", nodes: [{ ...fill("email"), label: null }] }).workflowId

    const patched = await service.patch(workspaceId, workflowId, {
      upsertNodes: [{ nodeId: "email", config: { value: "b@example.test" } }],
    })
    expect(patched.nodes.find((node) => node.nodeId === "email")?.label).toBeNull()
  })
})
