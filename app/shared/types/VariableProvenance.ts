import type { ProvenanceConsumer } from "./ProvenanceConsumer"
import type { ProvenanceProducer } from "./ProvenanceProducer"

export interface VariableProvenance {
  readonly producers: readonly ProvenanceProducer[]
  readonly consumers: readonly ProvenanceConsumer[]
}
