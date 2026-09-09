import { describe, expect, it } from "vitest"
import { BUILTIN_AGENTS } from "@shared/agents/builtin-agents"
import {
  createBuiltinClientCapabilityMatrix,
  createMcpBenchmarkDatabase,
  MCP_FIXTURE_SCENARIOS,
  MCP_TASK_FIXTURES,
  McpBenchmarkRecorder,
  measureFixturePayloads,
  measureMcpCatalogue,
  startMcpBenchmarkHttpFixtureServer,
} from "../harness"

describe("MCP baseline harness", () => {
  it("measures the real catalogue as JSON wire bodies without inventing token counts", async () => {
    const measurement = await measureMcpCatalogue()

    expect(measurement.toolCount).toBeGreaterThan(0)
    expect(measurement.responseWireJsonBytes).toBeGreaterThan(measurement.resultJsonBytes)
    expect(measurement.inputSchemaJsonBytes).toBeGreaterThan(0)
    expect(measurement.outputSchemaJsonBytes).toBeGreaterThan(0)
    expect(measurement.tools).toHaveLength(measurement.toolCount)
    expect(measurement.tools[0]?.definitionJsonBytes).toBeGreaterThan(0)
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
    const payloads = measureFixturePayloads()
    expect(payloads).toHaveLength(12)
    expect(payloads.find((payload) => payload.fixtureId === "workflow-500")?.compactJsonBytes)
      .toBeGreaterThan(payloads.find((payload) => payload.fixtureId === "workflow-10")?.compactJsonBytes ?? 0)
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
