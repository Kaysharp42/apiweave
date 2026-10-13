/** What the "type" operator accepts: JSON's types, plus integer (a number with no fraction). */
export const ASSERTION_VALUE_TYPES = ["string", "number", "integer", "boolean", "object", "array", "null"] as const

/** A "matches" pattern: `/pattern/flags`, or the whole string as a pattern with no flags. */
export function parseRegexSource(source: string): { readonly pattern: string; readonly flags: string } {
  const literal = /^\/([\s\S]+)\/([a-z]*)$/.exec(source)
  return literal ? { pattern: literal[1]!, flags: literal[2]! } : { pattern: source, flags: "" }
}

/** A "matchesSchema" expected value: a schema object or boolean, or the JSON text of one (as the rule editor stores it). */
export function parseSchemaValue(expected: unknown): object | boolean | null {
  let value = expected
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  return typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value)) ? value : null
}

/**
 * What is wrong with an expected value for the operators whose value has a
 * shape (a type name, a regular expression, a JSON Schema), or null. A missing
 * value and a `{{placeholder}}` are not judged here: the first has its own
 * check and the second is only known at run time.
 */
export function assertionExpectedProblem(operator: string, expected: unknown): string | null {
  if (expected === undefined || (typeof expected === "string" && expected.includes("{{"))) return null
  if (operator === "type") {
    return (ASSERTION_VALUE_TYPES as readonly unknown[]).includes(expected)
      ? null
      : `"type" expects one of ${ASSERTION_VALUE_TYPES.join(", ")}.`
  }
  if (operator === "matches" || operator === "notMatches") {
    if (typeof expected !== "string" || expected === "") return `"${operator}" expects a regular expression.`
    const { pattern, flags } = parseRegexSource(expected)
    try {
      // Compiling only: nothing is matched against it here.
      new RegExp(pattern, flags)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid regular expression."
    }
  }
  if (operator === "matchesSchema") {
    return parseSchemaValue(expected) === null ? '"matchesSchema" expects a JSON Schema object.' : null
  }
  return null
}
