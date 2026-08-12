import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { initDatabase, type InitializedDatabase } from "../../db"
import {
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { AssertionAuthoringService } from "../assertion_authoring_service"
import { RunService } from "../run_service"
import { ScopeResolver } from "../scope_resolver"
import { WorkflowService } from "../workflow_service"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflowRepository: WorkflowRepository
let runRepository: RunRepository
let workflowService: WorkflowService
let authoring: AssertionAuthoringService

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflowRepository = new WorkflowRepository(db.kvStore)
  runRepository = new RunRepository(db.kvStore)
  const scopeResolver = new ScopeResolver({
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: () => false,
  })
  const permissions = new LocalOwnerProvider()
  const sync = new LocalOnlySyncProvider()
  workflowService = new WorkflowService(workflowRepository, sync, permissions, scopeResolver)
  const runService = new RunService(runRepository, sync, permissions, scopeResolver)
  authoring = new AssertionAuthoringService(workflowService, runService)
})

afterEach(() => db.close())

async function seedWorkflow() {
  const workspaceId = workspaces.create({ name: "Local", slug: "local" }).workspaceId
  const workflow = await workflowService.create(workspaceId, {
    name: "Assertions",
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
      { nodeId: "request", type: "http-request", position: { x: 100, y: 0 }, config: { method: "GET", url: "https://example.test" } },
      {
        nodeId: "assert-a",
        type: "assertion",
        position: { x: 200, y: 0 },
        config: { assertions: [{ source: "status", path: "", operator: "notEquals", expectedValue: 500 }] },
      },
      {
        nodeId: "assert-b",
        type: "assertion",
        position: { x: 200, y: 100 },
        config: { assertions: [{ source: "prev", path: "response.body.ready", operator: "exists" }] },
      },
      { nodeId: "end", type: "end", position: { x: 300, y: 0 }, config: {} },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "request" },
      { edgeId: "e2", source: "request", target: "assert-a" },
      { edgeId: "e3", source: "request", target: "assert-b" },
      { edgeId: "e4", source: "assert-a", target: "end" },
    ],
  })
  return { workspaceId, workflow }
}

describe("AssertionAuthoringService", () => {
  it("derives deterministic candidates without copying observed body values", async () => {
    const secret = "observed-body-value-must-not-be-copied"
    const { workspaceId, workflow } = await seedWorkflow()
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      results: [{
        nodeId: "request",
        status: "passed",
        duration: 143,
        response: {
          statusCode: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: { ready: true, token: secret },
        },
      }],
    })

    const result = await authoring.suggest(workspaceId, workflow.workflowId, run.runId, "request")
    const serialized = JSON.stringify(result)
    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual([
      "status-observed",
      "status-success-range",
      "content-type-family",
      "body-ready-exists",
      "body-token-exists",
      "body-count",
      "response-time-budget",
    ])
    expect(serialized).not.toContain(secret)
    expect(result.suggestions.find((suggestion) => suggestion.id === "response-time-budget")?.rules).toEqual([
      { source: "prev", path: "response.duration", operator: "lte", expectedValue: 200 },
    ])
    expect(result.suggestions.find((suggestion) => suggestion.id === "body-count")).toMatchObject({
      overfitRisk: "high",
      confidence: "low",
    })
  })

  it("returns a safe preview and rejects secret-looking literals or missing evidence paths", async () => {
    const secret = "Bearer value-that-must-not-cross"
    const { workspaceId, workflow } = await seedWorkflow()
    const run = runRepository.create({ workspaceId, workflowId: workflow.workflowId })
    runRepository.update(run.runId, {
      results: [{
        nodeId: "request",
        status: "passed",
        duration: 20,
        response: { statusCode: 204, headers: {}, body: { ready: true } },
      }],
    })

    const result = await authoring.validate(workspaceId, workflow.workflowId, "request", [
      { source: "status", path: "ignored", operator: "equals", expectedValue: 204 },
      { source: "prev", path: "body.token", operator: "equals", expectedValue: secret },
      { source: "prev", path: "response.body.missing", operator: "exists" },
    ], run.runId)

    expect(result.valid).toBe(false)
    expect(result.compatible).toBe(false)
    expect(result.rules).toEqual([{ source: "status", path: "", operator: "equals", expectedValue: 204 }, {
      source: "prev",
      path: "response.body.missing",
      operator: "exists",
    }])
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["unsafe_literal", "path_missing"]))
    expect(result.preview).toEqual([])
    expect(JSON.stringify(result)).not.toContain(secret)

    const safe = await authoring.validate(workspaceId, workflow.workflowId, "request", [
      { source: "prev", path: "body.ready", operator: "exists" },
    ], run.runId)
    expect(safe).toMatchObject({
      valid: true,
      compatible: true,
      rules: [{ source: "prev", path: "response.body.ready", operator: "exists" }],
      preview: ["prev response.body.ready exists"],
    })
  })

  it("applies only the target node and rejects stale revisions without losing concurrent edits", async () => {
    const { workspaceId, workflow } = await seedWorkflow()
    const applied = await authoring.apply(
      workspaceId,
      workflow.workflowId,
      workflow.rev,
      "assert-a",
      "append",
      [{ source: "status", path: "", operator: "equals", expectedValue: 200 }],
    )

    expect(applied.revision).toBe(workflow.rev + 1)
    const target = applied.workflow.nodes.find((node) => node.nodeId === "assert-a")
    const untouched = applied.workflow.nodes.find((node) => node.nodeId === "assert-b")
    expect(target?.config?.assertions).toEqual([
      { source: "status", path: "", operator: "notEquals", expectedValue: 500 },
      { source: "status", path: "", operator: "equals", expectedValue: 200 },
    ])
    expect(untouched?.config?.assertions).toEqual([
      { source: "prev", path: "response.body.ready", operator: "exists" },
    ])

    const concurrent = workflowRepository.update(workflow.workflowId, { name: "Renderer edit" })!
    await expect(authoring.apply(
      workspaceId,
      workflow.workflowId,
      applied.revision,
      "assert-a",
      "replace",
      [{ source: "status", path: "", operator: "equals", expectedValue: 201 }],
    )).rejects.toMatchObject({ code: "conflict" })

    const persisted = workflowRepository.getById(workflow.workflowId)!
    expect(persisted.name).toBe("Renderer edit")
    expect(persisted.rev).toBe(concurrent.rev)
    expect(persisted.nodes.find((node) => node.nodeId === "assert-a")?.config?.assertions).toEqual(
      target?.config?.assertions,
    )
  })

  // Regression: `expectedValue: false` (and `0`, `""`) was accepted here but
  // blocked at the canvas run gate via a truthiness check. The authoring
  // service always used a *presence* check (`=== undefined`); lock that in so
  // falsy-but-present `expectedValue` survives validate without an
  // `expected_required` issue.
  it.each([
    ["boolean false", { source: "prev", path: "body.flag", operator: "equals", expectedValue: false }],
    ["number zero", { source: "prev", path: "body.count", operator: "equals", expectedValue: 0 }],
    ["empty string", { source: "prev", path: "body.error", operator: "equals", expectedValue: "" }],
    ["notEquals true", { source: "prev", path: "body.flag", operator: "notEquals", expectedValue: true }],
  ] as const)("validates a falsy-but-present expectedValue (%s) as valid", async (_label, rule) => {
    const { workspaceId, workflow } = await seedWorkflow()
    const validated = await authoring.validate(
      workspaceId,
      workflow.workflowId,
      "request",
      [rule],
    )
    expect(validated.valid).toBe(true)
    expect(validated.issues.map((issue) => issue.code)).not.toContain("expected_required")
  })
})
