import type { ProvenanceConsumer } from "./ProvenanceConsumer";
import type { ProvenanceProducer } from "./ProvenanceProducer";

/** Where a variable comes from and where it goes. */
export interface VariableProvenance {
  readonly producers: readonly ProvenanceProducer[];
  readonly consumers: readonly ProvenanceConsumer[];
}
