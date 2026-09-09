import { Buffer } from "node:buffer"

/** UTF-8 bytes in the exact compact JSON value supplied to an MCP message. */
export function jsonUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

/** JSON-RPC body bytes, excluding HTTP/SSE framing, compression, and TLS. */
export function responseWireJsonBytes(result: unknown): number {
  return jsonUtf8Bytes({ jsonrpc: "2.0", id: "benchmark", result })
}

/** JSON-RPC tool-call body bytes, excluding HTTP/SSE framing, compression, and TLS. */
export function requestWireJsonBytes(toolName: string, args: unknown): number {
  return jsonUtf8Bytes({
    jsonrpc: "2.0",
    id: "benchmark",
    method: "tools/call",
    params: { name: toolName, arguments: args },
  })
}

/** Pretty JSON remains useful for comparing the legacy text channel's formatting overhead. */
export function prettyJsonUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8")
}

export function textContentBytes(result: unknown): number {
  if (!isRecord(result) || !Array.isArray(result["content"])) return 0
  return result["content"].reduce((total, item) => {
    if (!isRecord(item) || typeof item["text"] !== "string") return total
    return total + Buffer.byteLength(item["text"], "utf8")
  }, 0)
}

export function structuredContentBytes(result: unknown): number {
  if (!isRecord(result) || !("structuredContent" in result)) return 0
  return jsonUtf8Bytes(result["structuredContent"])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
