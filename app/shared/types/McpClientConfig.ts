/** What a client needs to connect to the local MCP server. The port is the LIVE
 * bound port (47271 or an ephemeral fallback), never a hardcoded value. */
export interface McpClientConfig {
  readonly url: string
  readonly token: string
  readonly port: number
}
