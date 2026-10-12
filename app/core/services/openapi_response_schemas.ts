import type { JsonValue } from "@shared/types/JsonValue"
import { RESPONSE_SCHEMA_KEY } from "@shared/zod-schemas/HTTPNodeDataSchema"

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"
/**
 * A converted schema larger than this is not attached: it is stored on the node
 * and travels with every save and export. A schema that big is one that
 * inlines most of the spec, and the node is still usable without it.
 */
export const MAX_RESPONSE_SCHEMA_BYTES = 256 * 1024

type JsonObject = { [key: string]: JsonValue }

/** Keywords whose value is a map of name to schema, one schema, or a list of schemas. */
const SCHEMA_MAPS = new Set(["properties", "patternProperties", "dependentSchemas", "$defs", "definitions"])
const SCHEMA_LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"])
const SCHEMA_ONE = new Set([
  "items", "additionalItems", "additionalProperties", "unevaluatedItems", "unevaluatedProperties",
  "not", "if", "then", "else", "contains", "propertyNames",
])
/** OpenAPI-only annotations that validate nothing and can be large. */
const DROPPED = new Set(["example", "examples", "xml", "externalDocs", "discriminator", "nullable", "x-nullable"])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A local JSON Pointer (`#/components/schemas/Pet`) into the spec, or undefined. */
function resolvePointer(ref: string, spec: Record<string, unknown>): unknown {
  if (!ref.startsWith("#/")) return undefined
  let current: unknown = spec
  for (const raw of ref.slice(2).split("/")) {
    const part = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~")
    if (!isObject(current) && !Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * An operation's response body schemas, keyed by status ("200", "2XX",
 * "default") as `HTTPNodeDataSchema.responseSchemas` stores them: only the
 * responses with a JSON body schema. Each is self-contained JSON Schema 2020-12
 * — the spec's `$ref`s are copied into `$defs`, so nothing points back at a
 * spec the workflow does not keep.
 */
export function openApiResponseSchemas(
  operation: Record<string, unknown>,
  spec: Record<string, unknown>,
): Record<string, JsonValue> | undefined {
  const responses = operation["responses"]
  if (!isObject(responses)) return undefined
  const schemas: Record<string, JsonValue> = {}
  for (const [code, raw] of Object.entries(responses)) {
    const key = code === "default" ? code : code.toUpperCase()
    if (!RESPONSE_SCHEMA_KEY.test(key)) continue
    const response = isObject(raw) && typeof raw["$ref"] === "string" ? resolvePointer(raw["$ref"], spec) : raw
    const body = isObject(response) ? jsonBodySchema(response) : undefined
    if (body === undefined) continue
    const schema = toJsonSchema(body, spec)
    if (JSON.stringify(schema).length <= MAX_RESPONSE_SCHEMA_BYTES) schemas[key] = schema
  }
  return Object.keys(schemas).length > 0 ? schemas : undefined
}

/** OpenAPI 3: the `application/json` (or other `+json`) content's schema. Swagger 2: the response's own `schema`. */
function jsonBodySchema(response: Record<string, unknown>): unknown {
  const content = response["content"]
  if (!isObject(content)) return response["schema"]
  const types = Object.keys(content)
  const type =
    types.find((name) => name.split(";")[0]!.trim().toLowerCase() === "application/json") ??
    types.find((name) => /^[^;]*[/+]json\b/i.test(name))
  const media = type === undefined ? undefined : content[type]
  return isObject(media) ? media["schema"] : undefined
}

/**
 * OpenAPI's schema dialect as plain JSON Schema 2020-12. 3.1 schemas already
 * are; 3.0 and Swagger 2 differ in `nullable`, boolean `exclusiveMinimum`/
 * `exclusiveMaximum`, and `type: "file"`. A `writeOnly` property is never in
 * a response, so it is dropped from `required`.
 */
function toJsonSchema(root: unknown, spec: Record<string, unknown>): JsonValue {
  const defs: JsonObject = {}
  const defNames = new Map<string, string>()

  const refTo = (ref: string): JsonValue => {
    if (!ref.startsWith("#/")) return {} // ponytail: external refs are not fetched; that part of the body is not checked
    let name = defNames.get(ref)
    if (name === undefined) {
      const base = (ref.split("/").at(-1) ?? "schema").replace(/[^A-Za-z0-9_.-]/g, "_") || "schema"
      name = base
      for (let n = 2; Object.hasOwn(defs, name); n++) name = `${base}_${n}`
      defNames.set(ref, name)
      defs[name] = {} // claimed before converting, so a schema that refers to itself ends
      const target = resolvePointer(ref, spec)
      defs[name] = target === undefined ? {} : convert(target)
    }
    return { $ref: `#/$defs/${name}` }
  }

  const convert = (node: unknown): JsonValue => {
    if (typeof node === "boolean") return node
    if (!isObject(node)) return {}
    // OpenAPI 3.0 ignores a $ref's siblings; so does this.
    if (typeof node["$ref"] === "string") return refTo(node["$ref"])
    const out: JsonObject = {}
    for (const [key, value] of Object.entries(node)) {
      if (DROPPED.has(key) || value === undefined) continue
      out[key] = convertKeyword(key, value, convert)
    }
    rewriteExclusiveBounds(node, out)
    if (out["type"] === "file") delete out["type"]
    dropWriteOnlyRequired(node, out)
    return applyNullable(node, out)
  }

  const converted = convert(root)
  const schema: JsonObject = isObject(converted) ? { $schema: DRAFT_2020_12, ...converted } : { $schema: DRAFT_2020_12 }
  if (Object.keys(defs).length > 0) schema["$defs"] = { ...(isObject(schema["$defs"]) ? schema["$defs"] : {}), ...defs }
  return schema
}

/** One keyword's value, with any subschemas it holds converted. */
function convertKeyword(key: string, value: unknown, convert: (node: unknown) => JsonValue): JsonValue {
  if (SCHEMA_MAPS.has(key) && isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, convert(schema)]))
  }
  if ((SCHEMA_LISTS.has(key) || SCHEMA_ONE.has(key)) && Array.isArray(value)) return value.map(convert)
  if (SCHEMA_ONE.has(key)) return convert(value)
  return value as JsonValue
}

/** Boolean `exclusiveMinimum`/`exclusiveMaximum` (3.0, Swagger 2) as the numeric bound 2020-12 expects. */
function rewriteExclusiveBounds(node: Record<string, unknown>, out: JsonObject): void {
  for (const [exclusive, bound] of [["exclusiveMinimum", "minimum"], ["exclusiveMaximum", "maximum"]] as const) {
    if (typeof node[exclusive] !== "boolean") continue
    delete out[exclusive]
    if (node[exclusive] === true && typeof node[bound] === "number") {
      out[exclusive] = node[bound]
      delete out[bound]
    }
  }
}

function dropWriteOnlyRequired(node: Record<string, unknown>, out: JsonObject): void {
  const properties = node["properties"]
  if (!Array.isArray(out["required"]) || !isObject(properties)) return
  out["required"] = out["required"].filter((name) => {
    const property = typeof name === "string" ? properties[name] : undefined
    return !(isObject(property) && property["writeOnly"] === true)
  })
}

/** `nullable: true` (3.0) or `x-nullable: true` (Swagger 2) as a `null` type. */
function applyNullable(node: Record<string, unknown>, out: JsonObject): JsonValue {
  if (node["nullable"] !== true && node["x-nullable"] !== true) return out
  if (typeof out["type"] === "string") {
    out["type"] = [out["type"], "null"]
    if (Array.isArray(out["enum"]) && !out["enum"].includes(null)) out["enum"] = [...out["enum"], null]
    return out
  }
  return Array.isArray(out["type"]) ? out : { anyOf: [out, { type: "null" }] }
}
