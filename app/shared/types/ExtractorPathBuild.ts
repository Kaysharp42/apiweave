/**
 * The result of turning a JSON tree location into an extractor path string.
 *
 * The extractor grammar is narrower than JSON itself (see
 * `shared/extractors/extractorPath.ts`), so some locations in a response body
 * simply cannot be addressed. Callers must handle the unsupported case rather
 * than emitting a path the runner would never resolve.
 */
export type ExtractorPathBuild =
  | { readonly supported: true; readonly path: string }
  | { readonly supported: false; readonly reason: string }
