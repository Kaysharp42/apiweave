import { describe, expect, it } from "vitest"
import { BUILTIN_AGENTS } from "@shared/agents/builtin-agents"
import {
  createBuiltinClientCapabilityMatrix,
  createMcpBaselineReport,
  createMcpBenchmarkDatabase,
  MCP_FIXTURE_SCENARIOS,
  MCP_TASK_FIXTURES,
  McpBenchmarkRecorder,
  measureMcpCatalogue,
  startMcpBenchmarkHttpFixtureServer,
} from "../harness"
import type { McpBaselineReport } from "../harness"

function expectTaskBytes(task: McpBaselineReport["scriptedTasks"][number]): void {
  expect(task.responseWireJsonBytes).toBeGreaterThan(0)
  expect(task.responseTextBytes).toBeGreaterThan(0)
  expect(task.responseWireJsonBytes).toBeGreaterThan(task.responseTextBytes)
  expect(task.toolNames).toHaveLength(task.toolCallCount)
  expect(task.taskSuccess).toBe(true)
}

describe("MCP baseline harness", () => {
  it("measures the real catalogue as JSON wire bodies without inventing token counts", async () => {
    const measurement = await measureMcpCatalogue()

    expect(measurement.toolCount).toBeGreaterThan(0)
    expect(measurement.responseWireJsonBytes).toBeGreaterThan(measurement.resultJsonBytes)
    expect(measurement.inputSchemaJsonBytes).toBeGreaterThan(0)
    expect(measurement.outputSchemaJsonBytes).toBeGreaterThan(0)
    expect(measurement.modelVisibleBytes).toBeGreaterThan(0)
    expect(measurement.modelVisibleBytes).toBe(
      measurement.tools.reduce((total, tool) => total + tool.modelVisibleBytes, 0),
    )
    expect(measurement.tools).toHaveLength(measurement.toolCount)
    expect(measurement.tools[0]?.definitionJsonBytes).toBeGreaterThan(0)
    expect(measurement.tools.every((tool) => tool.modelVisibleBytes > 0)).toBe(true)
    for (let index = 1; index < measurement.tools.length; index += 1) {
      expect(measurement.tools[index - 1]?.modelVisibleBytes).toBeGreaterThanOrEqual(
        measurement.tools[index]?.modelVisibleBytes ?? 0,
      )
    }
  })

  it("records model turns, calls, polls, errors, bytes and observed tokens independently", () => {
    const recorder = new McpBenchmarkRecorder("repair-extractor")
    recorder.recordModelTurn({ input: 100, output: 20, cached: 5 })
    recorder.recordResourceRead()
    recorder.recordToolInvocation({
      toolName: "runs_get",
      arguments: { workspaceId: "ws-1", runId: "run-1" },
      result: {
        content: [{ type: "text", text: "{\"status\":\"failed\"}" }],
        structuredContent: { status: "failed" },
      },
      durationMs: 12,
      status: "error",
      poll: true,
      retry: true,
      modelVisibleTokens: { input: 7, output: 3, cached: null },
    })
    recorder.recordTaskOutcome(false, "The extractor path remained unresolved.")

    const report = recorder.report()
    expect(report.counters).toEqual({
      modelTurns: 1,
      toolInvocations: 1,
      resourceReads: 1,
      polls: 1,
      errors: 1,
      retries: 1,
    })
    expect(report.calls[0]).toMatchObject({
      toolName: "runs_get",
      responseTextBytes: 19,
      responseStructuredBytes: 19,
      status: "error",
    })
    expect(report.calls[0]?.requestWireJsonBytes).toBeGreaterThan(0)
    expect(report.calls[0]?.responseWireJsonBytes).toBeGreaterThan(report.calls[0]?.responseTextBytes ?? 0)
    expect(report.modelVisibleTokens).toEqual({ input: 107, output: 23, cached: null })
    expect(report.taskSuccess).toBe(false)
  })

  it("assembles the baseline with real tool payloads", async () => {
    const payloads = (await createMcpBaselineReport()).fixturePayloads

    expect(payloads).toHaveLength(24)
    expect(new Set(payloads.map((payload) => payload.payload))).toEqual(new Set([
      "workflow",
      "runToolProjection",
      "runResourceProjection",
      "workflowsSearch",
      "workflowsGetOutline",
      "workflowsDebugContext",
      "runsHistory",
      "workspacesMap",
    ]))
    expect(payloads.some((payload) => payload.payload === "workflowList")).toBe(false)
    for (const payload of ["workflowsSearch", "workflowsGetOutline", "workflowsDebugContext", "runsHistory", "workspacesMap"]) {
      const rows = payloads.filter((row) => row.payload === payload)
      expect(rows).toHaveLength(3)
      expect(rows.every((row) => row.compactJsonBytes > 0)).toBe(true)
    }
    const outline = payloads.filter((row) => row.payload === "workflowsGetOutline")
    expect(outline.find((row) => row.fixtureId === "workflowsGetOutline-500")?.compactJsonBytes)
      .toBeGreaterThan(outline.find((row) => row.fixtureId === "workflowsGetOutline-10")?.compactJsonBytes ?? 0)
  }, 60_000)

  it("assembles the baseline with scripted task calls", async () => {
    const tasks = (await createMcpBaselineReport()).scriptedTasks

    expect(tasks.map((task) => task.taskId)).toEqual([
      "orient",
      "find-and-patch",
      "debug",
      "add-assertion",
      "history",
      "map-route-per-workflow",
      "map-route",
      "workspace-map",
    ])
    const expected: Readonly<Record<string, { callCount: number; toolCallCount: number; resourceReadCount: number }>> = {
      orient: { callCount: 2, toolCallCount: 1, resourceReadCount: 1 },
      "find-and-patch": { callCount: 5, toolCallCount: 5, resourceReadCount: 0 },
      debug: { callCount: 2, toolCallCount: 2, resourceReadCount: 0 },
      "add-assertion": { callCount: 2, toolCallCount: 2, resourceReadCount: 0 },
      history: { callCount: 1, toolCallCount: 1, resourceReadCount: 0 },
      // Phase 4: N+1 calls (one search, then one per workflow) become one.
      "map-route-per-workflow": { callCount: 11, toolCallCount: 11, resourceReadCount: 0 },
      "map-route": { callCount: 1, toolCallCount: 1, resourceReadCount: 0 },
      "workspace-map": { callCount: 1, toolCallCount: 1, resourceReadCount: 0 },
    }
    for (const task of tasks) {
      expect(task).toMatchObject(expected[task.taskId] ?? {})
      expectTaskBytes(task)
    }
    const byId = new Map(tasks.map((task) => [task.taskId, task]))
    expect(byId.get("map-route")?.responseTextBytes)
      .toBeLessThan(byId.get("map-route-per-workflow")?.responseTextBytes ?? 0)
  }, 60_000)

  it("keeps outcome-based tasks and fixture edge cases in the committed baseline", () => {
    expect(MCP_TASK_FIXTURES).toHaveLength(7)
    expect(MCP_FIXTURE_SCENARIOS.map((fixture) => fixture.id)).toEqual(expect.arrayContaining([
      "workflow-10",
      "workflow-130",
      "workflow-500",
      "workspace-100",
      "run-history-1000",
      "revision-races",
      "observation-lifecycle",
      "access-boundaries",
    ]))
  })

  it("covers the checked-in agent roster and labels client evidence as unverified", () => {
    const matrix = createBuiltinClientCapabilityMatrix()
    expect(matrix.map((row) => row.agentKey)).toEqual(BUILTIN_AGENTS.map((agent) => agent.agentKey))
    expect(matrix.find((row) => row.agentKey === "claude")).toMatchObject({ mcpWiring: "per-launch", connection: "unverified" })
    expect(matrix.find((row) => row.agentKey === "cursor-agent")).toMatchObject({ mcpWiring: "manual", resourceReading: "unverified" })
    expect(matrix.find((row) => row.agentKey === "aider")).toMatchObject({ mcpWiring: "none", connection: "unsupported", modelVisibleTokens: "not-applicable" })
  })

  it("provides isolated SQLite and deterministic local HTTP fixture entry points", async () => {
    expect(createMcpBenchmarkDatabase).toBeTypeOf("function")
    const server = await startMcpBenchmarkHttpFixtureServer()
    try {
      const response = await fetch(`${server.baseUrl}/orders/expected-conflict`)
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        code: "ORDER_CONFLICT",
        message: "The requested order is already closed.",
      })
    } finally {
      await server.close()
    }
  })
})
