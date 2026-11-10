import { execFile } from "node:child_process"
import os from "node:os"
import type { AgentMcpConnection, AgentMcpConnections } from "@shared/types"
import { resolveExecutable, spawnCommandFor } from "../../agents/executable"
import { MCP_CLIENT_CONNECTORS, SESSION_MERGING_CLIENTS } from "./clients"
import type { ConnectorContext, McpClientConnector } from "./connector"
import { findNodeRuntime } from "./node_runtime"

const CLI_TIMEOUT_MS = 30_000

export interface AgentMcpConnectOptions {
  /** The stdio launcher in userData every entry points at. */
  readonly launcherPath: string
  readonly env?: NodeJS.ProcessEnv
  readonly home?: string
  readonly platform?: NodeJS.Platform
  readonly connectors?: readonly McpClientConnector[]
  readonly runCli?: ConnectorContext["runCli"]
}

/**
 * Connect your agents: registers the stdio launcher in each MCP client's own
 * user config, only when the user clicks. Off the IPC router on purpose — it
 * writes other applications' files and runs their CLIs, which no MCP client
 * must be able to ask for.
 */
export class AgentMcpConnectService {
  private readonly env: NodeJS.ProcessEnv
  private readonly home: string
  private readonly platform: NodeJS.Platform
  private readonly connectors: readonly McpClientConnector[]
  private readonly runCli: ConnectorContext["runCli"]

  public constructor(private readonly options: AgentMcpConnectOptions) {
    this.env = options.env ?? process.env
    this.home = options.home ?? os.homedir()
    this.platform = options.platform ?? process.platform
    this.connectors = options.connectors ?? MCP_CLIENT_CONNECTORS
    this.runCli = options.runCli ?? ((command, args) => runCli(command, args, this.env))
  }

  public async list(): Promise<AgentMcpConnections> {
    const node = await findNodeRuntime(this.env)
    const context = this.context(node.path ?? "node")
    const clients = this.connectors.filter((connector) => connector.supported(context)).map((connector) => this.describe(connector, context))
    return { clients, nodePath: node.path, nodeProblem: node.problem }
  }

  public async connect(clientId: string): Promise<AgentMcpConnections> {
    const node = await findNodeRuntime(this.env)
    if (node.path === null) throw new Error(node.problem ?? "Node.js was not found.")
    await this.connector(clientId).connect(this.context(node.path))
    return this.list()
  }

  public async disconnect(clientId: string): Promise<AgentMcpConnections> {
    const node = await findNodeRuntime(this.env)
    await this.connector(clientId).disconnect(this.context(node.path ?? "node"))
    return this.list()
  }

  /**
   * Whether a roster agent APIWeave is launching already reaches the bridge
   * through its own user config — and so must not be given a per-session
   * `apiweave` entry that it would merge into that one (see
   * {@link SESSION_MERGING_CLIENTS}).
   */
  public coversSession(agentKey: string): boolean {
    const clientId = SESSION_MERGING_CLIENTS[agentKey]
    return clientId !== undefined && this.isConnected(clientId)
  }

  private isConnected(clientId: string): boolean {
    const connector = this.connectors.find((candidate) => candidate.clientId === clientId)
    if (connector === undefined) return false
    try {
      return connector.read(this.context("node")).state === "connected"
    } catch {
      return false
    }
  }

  private describe(connector: McpClientConnector, context: ConnectorContext): AgentMcpConnection {
    const base = { clientId: connector.clientId, name: connector.name, configPath: connector.configPath(context) }
    try {
      return { ...base, ...connector.read(context) }
    } catch (error) {
      // Installed, but its config cannot be read: say why rather than hide the client.
      return { ...base, state: "not-connected", detail: error instanceof Error ? error.message : String(error) }
    }
  }

  private connector(clientId: string): McpClientConnector {
    const connector = this.connectors.find((candidate) => candidate.clientId === clientId)
    if (connector === undefined) throw new Error(`Unknown MCP client: ${clientId}`)
    return connector
  }

  private context(nodePath: string): ConnectorContext {
    return {
      platform: this.platform,
      home: this.home,
      env: this.env,
      entry: { command: nodePath, args: [this.options.launcherPath] },
      runCli: this.runCli,
    }
  }
}

/** A client's own CLI, found on PATH and run without a shell; its stderr is the error when it fails. */
function runCli(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  const executable = resolveExecutable(command, env)
  if (executable === undefined) return Promise.reject(new Error(`${command} was not found on PATH`))
  const spawn = spawnCommandFor(executable, args, env)
  return new Promise((resolve, reject) => {
    execFile(
      spawn.file,
      [...spawn.args],
      { timeout: CLI_TIMEOUT_MS, windowsHide: true, windowsVerbatimArguments: spawn.verbatim, env },
      (error, stdout, stderr) => {
        if (error === null) resolve(stdout)
        else reject(new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${(stderr || stdout || error.message).trim()}`))
      },
    )
  })
}
