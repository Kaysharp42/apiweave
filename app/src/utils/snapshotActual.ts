import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation";
import { isQueryPath, resolveExtractorPath } from "@shared/extractors/extractorPath";

/**
 * The value a `matchesSnapshot` rule compared, read off the result of the node
 * it inspected — what Accept snapshot records as the new baseline. Mirrors the
 * runner: a `$`/`xpath` path is rooted at the node result; a `response.` dot
 * path reads the result's response object first, then the result itself; any
 * other dot path reads the result directly. `undefined` when the rule's source
 * is not a node result (a workflow variable) or the value is gone.
 */
export function readSnapshotActual(
  output: unknown,
  rule: Pick<AssertionEvaluation, "source" | "path">,
): unknown {
  if (typeof output !== "object" || output === null) return undefined;
  const result = output as Record<string, unknown>;
  if (rule.source === "status") return result.statusCode;
  if (rule.source === "headers") {
    const headers = result.headers;
    if (typeof headers !== "object" || headers === null) return undefined;
    const wanted = rule.path.toLowerCase();
    const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === wanted);
    return entry?.[1];
  }
  if (rule.source !== "prev") return undefined;
  if (isQueryPath(rule.path) || !rule.path.startsWith("response.")) {
    return resolveExtractorPath(result, rule.path).value;
  }
  const fromResponse = resolveExtractorPath(result, rule.path).value;
  return fromResponse === undefined
    ? resolveExtractorPath(result, rule.path.slice("response.".length)).value
    : fromResponse;
}
