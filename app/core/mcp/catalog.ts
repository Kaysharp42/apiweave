import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  LATEST_PROTOCOL_VERSION,
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
  type InitializeResult,
  type JSONRPCMessage,
  type ListPromptsResult,
  type ListResourceTemplatesResult,
  type ListResourcesResult,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js"
import type { McpCatalog } from "./launcher/contract"

type Transport = Parameters<McpServer["connect"]>[0]

/**
 * Ask `server` for its handshake and its four lists, as an agent would, over
 * an in-memory pair. Raw JSON-RPC rather than the SDK Client: the catalog is
 * replayed to agents verbatim, so it must be exactly the wire answer — the
 * Client would parse it, and compile every output schema on the way.
 */
export async function buildMcpCatalog(server: McpServer): Promise<McpCatalog> {
  const [client, serverSide] = InMemoryTransport.createLinkedPair()
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
  client.onmessage = (message: JSONRPCMessage) => {
    if (!isJSONRPCResultResponse(message) && !isJSONRPCErrorResponse(message)) return
    const waiter = pending.get(Number(message.id))
    pending.delete(Number(message.id))
    if (isJSONRPCResultResponse(message)) waiter?.resolve(message.result)
    else waiter?.reject(new Error(`MCP catalog: ${message.error.message}`))
  }
  let nextId = 0
  const request = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const id = ++nextId
    const answered = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }))
    void client.send({ jsonrpc: "2.0", id, method, params })
    return answered as Promise<T>
  }

  await server.connect(serverSide as unknown as Transport)
  await client.start()
  try {
    const init = await request<InitializeResult>("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "apiweave-mcp-catalog", version: "1" },
    })
    await client.send({ jsonrpc: "2.0", method: "notifications/initialized" })
    const [tools, resources, resourceTemplates, prompts] = await Promise.all([
      request<ListToolsResult>("tools/list"),
      request<ListResourcesResult>("resources/list"),
      request<ListResourceTemplatesResult>("resources/templates/list"),
      request<ListPromptsResult>("prompts/list"),
    ])
    return {
      serverInfo: init.serverInfo,
      capabilities: init.capabilities,
      ...(init.instructions === undefined ? {} : { instructions: init.instructions }),
      tools,
      resources,
      resourceTemplates,
      prompts,
    }
  } finally {
    await client.close()
    await server.close()
  }
}
