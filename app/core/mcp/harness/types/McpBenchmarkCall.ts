import type { McpModelVisibleTokens } from "./McpModelVisibleTokens"

/** One model-initiated MCP tool invocation, stored without request or response values. */
export interface McpBenchmarkCall {
  readonly toolName: string
  readonly requestWireJsonBytes: number
  readonly responseWireJsonBytes: number
  readonly responseTextBytes: number
  readonly responseStructuredBytes: number
  readonly durationMs: number
  readonly status: "success" | "error"
  readonly modelVisibleTokens: McpModelVisibleTokens | null
}
