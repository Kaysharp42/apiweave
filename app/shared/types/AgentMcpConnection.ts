import type { AgentMcpConnectionState } from "./AgentMcpConnectionState"

/** One MCP client in Settings → MCP Server → Connect your agents. */
export interface AgentMcpConnection {
  /** Stable connector id, e.g. `opencode`. */
  readonly clientId: string
  readonly name: string
  readonly state: AgentMcpConnectionState
  /** The file the entry lives in, shown so the user knows what Connect edits. */
  readonly configPath: string
  /** Why it is in this state, when that needs saying (a read error, the CLI APIWeave runs). */
  readonly detail: string | null
}
