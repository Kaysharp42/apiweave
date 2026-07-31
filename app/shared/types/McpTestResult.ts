/** Result of a trusted main-process reachability probe against the local MCP
 * endpoint. Run in main (not the renderer) so no Origin/CORS check interferes. */
export interface McpTestResult {
  readonly ok: boolean
  readonly status: number | null
}
