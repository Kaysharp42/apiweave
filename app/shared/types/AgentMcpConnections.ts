import type { AgentMcpConnection } from "./AgentMcpConnection"

/** The Connect-your-agents list, and the Node.js the launcher entries would run. */
export interface AgentMcpConnections {
  readonly clients: readonly AgentMcpConnection[]
  /** Absolute path of the Node.js 20+ written into each entry, or null when none was found. */
  readonly nodePath: string | null
  /** Why `nodePath` is null: not found, or too old. Null when it was found. */
  readonly nodeProblem: string | null
}
