/** Why an extractor path failed to resolve against a node result. */
export type ExtractorFailureReason = "path-missing" | "type-mismatch"

/**
 * The outcome of walking an extractor path over a node result. `value` is only
 * meaningful when `failureReason` is `null`.
 */
export interface ExtractorResolution {
  readonly value: unknown
  readonly failureReason: ExtractorFailureReason | null
}
