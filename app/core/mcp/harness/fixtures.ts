import { WorkflowSchema } from "@shared/zod-schemas/WorkflowSchema"
import { RunSchema } from "@shared/zod-schemas/RunSchema"
import { projectRunSnapshot, projectRunToolResult } from "../run-projection"
import { prettyJsonUtf8Bytes, jsonUtf8Bytes } from "./measurements"
import type { McpFixturePayloadMeasurement, McpFixtureScenario, McpTaskFixture } from "./types"

const TIMESTAMP = "2026-09-09T00:00:00.000Z"

/** Phase-0 conditions. A trial creates isolated state for each selected scenario. */
export const MCP_FIXTURE_SCENARIOS: readonly McpFixtureScenario[] = [
  scenario("workflow-10", "Small workflow", 1, 10, null, ["group", "note", "large request body"]),
  scenario("workflow-130", "Large workflow", 1, 130, null, ["group", "note", "large request body"]),
  scenario("workflow-500", "Very large workflow", 1, 500, null, ["group", "note", "large request body"]),
  scenario("workspace-10", "Workspace discovery", 10, 130, null, ["project-attached workflows"]),
  scenario("workspace-100", "Large workspace discovery", 100, 130, null, ["project-attached workflows"]),
  scenario("run-history-20", "Short run history", 1, 130, 20, ["passing negative status", "structured HTTP failure"]),
  scenario("run-history-1000", "Long run history", 1, 130, 1000, ["truncated captures", "several failures exceed inline budget"]),
  scenario("resolution-failures", "Resolution and branch failures", 1, 130, 1, ["missing environment variable", "unresolved secret", "missing extractor", "failed assertion", "blocked branch"]),
  scenario("revision-races", "Concurrent graph changes", 1, 130, 2, ["stale revision", "concurrent canvas edit", "historical run against older graph"]),
  scenario("observation-lifecycle", "Run observation lifecycle", 1, 10, 3, ["immediate run", "5-second run", "60-second run", "cancellation", "disconnect", "restart"]),
  scenario("path-and-topology", "Array path and delayed branch topology", 1, 10, 1, ["array-index assertion path", "delay", "merge", "response producer"]),
  scenario("access-boundaries", "Empty and denied reads", 0, null, null, ["empty list", "no match", "unavailable diagnosis", "cross-workspace denial"]),
]

/** Outcome-based task suite. Tool sequences are intentionally not prescribed. */
export const MCP_TASK_FIXTURES: readonly McpTaskFixture[] = [
  task("change-order-status", "Find the order assertion and change its expected status without disturbing the graph.", ["workflow-130"], "Only the intended assertion changes and graph topology/positions remain intact."),
  task("repair-extractor", "Explain why the latest failed run stopped and fix the missing extractor reference.", ["resolution-failures"], "Explanation identifies the failed dependency and the repaired graph validates without deleting unrelated work."),
  task("insert-assertion", "Insert an assertion between this request and its successor.", ["workflow-130", "path-and-topology"], "The original edge is replaced by a correctly handled assertion branch with no disconnected successor."),
  task("classify-409", "Check whether this 409 is the expected result or an actual failure.", ["run-history-20"], "The explanation uses configured expected status and actual run evidence correctly."),
  task("run-and-summarize", "Run this workflow and summarize failures when it finishes.", ["observation-lifecycle", "resolution-failures"], "One run is created, completion is observed correctly, and the failure summary is accurate."),
  task("project-branch-edit", "Find the project workflow by name, inspect the failing branch, and patch one request field.", ["workspace-100", "resolution-failures"], "The requested project workflow and branch are selected, and only the requested request field is changed."),
  task("preserve-concurrent-edit", "Recover from a revision conflict while preserving the user's concurrent edit.", ["revision-races"], "The conflicting edit is re-read/rebased and the concurrent user change remains present."),
]

/** Production-schema fixture payloads used for repeatable size measurements. */
export function measureFixturePayloads(): readonly McpFixturePayloadMeasurement[] {
  const measurements: McpFixturePayloadMeasurement[] = []
  for (const nodeCount of [10, 130, 500]) {
    const workflow = createWorkflowFixture(nodeCount)
    const run = createRunFixture(workflow)
    measurements.push(measure(`workflow-${nodeCount}`, "workflow", workflow))
    measurements.push(measure(`workflow-list-${nodeCount}-x10`, "workflowList", {
      items: Array.from({ length: 10 }, (_, index) => ({ ...workflow, workflowId: `wf-${nodeCount}-${index}` })),
      total: 10,
    }))
    measurements.push(measure(`run-tool-${nodeCount}`, "runToolProjection", projectRunToolResult(run)))
    measurements.push(measure(`run-resource-${nodeCount}`, "runResourceProjection", projectRunSnapshot(run)))
  }
  return measurements
}

function createWorkflowFixture(nodeCount: number) {
  const requestCount = nodeCount - 4
  const requests = Array.from({ length: requestCount }, (_, index) => ({
    nodeId: `request-${index + 1}`,
    type: "http-request" as const,
    label: `Request ${index + 1}`,
    parentId: "group-main",
    config: {
      method: "GET" as const,
      url: `https://fixture.apiweave.test/orders/${index + 1}`,
      ...(index === 0 ? { bodyType: "json" as const, body: JSON.stringify({ note: "x".repeat(4096) }) } : {}),
    },
  }))
  const nodes = [
    { nodeId: "start", type: "start" as const },
    { nodeId: "group-main", type: "group" as const, config: { width: 1000, height: 600, color: "blue" as const } },
    { nodeId: "note-main", type: "note" as const, config: { content: "Synthetic fixture note" } },
    ...requests,
    { nodeId: "end", type: "end" as const },
  ]
  const executableNodes = ["start", ...requests.map((node) => node.nodeId), "end"]
  return WorkflowSchema.parse({
    workspaceId: "ws-fixture",
    workflowId: `wf-${nodeCount}`,
    name: `Synthetic ${nodeCount}-node workflow`,
    description: "Deterministic MCP baseline fixture",
    rev: 1,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    nodes,
    edges: executableNodes.slice(0, -1).map((source, index) => ({
      edgeId: `edge-${index + 1}`,
      source,
      target: executableNodes[index + 1],
    })),
  })
}

function createRunFixture(workflow: ReturnType<typeof createWorkflowFixture>) {
  const executableNodes = workflow.nodes.filter((node) => node.type !== "group" && node.type !== "note")
  return RunSchema.parse({
    workspaceId: workflow.workspaceId,
    workflowId: workflow.workflowId,
    runId: `run-${workflow.workflowId}`,
    status: "completed",
    trigger: "manual",
    rev: 1,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    nodeStatuses: Object.fromEntries(executableNodes.map((node) => [node.nodeId, { status: "passed", statusCode: 200 }])),
    results: executableNodes.map((node) => ({
      nodeId: node.nodeId,
      status: "passed",
      duration: 20,
      response: { statusCode: 200 },
    })),
  })
}

function scenario(
  id: string,
  description: string,
  workflowCount: number,
  nodeCount: number | null,
  runCount: number | null,
  conditions: readonly string[],
): McpFixtureScenario {
  return { id, description, workflowCount, nodeCount, runCount, conditions }
}

function task(id: string, prompt: string, fixtureIds: readonly string[], successCriteria: string): McpTaskFixture {
  return { id, prompt, fixtureIds, successCriteria }
}

function measure(fixtureId: string, payload: string, value: unknown): McpFixturePayloadMeasurement {
  return {
    fixtureId,
    payload,
    compactJsonBytes: jsonUtf8Bytes(value),
    prettyJsonBytes: prettyJsonUtf8Bytes(value),
  }
}
