import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { registerAllHandlers, type HandlerDeps } from "../../ipc/handlers"
import { IpcRouter } from "../../ipc/router"
import { MCP_INSTRUCTIONS } from "../guide"
import { createMcpServer } from "../server"
import { jsonUtf8Bytes, responseWireJsonBytes } from "./measurements"
import type { McpCatalogueMeasurement, McpCatalogueToolMeasurement } from "./types"

/** Measures the server's real tools/list result without invoking services or a database. */
export async function measureMcpCatalogue(): Promise<McpCatalogueMeasurement> {
  const router = new IpcRouter()
  // Catalogue registration is lazy: no service is dereferenced until a tool is called.
  registerAllHandlers(router, {} as HandlerDeps)
  const server = createMcpServer(router, "benchmark")
  const client = new Client({ name: "apiweave-mcp-baseline", version: "1" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await server.connect(serverTransport as never)
  await client.connect(clientTransport as never)
  try {
    const result = await client.listTools()
    const tools: McpCatalogueToolMeasurement[] = result.tools.map((tool) => ({
      name: tool.name,
      definitionJsonBytes: jsonUtf8Bytes(tool),
      inputSchemaJsonBytes: jsonUtf8Bytes(tool.inputSchema),
      outputSchemaJsonBytes: jsonUtf8Bytes(tool.outputSchema ?? {}),
      descriptionUtf8Bytes: Buffer.byteLength(tool.description ?? "", "utf8"),
    }))
    return {
      toolCount: tools.length,
      responseWireJsonBytes: responseWireJsonBytes(result),
      resultJsonBytes: jsonUtf8Bytes(result),
      inputSchemaJsonBytes: sum(tools, (tool) => tool.inputSchemaJsonBytes),
      outputSchemaJsonBytes: sum(tools, (tool) => tool.outputSchemaJsonBytes),
      descriptionUtf8Bytes: sum(tools, (tool) => tool.descriptionUtf8Bytes),
      instructionsUtf8Bytes: Buffer.byteLength(MCP_INSTRUCTIONS, "utf8"),
      tools: [...tools].sort((left, right) => right.definitionJsonBytes - left.definitionJsonBytes),
    }
  } finally {
    await client.close()
    await server.close()
  }
}

function sum<T>(items: readonly T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0)
}
