/** A persisted workflow node and the config fields where it consumes a variable. */
export interface ProvenanceConsumer {
  readonly nodeId: string
  readonly nodeLabel: string
  readonly fields: readonly string[]
}
