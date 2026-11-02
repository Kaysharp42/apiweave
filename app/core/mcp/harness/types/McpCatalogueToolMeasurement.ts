/** Byte sizes for one definition returned by the real MCP tools/list response. */
export interface McpCatalogueToolMeasurement {
  readonly name: string
  /** Compact UTF-8 JSON of the whole wire definition, including outputSchema. */
  readonly definitionJsonBytes: number
  /** Compact UTF-8 JSON of `{ name, description, inputSchema }` — what a model can see. */
  readonly modelVisibleBytes: number
  readonly inputSchemaJsonBytes: number
  readonly outputSchemaJsonBytes: number
  readonly descriptionUtf8Bytes: number
}
