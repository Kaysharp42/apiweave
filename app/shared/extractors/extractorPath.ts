import { parse as parseJsonPath, paths as jsonPathNodes, query as queryJsonPath } from "jsonpathly"
import type { ExtractorPathBuild } from "../types/ExtractorPathBuild"
import type { ExtractorResolution } from "../types/ExtractorResolution"
export { isXPath, isValidXPath } from "./xpathQuery"
import { isXPath, resolveXPath } from "./xpathQuery"

/**
 * Extractor paths are dot-separated segments resolved against the whole node
 * result, which is why they start at `response.` -- `response.body.id`,
 * `response.headers.etag`, `response.statusCode`. An array element is addressed
 * by suffixing its owning key: `response.body.items[0].id`.
 *
 * A path beginning with `$` is instead an RFC 9535 JSONPath expression rooted
 * at the same node result, so `$.response.body.items[?@.id==3].name` addresses
 * the same value `response.body.items[0].id` would when the first item has
 * `id == 3`. The two grammars are dispatched in `resolveExtractorPath`, the
 * single entry point every consumer shares.
 *
 * A path beginning with `xpath:` (or `xpath[prefix=uri]:`) is instead XPath 1.0
 * evaluated against the response body as XML, so
 * `xpath://*[local-name()='Total']/text()` reads a SOAP response the way a
 * stored dot path can never address it. See `xpathQuery.ts` for the grammar
 * and its namespace handling.
 *
 * The dot grammar is deliberately small. Anything it cannot express (a key
 * holding a dot, an array of arrays, a non-identifier key in front of an index)
 * must be reported as unsupported instead of silently producing a path that
 * never resolves at run time.
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
 * True when `path` is a JSONPath expression -- a path whose first character is
 * `$`. Every other path stays on the dot grammar.
 */
export function isJsonPath(path: string): boolean {
  return path.startsWith("$")
}

/**
 * True when `path` is evaluated by a query engine rather than the dot grammar
 * -- RFC 9535 JSONPath or XPath -- and is therefore rooted at the node result
 * as a whole instead of at `response.`.
 */
export function isQueryPath(path: string): boolean {
  return isJsonPath(path) || isXPath(path)
}

/**
 * True when `path` is a syntactically valid RFC 9535 JSONPath expression. Used
 * by validation (`isValidRuntimePath`) so an invalid expression is rejected
 * before it reaches the runner, and by the authoring service's evidence reads.
 */
export function isValidJsonPath(path: string): boolean {
  if (!path.startsWith("$")) return false
  try {
    return parseJsonPath(path) !== null
  } catch {
    return false
  }
}

/**
 * Evaluates an RFC 9535 JSONPath expression against `data`. A query that
 * selects no nodes is `path-missing`; an expression the parser rejects is
 * `invalid-path`. A singular query returns the selected value, and a
 * non-singular query returns an array of every selected value, so `count` and
 * `contains` assertions operate on it.
 */
function resolveJsonPath(data: unknown, path: string): ExtractorResolution {
  try {
    if (jsonPathNodes(data, path).length === 0) {
      return { value: undefined, failureReason: "path-missing" }
    }
    return { value: queryJsonPath(data, path), failureReason: null }
  } catch {
    return { value: undefined, failureReason: "invalid-path" }
  }
}

/**
 * The single path resolver shared by extractors, assertions, stream finish
 * conditions and the renderer's preview, so every consumer agrees on what a
 * path addresses. Grammar dispatch lives here: a `$`-prefixed path is RFC 9535
 * JSONPath, an `xpath:`-prefixed path is XPath 1.0 over the XML body, and
 * everything else stays on the dot grammar.
 */
export function resolveExtractorPath(data: unknown, path: string): ExtractorResolution {
  // Persisted graphs are read without re-validation, so a path may not be a string.
  if (data === null || data === undefined || typeof path !== "string" || path === "") {
    return { value: undefined, failureReason: "path-missing" }
  }
  if (isJsonPath(path)) return resolveJsonPath(data, path)
  if (isXPath(path)) return resolveXPath(data, path)
  return resolveDotPath(data, path)
}

/**
 * Walks a dot-grammar `path` over `data`.
 */
function resolveDotPath(data: unknown, path: string): ExtractorResolution {
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
