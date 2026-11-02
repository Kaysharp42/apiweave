/** JSON-size result for a production-schema fixture payload or a real MCP tool result. */
export interface McpFixturePayloadMeasurement {
  readonly fixtureId: string
  readonly payload: string
  /** Compact UTF-8 JSON of the response body an agent receives. */
  readonly compactJsonBytes: number
  readonly prettyJsonBytes: number
}
