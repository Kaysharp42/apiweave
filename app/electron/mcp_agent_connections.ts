import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { AgentMcpConnections } from "@shared/types"
import { AgentMcpConnectService } from "../core/mcp/connect/service"
import { getLogger } from "../core/logging/logger"

const log = getLogger("mcp")

/** `requireTrustedSender` from the composition root: refuses any sender but the app's own document. */
type TrustedSenderGuard = <Args extends unknown[], R>(
  handler: (...args: Args) => R,
) => (event: IpcMainInvokeEvent, ...args: Args) => R | Promise<never>

/** Nothing to offer when the launcher could not be installed. */
const NO_CONNECTIONS: AgentMcpConnections = { clients: [], nodePath: null, nodeProblem: null }

/**
 * Connect your agents: registers the launcher in each MCP client's own user
 * config, only when the user clicks.
 *
 * Off the router like every other `mcp:*` channel — no MCP client may edit
 * another application's files — which is why these sit behind `guard` rather
 * than being published as tools.
 *
 * Returns the predicate `AgentService` asks before giving a launched Codex or
 * OpenCode session its own `apiweave` entry.
 */
export function registerAgentConnectionHandlers(
  ipcMain: IpcMain,
  guard: TrustedSenderGuard,
  launcherPath: string | null,
): (agentKey: string) => boolean {
  const service = launcherPath === null ? null : new AgentMcpConnectService({ launcherPath })
  const required = (): AgentMcpConnectService => {
    if (service === null) throw new Error("The MCP launcher could not be installed; see the log.")
    return service
  }
  const connect = (verb: string, run: (service: AgentMcpConnectService, clientId: string) => Promise<AgentMcpConnections>) =>
    guard((clientId: string) => {
      log.info(`${verb} ${clientId} and the MCP launcher at the user's request`)
      return run(required(), clientId)
    })

  ipcMain.handle("mcp:listAgentConnections", guard(() => service?.list() ?? NO_CONNECTIONS))
  ipcMain.handle("mcp:connectAgent", connect("connecting", (target, clientId) => target.connect(clientId)))
  ipcMain.handle("mcp:disconnectAgent", connect("disconnecting", (target, clientId) => target.disconnect(clientId)))

  return (agentKey) => service?.coversSession(agentKey) ?? false
}
