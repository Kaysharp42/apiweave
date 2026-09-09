/** Counts agent-visible task activity; server-internal dispatches are excluded. */
export interface McpBenchmarkCounters {
  readonly modelTurns: number
  readonly toolInvocations: number
  readonly resourceReads: number
  readonly polls: number
  readonly errors: number
  readonly retries: number
}
