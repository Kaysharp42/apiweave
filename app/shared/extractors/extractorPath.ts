import type { ExtractorPathBuild } from "../types/ExtractorPathBuild"
import type { ExtractorResolution } from "../types/ExtractorResolution"

/**
 * Extractor paths are dot-separated segments resolved against the whole node
 * result, which is why they start at `response.` -- `response.body.id`,
 * `response.headers.etag`, `response.statusCode`. An array element is addressed
 * by suffixing its owning key: `response.body.items[0].id`.
 *
 * The grammar is deliberately small. Anything it cannot express (a key holding
 * a dot, an array of arrays, a non-identifier key in front of an index) must be
 * reported as unsupported instead of silently producing a path that never
 * resolves at run time.
 */
export const EXTRACTOR_ROOT = "response"

const ARRAY_SEGMENT_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** The result of resolving a single path segment against a container value. */
type SegmentStep =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failureReason: NonNullable<ExtractorResolution["failureReason"]> }

/** Resolves an `key[index]` segment against a container already known to be an object. */
function resolveArraySegment(
  container: Record<string, unknown>,
  match: RegExpMatchArray,
): SegmentStep {
  const key = match[1]!
  if (!(key in container)) return { ok: false, failureReason: "path-missing" }

  const candidate = container[key]
  if (!Array.isArray(candidate)) return { ok: false, failureReason: "type-mismatch" }

  const arrayIndex = Number.parseInt(match[2]!, 10)
  if (arrayIndex >= candidate.length) return { ok: false, failureReason: "path-missing" }

  return { ok: true, value: candidate[arrayIndex] }
}

/** Resolves a plain key segment against a container already known to be an object. */
function resolvePlainSegment(container: Record<string, unknown>, key: string): SegmentStep {
  if (!(key in container)) return { ok: false, failureReason: "path-missing" }
  return { ok: true, value: container[key] }
}

/** Resolves one dot-separated segment of an extractor path against the current value. */
function resolvePathSegment(value: unknown, part: string): SegmentStep {
  if (typeof value !== "object" || value === null) {
    return { ok: false, failureReason: "type-mismatch" }
  }

  const container = value as Record<string, unknown>
  const arrayMatch = part.match(ARRAY_SEGMENT_RE)
  return arrayMatch ? resolveArraySegment(container, arrayMatch) : resolvePlainSegment(container, part)
}

/**
 * Walks `path` over `data`. Shared by the runner (which extracts the real value
 * after a request) and the renderer (which previews what an extractor would
 * capture from the response already on screen), so both agree on what resolves.
 */
export function resolveExtractorPath(data: unknown, path: string): ExtractorResolution {
  if (data === null || data === undefined || !path) {
    return { value: undefined, failureReason: "path-missing" }
  }

  const parts = path.split(".")
  let value: unknown = data

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const step = resolvePathSegment(value, parts[partIndex]!)
    if (!step.ok) return { value: undefined, failureReason: step.failureReason }

    value = step.value
    if (value === undefined) return { value: undefined, failureReason: "path-missing" }
    if (value === null && partIndex < parts.length - 1) {
      return { value: undefined, failureReason: "type-mismatch" }
    }
  }

  return { value, failureReason: null }
}

/**
 * Builds an extractor path from a location inside the response body, expressed
 * as the segment list a JSON tree walker produces (string keys, numeric array
 * indices), relative to the body root.
 */
export function buildBodyExtractorPath(
  segments: ReadonlyArray<string | number>,
): ExtractorPathBuild {
  const tokens: string[] = ["body"]

  for (const segment of segments) {
    const lastToken = tokens[tokens.length - 1]!

    if (typeof segment === "number") {
      if (!IDENTIFIER_RE.test(lastToken)) {
        return {
          supported: false,
          reason: ARRAY_SEGMENT_RE.test(lastToken)
            ? "Nested arrays cannot be addressed by an extractor path."
            : `"${lastToken}" is not a valid key in front of an array index.`,
        }
      }
      tokens[tokens.length - 1] = `${lastToken}[${segment}]`
      continue
    }

    if (segment === "") {
      return { supported: false, reason: "Empty keys cannot be addressed by an extractor path." }
    }
    if (segment.includes(".") || segment.includes("[") || segment.includes("]")) {
      return {
        supported: false,
        reason: `The key "${segment}" contains a character the extractor path syntax reserves.`,
      }
    }

    tokens.push(segment)
  }

  return { supported: true, path: `${EXTRACTOR_ROOT}.${tokens.join(".")}` }
}
