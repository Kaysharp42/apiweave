import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { IpcRouter } from "../ipc/router"
import { registerBridgeTools } from "./bridge"
import { MCP_PROMPTS } from "./prompts"
import { MCP_SERVER_INFO_TOOL, toolAnnotations } from "./tools"

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
    MCP_SERVER_INFO_TOOL.name,
    {
      description: MCP_SERVER_INFO_TOOL.description,
      outputSchema: z.object({
        result: z.object({ name: z.string(), version: z.string(), transport: z.string() }),
      }),
      annotations: toolAnnotations(MCP_SERVER_INFO_TOOL),
    },
    () => {
      const result = { name: MCP_SERVER_NAME, version, transport: "loopback-http" }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: { result },
      }
    },
  )

  for (const prompt of MCP_PROMPTS) {
    server.registerPrompt(
      prompt.name,
      { description: prompt.description, argsSchema: prompt.argsSchema },
      (args) => prompt.build(args),
    )
  }

  return server
}
