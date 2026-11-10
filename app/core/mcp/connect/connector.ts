import type { AgentMcpConnectionState } from "@shared/types/AgentMcpConnectionState"

/** The `apiweave` entry every client is given: this install's Node.js running this install's launcher. */
export interface LauncherEntry {
  readonly command: string
  readonly args: readonly string[]
}

/** What a connector may look at and run. Injected, so tests point it at a temporary home. */
export interface ConnectorContext {
  readonly platform: NodeJS.Platform
  readonly home: string
  readonly env: NodeJS.ProcessEnv
  readonly entry: LauncherEntry
  /** Runs a client's own CLI (resolved on PATH) and resolves with its output, rejecting on a non-zero exit. */
  readonly runCli: (command: string, args: readonly string[]) => Promise<string>
}

export interface ConnectorReading {
  readonly state: AgentMcpConnectionState
  readonly detail: string | null
}

/**
 * One MCP client APIWeave can register its stdio launcher with, in the
 * client's *user* configuration — never a project's, which is a repository.
 * Connect and disconnect touch only the `apiweave` entry; whatever else the
 * file holds is the user's.
 */
export interface McpClientConnector {
  readonly clientId: string
  readonly name: string
  /** False when the client has no build for this platform; it is then left out of the list. */
  supported(context: ConnectorContext): boolean
  configPath(context: ConnectorContext): string
  /** Synchronous: it reads one small file, and a session launch asks it on the way. */
  read(context: ConnectorContext): ConnectorReading
  connect(context: ConnectorContext): Promise<void>
  disconnect(context: ConnectorContext): Promise<void>
}

/** The registered server name, in every client. */
export const SERVER_NAME = "apiweave"
