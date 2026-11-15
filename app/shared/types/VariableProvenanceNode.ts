/** Minimal neutral input accepted by variable provenance analysis. */
export interface VariableProvenanceNode {
  readonly nodeId: string
  readonly label?: string | null | undefined
  /** The node type; a `browser` extract step produces the variable its config names. */
  readonly type?: string | undefined
  readonly config?: Readonly<Record<string, unknown>> | undefined
}
