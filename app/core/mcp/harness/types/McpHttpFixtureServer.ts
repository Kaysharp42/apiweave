/** A deterministic loopback HTTP server used by MCP benchmark task fixtures. */
export interface McpHttpFixtureServer {
  readonly baseUrl: string
  close(): Promise<void>
}
