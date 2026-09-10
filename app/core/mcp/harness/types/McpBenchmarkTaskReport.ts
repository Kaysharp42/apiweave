import type { McpBenchmarkCall } from "./McpBenchmarkCall"
import type { McpBenchmarkCounters } from "./McpBenchmarkCounters"
import type { McpModelVisibleTokens } from "./McpModelVisibleTokens"

/** Measurement output for one benchmark task attempt. */
export interface McpBenchmarkTaskReport {
  readonly taskId: string
  readonly counters: McpBenchmarkCounters
  readonly calls: readonly McpBenchmarkCall[]
  readonly modelVisibleTokens: McpModelVisibleTokens | null
  readonly taskSuccess: boolean | null
  readonly taskOutcome: string | null
}
