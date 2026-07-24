/** A node + extractor path that produces a variable. */
export interface ProvenanceProducer {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly path: string;
}

/** A node that consumes a variable via {{variables.NAME}}, with the fields that reference it. */
export interface ProvenanceConsumer {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly fields: readonly string[];
}

/** Where a variable comes from and where it goes. */
export interface VariableProvenance {
  readonly producers: readonly ProvenanceProducer[];
  readonly consumers: readonly ProvenanceConsumer[];
}

/** Map of variable name → provenance. */
export type VariableProvenanceMap = Record<string, VariableProvenance>;