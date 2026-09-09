/** JSON-size result for a production-schema fixture payload. */
export interface McpFixturePayloadMeasurement {
  readonly fixtureId: string
  readonly payload: string
  readonly compactJsonBytes: number
  readonly prettyJsonBytes: number
}
