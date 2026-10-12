import { describe, expect, it } from "vitest"
import { HTTPNodeDataSchema } from "@shared/zod-schemas"
import { parseOpenApiSpec, type HttpRequestNode } from "../import_parsers"
import { compileSchema, schemaViolations } from "../../runner/json_schema"
import { RegexSandbox } from "../../runner/regex_sandbox"

const SPEC_30 = {
  openapi: "3.0.3",
  info: { title: "Shop", version: "1" },
  servers: [{ url: "https://shop.test" }],
  paths: {
    "/orders/{id}": {
      get: {
        operationId: "getOrder",
        responses: {
          "200": { description: "ok", content: { "application/json; charset=utf-8": { schema: { $ref: "#/components/schemas/Order" } } } },
          "404": { $ref: "#/components/responses/NotFound" },
          "5XX": { description: "down", content: { "text/plain": { schema: { type: "string" } } } },
        },
      },
    },
    "/health": { get: { responses: { "204": { description: "no body" } } } },
  },
  components: {
    responses: {
      NotFound: { description: "missing", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
    },
    schemas: {
      Order: {
        type: "object",
        required: ["id", "secret", "lines"],
        properties: {
          id: { type: "string" },
          secret: { type: "string", writeOnly: true },
          discount: { type: "number", minimum: 0, exclusiveMinimum: true, nullable: true },
          parent: { $ref: "#/components/schemas/Order" },
          lines: { type: "array", items: { $ref: "#/components/schemas/Line" } },
          example: { type: "string", example: "a property named like a keyword" },
        },
        example: { id: "o1" },
      },
      Line: { type: "object", required: ["sku"], properties: { sku: { type: "string" } } },
      Problem: { type: "object", required: ["title"], properties: { title: { type: "string" } } },
    },
  },
}

function importedNodes(spec: Record<string, unknown>, opts: { schemaAssertions?: boolean } = {}): HttpRequestNode[] {
  return parseOpenApiSpec(spec, opts).nodes.filter((node): node is HttpRequestNode => node.type === "http-request")
}

describe("OpenAPI import: response schemas", () => {
  it("attaches each documented JSON response's schema with every $ref resolved into $defs", () => {
    const [order, health] = importedNodes(SPEC_30)
    const schemas = order!.config.responseSchemas!
    expect(Object.keys(schemas)).toEqual(["200", "404"])
    expect(health!.config.responseSchemas).toBeUndefined()
    expect(schemas["200"]).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: "#/$defs/Order",
      $defs: {
        Order: {
          type: "object",
          required: ["id", "lines"],
          properties: {
            id: { type: "string" },
            secret: { type: "string", writeOnly: true },
            discount: { type: ["number", "null"], exclusiveMinimum: 0 },
            parent: { $ref: "#/$defs/Order" },
            lines: { type: "array", items: { $ref: "#/$defs/Line" } },
            example: { type: "string" },
          },
        },
        Line: { type: "object", required: ["sku"], properties: { sku: { type: "string" } } },
      },
    })
    expect(JSON.stringify(schemas)).not.toContain("#/components")
    // The node's config is what the workflow schema accepts, so it saves.
    expect(HTTPNodeDataSchema.safeParse(order!.config).success).toBe(true)
  })

  it("produces schemas that validate real responses, recursion included", async () => {
    const regex = await RegexSandbox.load()
    const validator = compileSchema(importedNodes(SPEC_30)[0]!.config.responseSchemas!["200"] as object)
    expect(schemaViolations(validator, { id: "o1", discount: null, lines: [{ sku: "A" }], parent: { id: "o0", lines: [] } }, regex)).toEqual([])
    expect(schemaViolations(validator, { id: "o1", discount: 0, lines: [{}] }, regex).map((violation) => violation.path)).toEqual([
      "/discount",
      "/lines/0",
    ])
  })

  it("reads Swagger 2 response schemas and definitions", () => {
    const [node] = importedNodes({
      swagger: "2.0",
      info: { title: "Pets", version: "1" },
      host: "pets.test",
      paths: {
        "/pets": {
          get: { responses: { "200": { schema: { type: "array", items: { $ref: "#/definitions/Pet" } } }, default: { description: "error" } } },
        },
      },
      definitions: { Pet: { type: "object", properties: { tag: { type: "string", "x-nullable": true } } } },
    })
    expect(node!.config.responseSchemas).toEqual({
      "200": {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "array",
        items: { $ref: "#/$defs/Pet" },
        $defs: { Pet: { type: "object", properties: { tag: { type: ["string", "null"] } } } },
      },
    })
  })

  it("attaches nothing when the option is off", () => {
    expect(importedNodes(SPEC_30, { schemaAssertions: false }).every((node) => node.config.responseSchemas === undefined)).toBe(true)
  })
})
