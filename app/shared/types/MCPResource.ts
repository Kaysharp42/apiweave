/** A single MCP resource template surfaced by the local loopback server. */
export type MCPResource = {
  readonly name: string;
  readonly uriTemplate: string;
  readonly description: string;
};
