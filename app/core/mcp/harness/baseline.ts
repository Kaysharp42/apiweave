import { createBuiltinClientCapabilityMatrix } from "./capabilities"
import { measureMcpCatalogue } from "./catalogue"
import { MCP_FIXTURE_SCENARIOS, MCP_TASK_FIXTURES, measureFixturePayloads } from "./fixtures"
import type { McpBaselineReport } from "./types"

/** Creates a stable Phase-0 baseline report without claiming unavailable client telemetry. */
export async function createMcpBaselineReport(): Promise<McpBaselineReport> {
  return {
    formatVersion: 1,
    measurementDefinitions: {
      wireJsonBytes: "UTF-8 bytes in a compact JSON-RPC body; excludes HTTP/SSE framing, compression, and TLS.",
      modelVisibleTokens: "Only token counts supplied by a client/provider trace. Null means unobserved; bytes are never converted to tokens.",
      modelTurns: "Explicit agent/model turns recorded by the trial driver; MCP server-internal dispatches are excluded.",
      toolInvocations: "Model-initiated tools/call requests recorded by the trial driver.",
      taskSuccess: "Outcome-based task result recorded by the trial driver, not inferred from a successful tool response.",
    },
    catalogue: await measureMcpCatalogue(),
    fixturePayloads: measureFixturePayloads(),
    fixtureScenarios: MCP_FIXTURE_SCENARIOS,
    tasks: MCP_TASK_FIXTURES,
    clientCapabilities: createBuiltinClientCapabilityMatrix(),
  }
}
