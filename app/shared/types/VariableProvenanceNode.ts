/** Minimal neutral input accepted by variable provenance analysis. */
export interface VariableProvenanceNode {
  readonly nodeId: string
  readonly label?: string | null | undefined
  readonly config?: Readonly<Record<string, unknown>> | undefined
}
