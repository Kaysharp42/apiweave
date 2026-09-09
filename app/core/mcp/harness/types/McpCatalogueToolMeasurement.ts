/** Byte sizes for one definition returned by the real MCP tools/list response. */
export interface McpCatalogueToolMeasurement {
  readonly name: string
  readonly definitionJsonBytes: number
  readonly inputSchemaJsonBytes: number
  readonly outputSchemaJsonBytes: number
  readonly descriptionUtf8Bytes: number
}
