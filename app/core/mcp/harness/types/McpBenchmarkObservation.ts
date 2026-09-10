import type { McpModelVisibleTokens } from "./McpModelVisibleTokens"

/** Sanitized inputs accepted by the baseline recorder for one tool invocation. */
export interface McpBenchmarkObservation {
  readonly toolName: string
  readonly arguments: unknown
  readonly result: unknown
  readonly durationMs: number
  readonly status: "success" | "error"
  readonly modelVisibleTokens?: McpModelVisibleTokens
  readonly retry?: boolean
  readonly poll?: boolean
}
