import type { McpCatalogueToolMeasurement } from "./McpCatalogueToolMeasurement"

/** Discovery payload measurements from a real in-memory MCP client/server connection. */
export interface McpCatalogueMeasurement {
  readonly toolCount: number
  /** JSON-RPC wire bytes for the whole tools/list response. */
  readonly responseWireJsonBytes: number
  /** Compact UTF-8 JSON of the raw tools/list result, including outputSchemas. */
  readonly resultJsonBytes: number
  /** Sum of per-tool `{ name, description, inputSchema }` bytes (excludes outputSchema). */
  readonly modelVisibleBytes: number
  readonly inputSchemaJsonBytes: number
  readonly outputSchemaJsonBytes: number
  readonly descriptionUtf8Bytes: number
  readonly instructionsUtf8Bytes: number
  /** Sorted by model-visible bytes, largest first. */
  readonly tools: readonly McpCatalogueToolMeasurement[]
}
