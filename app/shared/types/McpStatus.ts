import type { McpClientConfig } from "./McpClientConfig"

/** Current state of the opt-in local MCP server, surfaced to the Setup-MCP dialog. */
export interface McpStatus {
  readonly running: boolean
  readonly config: McpClientConfig | null
  /**
   * The stdio launcher an agent runs with `node` (in the app's user-data
   * folder), which starts the app when its server is not reachable. Null only
   * if copying it there failed.
   */
  readonly launcherPath: string | null
  /**
   * True when an agent-started run may use its resolved secrets without the
   * native approval prompt. The run's destination and script restrictions
   * still apply — this only removes the question.
   */
  readonly autoApproveAgentRuns: boolean
}
