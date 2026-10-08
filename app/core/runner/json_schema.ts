import { Validator, type OutputUnit, type Schema, type SchemaDraft } from "@cfworker/json-schema"
import type { SchemaViolation } from "@shared/types/SchemaViolation"

/** How many violations a result keeps; the rest are counted. */
export const MAX_SCHEMA_VIOLATIONS = 10

/**
 * JSON Schema validation for the "matchesSchema" operator and an HTTP node's
 * `responseSchemas`. @cfworker/json-schema interprets the schema; it does not
 * generate code from it the way Ajv does (`new Function`), so a schema from a
 * workflow or a spec is data the host walks, never code it runs. Drafts
 * 2020-12 (the default), 2019-09, 07 and 04, chosen by the schema's `$schema`;
 * formats are checked, unknown keywords and formats ignored.
 */
export function compileSchema(schema: object | boolean): Validator {
  return new Validator(schema as Schema | boolean, draftOf(schema), false)
}

function draftOf(schema: object | boolean): SchemaDraft {
  const declared = typeof schema === "object" ? (schema as { $schema?: unknown }).$schema : undefined
  if (typeof declared !== "string") return "2020-12"
  if (declared.includes("draft-04")) return "4"
  if (declared.includes("draft-06") || declared.includes("draft-07")) return "7"
  if (declared.includes("2019-09")) return "2019-09"
  return "2020-12"
}

/**
 * Keywords whose error only says "something under me failed": the error
 * under them is the one worth reading. What is left names a value and why.
 */
const WRAPPERS = new Set([
  "properties",
  "patternProperties",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "dependentSchemas",
  "items",
  "prefixItems",
  "additionalItems",
  "unevaluatedItems",
  "contains",
  "$ref",
  "$dynamicRef",
  "$recursiveRef",
  "allOf",
  "if",
  "then",
  "else",
])

/** Every violation, leaves only, as JSON Pointers into the value ("" for the value itself). Throws on a schema it cannot use (an unresolvable $ref). */
export function schemaViolations(validator: Validator, value: unknown): SchemaViolation[] {
  const result = validator.validate(value)
  if (result.valid) return []
  const leaves = result.errors.filter((error) => !WRAPPERS.has(error.keyword))
  const violations = leaves.flatMap((error): SchemaViolation[] => {
    const path = pointer(error)
    if (error.keyword !== "false") return [{ path, message: error.error }]
    // With every error collected, cfworker also reports a property that failed
    // its own schema as "additional"; that is the same failure said twice.
    if (leaves.some((other) => other !== error && other.keyword !== "false" && (pointer(other) + "/").startsWith(path + "/"))) return []
    return [{ path, message: "Value is not allowed here." }]
  })
  return violations.length > 0 ? violations : [{ path: "", message: result.errors[0]?.error ?? "Value does not match the schema." }]
}

function pointer(error: OutputUnit): string {
  return error.instanceLocation.replace(/^#/, "")
}
