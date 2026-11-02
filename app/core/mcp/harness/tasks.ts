import { Buffer } from "node:buffer"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { RunResult } from "@shared/types/RunResult"
import type { Workflow } from "@shared/types/Workflow"
import { guideUri } from "../guide"
import { responseWireJsonBytes, toolResultBody, toolResultText } from "./measurements"
import { McpBenchmarkRecorder } from "./recorder"
import { createMcpBenchmarkRuntime, openMcpBenchmarkClient } from "./services"
import type { McpBenchmarkRuntime, McpScriptedTaskResult } from "./types"

const TIMESTAMP = "2026-09-09T00:00:00.000Z"
const RESOURCES = ["orders", "pets", "users", "carts", "invoices"] as const
const FAILED_REQUEST_NODE = "orders_req_7"
const ASSERTION_SOURCE_NODE = "orders_req_6"
const ASSERTION_NODE = "orders_check_6"
const DEFAULT_ASSERTION_RULES: readonly Record<string, unknown>[] = [
  { source: "prev", path: "response.body.id", operator: "exists" },
]

/** Drives the §3 task table through a real MCP client and records calls and bytes. */
export async function measureScriptedTasks(): Promise<readonly McpScriptedTaskResult[]> {
  return [
    await runTask("orient", runOrientTask),
    await runTask("find-and-patch", runFindAndPatchTask),
    await runTask("debug", runDebugTask),
    await runTask("add-assertion", runAddAssertionTask),
    await runTask("history", runHistoryTask),
    await runTask("map-route-per-workflow", runMapRoutePerWorkflowTask),
    await runTask("map-route", runMapRouteTask),
    await runTask("workspace-map", runWorkspaceMapTask),
  ]
}

async function runTask(
  taskId: string,
  body: (
    client: Client,
    recorder: McpBenchmarkRecorder,
    seed: Awaited<ReturnType<typeof seedTaskScenario>>,
    resourceBytes: { wire: number; text: number },
  ) => Promise<void>,
): Promise<McpScriptedTaskResult> {
  const runtime = createMcpBenchmarkRuntime()
  const seed = await seedTaskScenario(runtime)
  const connection = await openMcpBenchmarkClient(runtime.deps)
  const recorder = new McpBenchmarkRecorder(taskId)
  const resourceBytes = { wire: 0, text: 0 }
  try {
    await body(connection.client, recorder, seed, resourceBytes)
    recorder.recordTaskOutcome(true, "scripted sequence completed")
  } finally {
    await connection.close()
    runtime.db.close()
  }
  const report = recorder.report()
  const toolWireBytes = report.calls.reduce((total, call) => total + call.responseWireJsonBytes, 0)
  const toolTextBytes = report.calls.reduce((total, call) => total + call.responseTextBytes, 0)
  return {
    taskId,
    callCount: report.counters.toolInvocations + report.counters.resourceReads,
    toolCallCount: report.counters.toolInvocations,
    resourceReadCount: report.counters.resourceReads,
    responseWireJsonBytes: toolWireBytes + resourceBytes.wire,
    responseTextBytes: toolTextBytes + resourceBytes.text,
    toolNames: report.calls.map((call) => call.toolName),
    taskSuccess: report.taskSuccess ?? true,
  }
}

async function runOrientTask(
  client: Client,
  recorder: McpBenchmarkRecorder,
  _seed: TaskSeed,
  resourceBytes: { wire: number; text: number },
): Promise<void> {
  await callTool(client, recorder, "server_info", {})
  await readGuide(client, recorder, guideUri("start-here"), resourceBytes)
}

type TaskSeed = Awaited<ReturnType<typeof seedTaskScenario>>

/** A tool call scoped to the seeded workspace; every task but the orient one makes these. */
function callSeeded(
  client: Client,
  recorder: McpBenchmarkRecorder,
  seed: TaskSeed,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return callTool(client, recorder, toolName, { workspaceId: seed.workspaceId, ...args })
}

async function runFindAndPatchTask(client: Client, recorder: McpBenchmarkRecorder, seed: TaskSeed): Promise<void> {
  const search = asRecord(await callSeeded(client, recorder, seed, "workflows_search", { query: "orders" }))
  const workflowId = asString(asRecord(first(asArray(search["items"]), "workflow search"))["workflowId"])
  const outline = asRecord(await callSeeded(client, recorder, seed, "workflows_get", { workflowId, view: "outline" }))
  const revision = asNumber(outline["rev"])
  const nodeSearch = asRecord(await callSeeded(client, recorder, seed, "workflows_searchNodes", { workflowId, query: "/orders" }))
  const nodeIds = asArray(nodeSearch["items"])
    .slice(0, 2)
    .map((item) => asString(asRecord(item)["nodeId"]))
  if (nodeIds.length === 0) throw new Error("workflow node search returned no ids")
  await callSeeded(client, recorder, seed, "workflows_get", { workflowId, nodeIds })
  await callSeeded(client, recorder, seed, "workflows_patch", {
    workflowId,
    expectedRevision: revision,
    upsertNodes: [{ nodeId: nodeIds[0], label: "Orders request (patched)" }],
  })
}

async function runDebugTask(client: Client, recorder: McpBenchmarkRecorder, seed: TaskSeed): Promise<void> {
  const debug = asRecord(await callSeeded(client, recorder, seed, "workflows_debugContext", { workflowId: seed.workflowId }))
  const summary = asRecord(debug["failureSummary"])
  const failedNodeId = asArray(summary["failedNodeIds"])
    .map((nodeId) => asString(nodeId))[0] ?? seed.failedNodeId
  await callSeeded(client, recorder, seed, "runs_getNodeResult", { runId: seed.failedRunId, nodeId: failedNodeId })
}

async function runAddAssertionTask(client: Client, recorder: McpBenchmarkRecorder, seed: TaskSeed): Promise<void> {
  const suggestion = asRecord(await callSeeded(client, recorder, seed, "assertion_suggest", {
    workflowId: seed.workflowId,
    runId: seed.failedRunId,
    sourceNodeId: ASSERTION_SOURCE_NODE,
  }))
  const proposed = asArray(suggestion["suggestions"])[0]
  const rules = proposed === undefined
    ? DEFAULT_ASSERTION_RULES
    : asArray(asRecord(proposed)["rules"])
  await callSeeded(client, recorder, seed, "assertion_apply", {
    workflowId: seed.workflowId,
    expectedRevision: asNumber(suggestion["rev"]),
    assertionNodeId: ASSERTION_NODE,
    mode: "append",
    rules,
    runId: seed.failedRunId,
  })
}

async function runHistoryTask(client: Client, recorder: McpBenchmarkRecorder, seed: TaskSeed): Promise<void> {
  await callSeeded(client, recorder, seed, "runs_history", { workflowId: seed.workflowId, limit: 20 })
}

/** The route the map-route tasks look for: two of the ten seeded workflows call it. */
const MAPPED_ROUTE = "/orders"

/**
 * "Which nodes hit /orders?" the way it had to be asked before Phase 4: list
 * the workflows, then search each one. Kept as the comparison for map-route.
 */
async function runMapRoutePerWorkflowTask(client: Client, recorder: McpBenchmarkRecorder, seed: TaskSeed): Promise<void> {
  const search = asRecord(await callSeeded(client, recorder, seed, "workflows_search", { limit: 100 }))
  const found: string[] = []
  for (const row of asArray(search["items"])) {
    const workflowId = asString(asRecord(row)["workflowId"])
    const page = asRecord(await callSeeded(client, recorder, seed, "workflows_searchNodes", {
      workflowId,
      query: MAPPED_ROUTE,
      limit: 100,
    }))
    for (const item of asArray(page["items"])) found.push(`${workflowId}:${asString(asRecord(item)["nodeId"])}`)
  }
  expectRouteMatches(found)
}

/** The same question in one workspace-wide search. */
async function runMapRouteTask(client: Client, recorder: McpBenchmarkRecorder, seed: TaskSeed): Promise<void> {
  const page = asRecord(await callSeeded(client, recorder, seed, "workflows_searchNodes", { query: MAPPED_ROUTE, limit: 100 }))
  expectRouteMatches(asArray(page["items"]).map((item) => {
    const match = asRecord(item)
    return `${asString(match["workflowId"])}:${asString(match["nodeId"])}`
  }))
}

/** Orient in the ten-workflow workspace with one map page. */
async function runWorkspaceMapTask(client: Client, recorder: McpBenchmarkRecorder, seed: TaskSeed): Promise<void> {
  const map = asRecord(await callSeeded(client, recorder, seed, "workspaces_map", {}))
  if (asArray(map["items"]).length !== 10 || map["nextCursor"] !== null) {
    throw new Error("workspace map did not return the ten seeded workflows on one page")
  }
}

/** orders flow 0 has 20 requests and orders flow 5 has 8: 28 nodes on the route. */
function expectRouteMatches(found: readonly string[]): void {
  if (new Set(found).size !== 28) throw new Error(`expected 28 nodes on ${MAPPED_ROUTE}, found ${found.length}`)
}

async function seedTaskScenario(runtime: McpBenchmarkRuntime) {
  const workspace = runtime.repositories.workspaces.create({ name: "Task fixture", slug: "task-fixture" })
  const workflowIds: string[] = []
  for (let index = 0; index < 10; index += 1) {
    const resource = RESOURCES[index % RESOURCES.length] ?? "orders"
    const workflow = await runtime.deps.workflows.create(workspace.workspaceId, {
      name: `${resource} flow ${index}`,
      tags: [resource],
      variables: { id0: "1" },
      ...taskGraph(resource, index === 0 ? 20 : 8),
    })
    workflowIds.push(workflow.workflowId)
  }
  const workflowId = workflowIds[0]
  if (workflowId === undefined) throw new Error("task fixture seeded no workflows")
  const failedRunId = seedTaskRuns(runtime.repositories.runs, workspace.workspaceId, workflowId)
  return { workspaceId: workspace.workspaceId, workflowId, failedRunId, failedNodeId: FAILED_REQUEST_NODE }
}

function seedTaskRuns(
  runs: McpBenchmarkRuntime["repositories"]["runs"],
  workspaceId: string,
  workflowId: string,
): string {
  const failedRun = runs.create({ workspaceId, workflowId })
  const failedResults: RunResult[] = []
  for (let index = 0; index < 20; index += 1) {
    const failed = index === 7
    failedResults.push({
      nodeId: `orders_req_${index}`,
      status: failed ? "failed" : "passed",
      duration: 30,
      request: { method: "GET", url: `https://api.test/orders/${index}` },
      response: {
        statusCode: failed ? 404 : 200,
        headers: { "content-type": "application/json" },
        body: failed
          ? { error: "NOT_FOUND" }
          : { id: index, items: Array.from({ length: 30 }, (_, item) => ({ sku: `s${item}`, qty: item })) },
      },
      ...(failed ? { error: "Request failed with status 404", unresolvedPlaceholders: ["variables.id7"] } : {}),
    })
    failedResults.push({
      nodeId: `orders_check_${index}`,
      status: failed ? "skipped" : "passed",
      duration: 0,
    })
    if (failed) break
  }
  runs.update(failedRun.runId, {
    status: "failed",
    results: failedResults,
    failedNodes: [FAILED_REQUEST_NODE],
    startedAt: TIMESTAMP,
    completedAt: TIMESTAMP,
    duration: 1_000,
  })
  const passedResults: RunResult[] = failedResults
    .slice(0, 4)
    .map((result) => ({ ...result, status: "passed", error: null }))
  for (let index = 0; index < 19; index += 1) {
    const run = runs.create({ workspaceId, workflowId })
    runs.update(run.runId, {
      status: "completed",
      results: passedResults,
      failedNodes: [],
      startedAt: TIMESTAMP,
      completedAt: TIMESTAMP,
      duration: 1_000,
    })
  }
  return failedRun.runId
}

function taskGraph(resource: string, requestCount: number): { nodes: Workflow["nodes"]; edges: Workflow["edges"] } {
  const nodes: Workflow["nodes"] = [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }]
  const edges: Workflow["edges"] = []
  let previous = "start"
  for (let index = 0; index < requestCount; index += 1) {
    const requestId = `${resource}_req_${index}`
    const assertionId = `${resource}_check_${index}`
    nodes.push({
      nodeId: requestId,
      type: "http-request",
      label: `${index % 2 === 0 ? "Get" : "Create"} ${resource} ${index}`,
      position: { x: 100 * (index + 1), y: 0 },
      config: {
        method: index % 2 === 0 ? "GET" : "POST",
        url: `{{env.BASE_URL}}/${resource}/{{variables.id${index}}}?expand=all`,
        headers: [
          { key: "Authorization", value: "Bearer {{secrets.API_TOKEN}}" },
          { key: "Accept", value: "application/json" },
        ],
        ...(index % 2 === 0
          ? {}
          : { bodyType: "json" as const, body: JSON.stringify({ name: `item ${index}`, qty: index, tags: ["a", "b"] }) }),
        extractors: { [`id${index + 1}`]: "response.body.id" },
      },
    })
    nodes.push({
      nodeId: assertionId,
      type: "assertion",
      label: `Check ${index}`,
      position: { x: 100 * (index + 1) + 50, y: 0 },
      config: {
        assertions: [
          { source: "status", path: "", operator: "equals", expectedValue: 200 },
          { source: "prev", path: "response.body.id", operator: "exists" },
        ],
      },
    })
    edges.push({
      edgeId: `e_${previous}_${requestId}`,
      source: previous,
      target: requestId,
      ...(previous.includes("check") ? { sourceHandle: "pass" as const } : {}),
    })
    edges.push({ edgeId: `e_${requestId}_${assertionId}`, source: requestId, target: assertionId })
    previous = assertionId
  }
  nodes.push({ nodeId: "end", type: "end", position: { x: 100 * (requestCount + 2), y: 0 } })
  edges.push({ edgeId: `e_${previous}_end`, source: previous, target: "end", sourceHandle: "pass" })
  return { nodes, edges }
}

async function callTool(
  client: Client,
  recorder: McpBenchmarkRecorder,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const startedAt = Date.now()
  const result = await client.callTool({ name: toolName, arguments: args })
  recorder.recordToolInvocation({
    toolName,
    arguments: args,
    result,
    durationMs: Date.now() - startedAt,
    status: result.isError === true ? "error" : "success",
  })
  if (result.isError === true) {
    throw new Error(`${toolName} failed: ${toolResultText(result)}`)
  }
  return toolResultBody(result)
}

async function readGuide(
  client: Client,
  recorder: McpBenchmarkRecorder,
  uri: string,
  resourceBytes: { wire: number; text: number },
): Promise<void> {
  const result = await client.readResource({ uri })
  recorder.recordResourceRead()
  resourceBytes.wire += responseWireJsonBytes(result)
  resourceBytes.text += Buffer.byteLength(toolResultText(result), "utf8")
}

function first(items: readonly unknown[], what: string): unknown {
  const item = items[0]
  if (item === undefined) throw new Error(`${what} returned no rows`)
  return item
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a JSON object")
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("expected a JSON array")
  return value
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected a string")
  return value
}

function asNumber(value: unknown): number {
  if (typeof value !== "number") throw new Error("expected a number")
  return value
}
