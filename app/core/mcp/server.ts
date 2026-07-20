import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { IpcRouter } from "../ipc/router"
import { registerBridgeTools } from "./bridge"

export const MCP_SERVER_NAME = "APIWeave"

/**
 * Build a fresh MCP server exposing the whitelisted IPC handlers as tools. A new
 * instance is created per HTTP request (stateless transport — see host.ts), which
 * is cheap: registration is a loop over ~35 specs.
 *
 * ponytail: no custom "discovery" tool is ported from Python (~490 LOC). MCP's
 * native `tools/list` already enumerates every tool with its schema + description,
 * which is exactly what an agent needs to discover the surface.
 */
export function createMcpServer(router: IpcRouter, version: string): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version })

  registerBridgeTools(server, router)

  server.registerTool(
    "server_info",
    { description: "Return APIWeave MCP server name, version and transport." },
    () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ name: MCP_SERVER_NAME, version, transport: "loopback-http" }),
        },
      ],
    }),
  )

  return server
}
