/** Serialize MCP text content without whitespace that consumes agent context. */
export function encodeMcpResult(value: unknown): string {
  return JSON.stringify(value)
}
