import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { AgentRunApprovalRepository } from "../AgentRunApprovalRepository"
import { WorkflowRepository } from "../WorkflowRepository"
import { WorkspaceRepository } from "../WorkspaceRepository"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let approvals: AgentRunApprovalRepository

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  approvals = new AgentRunApprovalRepository(db.kvStore)
})

afterEach(() => {
  db.close()
})

function seedWorkflow(workspaceId: string): string {
  return workflows.create({
    workspaceId,
    name: "uses-secret",
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      { nodeId: "end", type: "end", position: { x: 1, y: 0 } },
    ],
    edges: [{ edgeId: "e1", source: "start", target: "end" }],
  }).workflowId
}

function save(workspaceId: string, workflowId: string, fingerprint = "fp-1"): ReturnType<AgentRunApprovalRepository["save"]> {
  return approvals.save({
    workspaceId,
    agent: "claude-code",
    workflowId,
    workflowName: "uses-secret",
    fingerprint,
    secretNames: ["API_KEY"],
    destinations: ["api.example.com"],
    runsScripts: false,
  })
}

describe("AgentRunApprovalRepository", () => {
  it("finds exactly the approved shape and nothing else", () => {
    const workspaceId = workspaces.create({ name: "Local", slug: "local" }).workspaceId
    const workflowId = seedWorkflow(workspaceId)
    const saved = save(workspaceId, workflowId)

    expect(saved.approvalId).toEqual(expect.any(String))
    expect(saved.createdAt).toEqual(expect.any(String))
    expect(saved).toMatchObject({
      workspaceId,
      agent: "claude-code",
      workflowId,
      workflowName: "uses-secret",
      secretNames: ["API_KEY"],
      destinations: ["api.example.com"],
      runsScripts: false,
    })

    const lookup = { workspaceId, agent: "claude-code", workflowId, fingerprint: "fp-1" }
    expect(approvals.find(lookup)?.approvalId).toBe(saved.approvalId)
    // A different fingerprint, agent, workflow or workspace is not the approved shape.
    expect(approvals.find({ ...lookup, fingerprint: "fp-2" })).toBeUndefined()
    expect(approvals.find({ ...lookup, agent: "other-agent" })).toBeUndefined()
    expect(approvals.find({ ...lookup, workflowId: seedWorkflow(workspaceId) })).toBeUndefined()
    expect(approvals.find({ ...lookup, workspaceId: workspaces.create({ name: "Other", slug: "other" }).workspaceId }))
      .toBeUndefined()

    // Saving the same shape again is a no-op, not a unique-key failure: two
    // runs of it can be approved at the same time.
    expect(save(workspaceId, workflowId, "fp-1").approvalId).toBe(saved.approvalId)
    expect(approvals.list()).toHaveLength(1)
  })

  it("lists every remembered approval and revokes one by id", () => {
    const workspaceId = workspaces.create({ name: "Local", slug: "local" }).workspaceId
    const workflowId = seedWorkflow(workspaceId)
    const first = save(workspaceId, workflowId, "fp-1")
    const second = save(workspaceId, workflowId, "fp-2")

    expect(new Set(approvals.list().map((approval) => approval.approvalId))).toEqual(
      new Set([first.approvalId, second.approvalId]),
    )

    expect(approvals.delete(first.approvalId)).toBe(true)
    expect(approvals.delete(first.approvalId)).toBe(false)
    expect(approvals.list().map((approval) => approval.approvalId)).toEqual([second.approvalId])
  })

  it("goes away with the workflow it was approved for", () => {
    const workspaceId = workspaces.create({ name: "Local", slug: "local" }).workspaceId
    const workflowId = seedWorkflow(workspaceId)
    save(workspaceId, workflowId)

    expect(workflows.delete(workflowId)).toBe(true)
    expect(approvals.list()).toEqual([])
  })
})
