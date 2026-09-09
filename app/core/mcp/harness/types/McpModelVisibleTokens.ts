/** Token counts reported by a client or provider trace, never inferred from bytes. */
export interface McpModelVisibleTokens {
  readonly input: number
  readonly output: number
  readonly cached: number | null
}
