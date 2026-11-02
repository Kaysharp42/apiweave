import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import { createMcpBenchmarkRuntime, openMcpBenchmarkClient } from "../harness/services"
import type { McpBenchmarkRuntime } from "../harness/types"

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean }

let runtime: McpBenchmarkRuntime
let client: Client
let close: () => Promise<void>
let workspaceId: string

beforeEach(async () => {
  runtime = createMcpBenchmarkRuntime()
  ;({ client, close } = await openMcpBenchmarkClient(runtime.deps))
  workspaceId = runtime.repositories.workspaces.create({ name: "P1", slug: "p1" }).workspaceId
})

afterEach(async () => {
  await close()
  runtime.db.close()
})

async function call(name: string, args: Record<string, unknown>): Promise<{ body: Record<string, unknown>; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  return { body: JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>, isError: result.isError === true }
}

const requestNode = (nodeId: string, extractors?: Record<string, string>): WorkflowNode => ({
  nodeId,
  type: "http-request",
  position: { x: 0, y: 0 },
  config: { method: "GET", url: "https://example.test/x", ...(extractors !== undefined ? { extractors } : {}) },
}) as WorkflowNode

describe("workflows_get over MCP", () => {
  it("defaults to the outline and refuses an oversized full view", async () => {
    const nodes = Array.from({ length: 150 }, (_, index) => ({
      ...requestNode(`n${index}`),
      config: { method: "GET", url: `https://example.test/${"x".repeat(600)}/${index}` },
    })) as WorkflowNode[]
    const { workflowId } = await runtime.deps.workflows.create(workspaceId, { name: "big", nodes })

    const defaulted = await call("workflows_get", { workspaceId, workflowId })
    expect(defaulted.body["view"]).toBe("outline")

    const full = await call("workflows_get", { workspaceId, workflowId, view: "full" })
    expect(full.isError).toBe(true)
    const message = (full.body["error"] as { message: string; code: string })
    expect(message.code).toBe("validation")
    expect(message.message).toContain('view: "outline"')
    expect(message.message).toContain('view: "nodes"')

    // The IPC handler (the renderer's path) still defaults to the whole graph.
    expect(await runtime.deps.workflows.get(workspaceId, workflowId)).toHaveProperty("nodes")
  })

  it("serves a small full view and leaves nodeIds to imply the nodes view", async () => {
    const { workflowId } = await runtime.deps.workflows.create(workspaceId, { name: "small", nodes: [requestNode("a")] })
    const full = await call("workflows_get", { workspaceId, workflowId, view: "full" })
    expect(full.isError).toBe(false)
    expect(full.body).toHaveProperty("nodes")
    const nodes = await call("workflows_get", { workspaceId, workflowId, nodeIds: ["a"] })
    expect(nodes.body["view"]).toBe("nodes")
  })
})

describe("node validation errors", () => {
  it("reports request validation with the list, index and nodeId in the path", async () => {
    const { workflowId } = await runtime.deps.workflows.create(workspaceId, { name: "v", nodes: [requestNode("a")] })
    const bad = await call("workflows_patch", {
      workspaceId,
      workflowId,
      upsertNodes: [
        { nodeId: "ok", type: "delay", position: { x: 0, y: 0 }, config: { duration: 1 } },
        { nodeId: "login", type: "http-request", position: { x: 0, y: 0 }, config: { method: "FETCH", url: "/x" } },
      ],
    })
    expect(bad.isError).toBe(true)
    const error = bad.body["error"] as { message: string; details?: { issues: Array<{ path: Array<string | number>; message: string }> } }
    expect(error.message).toBe("request validation failed")
    const issue = error.details?.issues.find((item) => item.path.includes("method"))
    expect(issue?.path.slice(0, 2)).toEqual(["upsertNodes", 1])
    expect(issue?.message).toContain('nodeId "login"')
  })
})

describe("assertion_suggest", () => {
  it("returns the workflow rev", async () => {
    const assertion = { nodeId: "check", type: "assertion", position: { x: 0, y: 0 }, config: { assertions: [] } } as WorkflowNode
    const created = await runtime.deps.workflows.create(workspaceId, {
      name: "s",
      nodes: [requestNode("req"), assertion],
      edges: [{ edgeId: "e", source: "req", target: "check" }],
    })
    const run = runtime.repositories.runs.create({ workspaceId, workflowId: created.workflowId })
    runtime.repositories.runs.update(run.runId, {
      status: "completed",
      results: [{ nodeId: "req", status: "passed", duration: 5, response: { statusCode: 200, headers: {}, body: { id: 1 } } }],
    })
    const suggested = await call("assertion_suggest", { workspaceId, workflowId: created.workflowId, runId: run.runId, sourceNodeId: "req" })
    expect(suggested.body["rev"]).toBe(created.rev)
  })
})

describe("trimmed list rows", () => {
  it("drops caller-supplied ids from search rows and trims run history rows", async () => {
    for (const name of ["a", "b", "c"]) await runtime.deps.workflows.create(workspaceId, { name })
    const search = await call("workflows_search", { workspaceId, limit: 1 })
    const item = (search.body["items"] as Array<Record<string, unknown>>)[0]!
    expect(item).not.toHaveProperty("workspaceId")
    // `null` is meaningful here (unassigned), so it must survive.
    expect(item["collectionId"]).toBeNull()
    expect((search.body["nextCursor"] as string).length).toBeLessThan(160)

    const workflowId = item["workflowId"] as string
    const ok = runtime.repositories.runs.create({ workspaceId, workflowId })
    runtime.repositories.runs.update(ok.runId, { status: "completed", failedNodes: [] })
    const history = await call("runs_history", { workspaceId, workflowId })
    expect((history.body["items"] as unknown[])[0]).toEqual({
      runId: ok.runId,
      status: "completed",
      startedAt: null,
      durationMs: null,
      failedNodeCount: 0,
    })
  })

  it("rejects a short search cursor reused with different filters", async () => {
    for (const name of ["a", "b"]) await runtime.deps.workflows.create(workspaceId, { name })
    const first = await call("workflows_search", { workspaceId, limit: 1 })
    const reused = await call("workflows_search", { workspaceId, limit: 1, query: "a", cursor: first.body["nextCursor"] })
    expect(reused.isError).toBe(true)
    expect(JSON.stringify(reused.body)).toContain("different")
  })
})

describe("debug context", () => {
  async function seedFailure(): Promise<{ workflowId: string; runId: string; rev: number }> {
    const created = await runtime.deps.workflows.create(workspaceId, {
      name: "chain",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } } as WorkflowNode,
        requestNode("first"),
        requestNode("second", { token: "response.body.token" }),
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "first" },
        { edgeId: "e2", source: "first", target: "second" },
      ],
    })
    const run = runtime.repositories.runs.create({ workspaceId, workflowId: created.workflowId, workflowRev: created.rev })
    runtime.repositories.runs.update(run.runId, {
      status: "failed",
      results: [{ nodeId: "first", status: "failed", duration: 1, error: "boom", response: { statusCode: 500, headers: {}, body: {} } }],
      failedNodes: ["first"],
    })
    return { workflowId: created.workflowId, runId: run.runId, rev: created.rev }
  }

  it("does not warn about, or repeat, nodes starved by the failure", async () => {
    const seed = await seedFailure()
    const context = await call("workflows_debugContext", { workspaceId, workflowId: seed.workflowId, runId: seed.runId })
    const items = (context.body["diagnosis"] as { items: Array<{ code: string; nodeIds: string[] }> }).items
    expect(items.some((item) => item.code === "extractor_producer_not_executed")).toBe(false)
    expect(items.find((item) => item.code === "http_request_failed")?.nodeIds).toEqual(["first"])
    expect((context.body["failureSummary"] as { blockedNodeIds: string[] }).blockedNodeIds).toEqual(["second"])
  })

  it("reports whether the run executed the current revision", async () => {
    const seed = await seedFailure()
    const read = () => call("workflows_debugContext", { workspaceId, workflowId: seed.workflowId, runId: seed.runId })
    expect((await read()).body["graphCorrelation"]).toMatchObject({ status: "current" })

    await call("workflows_patch", { workspaceId, workflowId: seed.workflowId, upsertNodes: [{ nodeId: "first", label: "edited" }] })
    expect((await read()).body["graphCorrelation"]).toMatchObject({ status: "stale" })
  })
})
