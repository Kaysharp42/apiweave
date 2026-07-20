import type { McpClientConfig } from "./McpClientConfig"

/** Current state of the opt-in local MCP server, surfaced to the Setup-MCP dialog. */
export interface McpStatus {
  readonly running: boolean
  readonly config: McpClientConfig | null
}
