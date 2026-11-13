import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { EnvironmentRepository, RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { DynamicFunctions } from "../../runner/dynamic_functions"
import { SafeHttp } from "../../runner/safe_http"
import { RunScheduler } from "../../runner/scheduler"
import { FixedClockProvider, SeededRandomProvider } from "../../runner/harness/providers"
import { parseThreshold } from "../../runner/thresholds"
import { RunService } from "../run_service"
import { ScopeResolver } from "../scope_resolver"

let db: InitializedDatabase
let server: http.Server
let hits = 0

beforeEach(async () => {
  db = initDatabase({ databasePath: ":memory:" })
  hits = 0
  server = http.createServer((_request, response) => {
    hits += 1
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ big: "x".repeat(2000) }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
})

describe("RunService.createLoad", () => {
  it("runs the workflow in parallel, keeps aggregates only and serves them by group id", async () => {
    const workspaces = new WorkspaceRepository(db.kvStore)
    const workflows = new WorkflowRepository(db.kvStore)
    const runs = new RunRepository(db.kvStore)
    const environments = new EnvironmentRepository(db.kvStore)
    const workspaceId = workspaces.create({ name: "w", slug: "w" }).workspaceId
    const port = (server.address() as AddressInfo).port
    const workflowId = workflows.create({
      workspaceId,
      name: "load-wf",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "http_1", type: "http-request", label: "GET /", position: { x: 1, y: 0 }, config: { method: "GET", url: `http://127.0.0.1:${port}/` } },
      ],
      edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
    }).workflowId
    const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
    const rng = new SeededRandomProvider("0xDEADBEEF")
    const scheduler = new RunScheduler({ runs, workflows, environments, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng), clock, rng })
    const existence = { workspaceExists: (id: string) => workspaces.getById(id) !== undefined, environmentExists: () => false }
    const service = new RunService(runs, new ScopeResolver(existence), scheduler)

    const first = await service.createLoad(workspaceId, {
      workflowId,
      rows: [{}],
      iterations: 12,
      concurrency: 6,
      thresholds: [parseThreshold("errors<1%")],
      nodeInfo: new Map([["http_1", { label: "GET /", type: "http-request" }]]),
    })
    const groupId = first.iteration!.groupId
    expect(await service.getLoadRun(workspaceId, groupId)).toBeNull()
    for (let wait = 0; wait < 200 && (await service.getLoadRun(workspaceId, groupId)) === null; wait++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const loadRun = (await service.getLoadRun(workspaceId, groupId))!
    expect(hits).toBe(12)
    expect(loadRun).toMatchObject({ status: "completed", iterationCount: 12, breachedThresholds: [] })
    expect(loadRun.nodeStats[0]).toMatchObject({ nodeId: "http_1", label: "GET /", count: 12, errorCount: 0 })
    // Retention: every iteration's run row stays, none keeps a node result or a response body.
    const iterationRuns = runs.listByWorkflow(workflowId, workspaceId).items
    expect(iterationRuns).toHaveLength(12)
    expect(iterationRuns.every((run) => run.results.length === 0 && run.status === "completed")).toBe(true)
    expect(await service.getLoadRun(workspaceId, "nope")).toBeNull()
    await scheduler.shutdown(0)
  })
})
