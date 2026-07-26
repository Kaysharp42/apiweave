/** A node that consumes a variable, with the fields that reference it. */
export interface ProvenanceConsumer {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly fields: readonly string[];
}
