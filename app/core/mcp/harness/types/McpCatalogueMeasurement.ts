import type { McpCatalogueToolMeasurement } from "./McpCatalogueToolMeasurement"

/** Discovery payload measurements from a real in-memory MCP client/server connection. */
export interface McpCatalogueMeasurement {
  readonly toolCount: number
  readonly responseWireJsonBytes: number
  readonly resultJsonBytes: number
  readonly inputSchemaJsonBytes: number
  readonly outputSchemaJsonBytes: number
  readonly descriptionUtf8Bytes: number
  readonly instructionsUtf8Bytes: number
  readonly tools: readonly McpCatalogueToolMeasurement[]
}
