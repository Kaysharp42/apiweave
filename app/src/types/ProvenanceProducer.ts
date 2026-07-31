/** A node and extractor path that produces a variable. */
export interface ProvenanceProducer {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly path: string;
}
