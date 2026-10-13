import { describe, expect, it } from "vitest"
import { RunResultSchema } from "@shared/zod-schemas"
import type { AssertionItem } from "@shared/types/AssertionItem"
import { WorkflowExecutor, responseSchemaKey, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { RegexSandbox, MAX_REGEX_INPUT_LENGTH } from "../regex_sandbox"
import { compileSchema, schemaViolations } from "../json_schema"

const BODY = {
  id: "ord_1a2b3c4d",
  total: 42,
  ratio: 0.5,
  paid: true,
  items: [{ sku: "A1", qty: 2 }],
  meta: { region: "eu" },
  note: null,
  greeting: "Hello World",
}

function executorReturning(body: unknown, status = 200): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  const http = new SafeHttp({
    fetchImpl: (async () =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as never,
  })
  return new WorkflowExecutor({ clock, rng, http, functions: new DynamicFunctions(clock, rng) })
}

function assertionWorkflow(rules: readonly AssertionItem[], httpConfig: Record<string, unknown> = {}): WorkflowGraph {
  return {
    nodes: [
      { nodeId: "start", type: "start" },
      { nodeId: "req", type: "http-request", config: { method: "GET", url: "http://api.test/orders/1", ...httpConfig } },
      { nodeId: "check", type: "assertion", config: { assertions: rules, failureMode: "all" } },
      { nodeId: "end", type: "end" },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "req" },
      { edgeId: "e2", source: "req", target: "check" },
      { edgeId: "e3", source: "check", target: "end", sourceHandle: "pass" },
    ],
  }
}

async function evaluate(rules: readonly AssertionItem[], body: unknown = BODY) {
  const output = await executorReturning(body).executeWorkflow(assertionWorkflow(rules))
  const result = output.results.find((r) => r.nodeId === "check")!
  expect(RunResultSchema.safeParse(result).success).toBe(true)
  return result.assertions!
}

const rule = (path: string, operator: AssertionItem["operator"], expectedValue: AssertionItem["expectedValue"]): AssertionItem => ({
  source: "prev",
  path,
  operator,
  ...(expectedValue === undefined ? {} : { expectedValue }),
})

describe("assertion operators: matches, notMatches, type", () => {
  it("matches a bare pattern or a /literal/ with flags, against strings, numbers and JSON", async () => {
    const outcomes = await evaluate([
      rule("response.body.id", "matches", "^ord_[0-9a-f]{8}$"),
      rule("response.body.greeting", "matches", "/^hello world$/i"),
      rule("response.body.greeting", "matches", "^hello"),
      rule("response.body.total", "matches", "^\\d+$"),
      rule("response.body.meta", "matches", '"region":"eu"'),
      rule("response.body.missing", "matches", ".*"),
      rule("response.body.id", "notMatches", "^usr_"),
      rule("response.body.missing", "notMatches", "x"),
    ])
    expect(outcomes.map((o) => o.outcome)).toEqual(["pass", "pass", "fail", "pass", "pass", "fail", "pass", "fail"])
  })

  it("checks a value's type, with integer as a number with no fraction", async () => {
    const outcomes = await evaluate([
      rule("response.body.id", "type", "string"),
      rule("response.body.total", "type", "integer"),
      rule("response.body.total", "type", "number"),
      rule("response.body.ratio", "type", "integer"),
      rule("response.body.paid", "type", "boolean"),
      rule("response.body.items", "type", "array"),
      rule("response.body.meta", "type", "object"),
      rule("response.body.note", "type", "null"),
      rule("response.body.items", "type", "object"),
      rule("response.body.missing", "type", "null"),
    ])
    expect(outcomes.map((o) => o.outcome)).toEqual(["pass", "pass", "pass", "fail", "pass", "pass", "pass", "pass", "fail", "fail"])
  })

  it("reports a bad pattern or type name as a comparison error that says why", async () => {
    const [badPattern, badType] = await evaluate([
      rule("response.body.id", "matches", "(unclosed"),
      rule("response.body.id", "type", "text"),
    ])
    expect(badPattern).toMatchObject({ outcome: "fail", reasonCode: "comparison-error" })
    expect(badPattern!.detail).toMatch(/^Invalid regular expression/)
    expect(badType).toMatchObject({ outcome: "fail", reasonCode: "comparison-error" })
    expect(badType!.detail).toMatch(/Unknown type "text"/)
  })

  it("stops a catastrophically backtracking pattern instead of hanging the process", async () => {
    const started = Date.now()
    const [outcome] = await evaluate([rule("response.body.text", "matches", "^(a+)+$")], { text: `${"a".repeat(40)}b` })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(outcome).toMatchObject({ outcome: "fail", reasonCode: "comparison-error" })
    expect(outcome!.detail).toMatch(/timed out after 100 ms/)
  })

  it("refuses a value longer than the input cap rather than testing part of it", async () => {
    const sandbox = await RegexSandbox.load()
    expect(() => sandbox.test("a", "a".repeat(MAX_REGEX_INPUT_LENGTH + 1))).toThrow(/at most 100000/)
    expect(sandbox.test("a$", "a".repeat(MAX_REGEX_INPUT_LENGTH))).toBe(true)
    // An interrupted match leaves the sandbox usable for the next one.
    expect(() => sandbox.test("^(a+)+$", `${"a".repeat(40)}b`)).toThrow(/timed out/)
    expect(sandbox.test("/^OK$/i", "ok")).toBe(true)
  })

  it("works in an HTTP retry's until rules", async () => {
    let calls = 0
    const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
    const rng = new SeededRandomProvider("0xDEADBEEF")
    const http = new SafeHttp({
      fetchImpl: (async () => {
        calls += 1
        return new Response(JSON.stringify({ state: calls < 3 ? "PENDING" : "Job COMPLETE" }), {
          headers: { "Content-Type": "application/json" },
        })
      }) as never,
    })
    const executor = new WorkflowExecutor({ clock, rng, http, functions: new DynamicFunctions(clock, rng) })
    const output = await executor.executeWorkflow({
      nodes: [
        { nodeId: "start", type: "start" },
        {
          nodeId: "poll",
          type: "http-request",
          config: {
            url: "http://api.test/job",
            retry: { maxAttempts: 5, intervalMs: 0, until: [rule("response.body.state", "matches", "/complete$/i")] },
          },
        },
      ],
      edges: [{ edgeId: "e1", source: "start", target: "poll" }],
    })
    expect(output.status).toBe("passed")
    expect(calls).toBe(3)
  })
})

describe("assertion operator: matchesSchema", () => {
  const schema = {
    type: "object",
    required: ["id", "total", "items"],
    properties: {
      id: { type: "string", pattern: "^ord_" },
      total: { type: "integer", minimum: 0 },
      items: { type: "array", items: { $ref: "#/$defs/Item" } },
    },
    $defs: { Item: { type: "object", required: ["sku", "qty"], properties: { qty: { type: "integer" } } } },
  }

  it("passes a body that matches, given as an object or as JSON text", async () => {
    const outcomes = await evaluate([rule("response.body", "matchesSchema", schema), rule("response.body", "matchesSchema", JSON.stringify(schema))])
    expect(outcomes.map((o) => o.outcome)).toEqual(["pass", "pass"])
  })

  it("fails a body that does not, listing each violation's path and reason", async () => {
    const [outcome] = await evaluate([rule("response.body", "matchesSchema", schema)], {
      id: "usr_1",
      total: -1.5,
      items: [{ sku: "A1", qty: "two" }, {}],
    })
    expect(outcome).toMatchObject({ outcome: "fail", reasonCode: "comparison-failed", detail: "6 schema violations" })
    expect(outcome!.schemaErrors!.map((violation) => violation.path)).toEqual(["/id", "/total", "/total", "/items/0/qty", "/items/1", "/items/1"])
    expect(outcome!.schemaErrors![0]!.message).toMatch(/pattern/)
  })

  it("honours draft-07 when the schema declares it, and reports an unusable schema as an error", async () => {
    const draft7 = { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { total: { type: "string" } } }
    const [wrongType, notASchema] = await evaluate([
      rule("response.body", "matchesSchema", draft7),
      rule("response.body", "matchesSchema", "[1, 2]"),
    ])
    expect(wrongType!.schemaErrors).toEqual([{ path: "/total", message: 'Instance type "number" is invalid. Expected "string".' }])
    expect(notASchema).toMatchObject({ reasonCode: "comparison-error", detail: "Expected value is not a JSON Schema object" })
  })

  it("keeps the first 10 violations", async () => {
    const [outcome] = await evaluate(
      [rule("response.body", "matchesSchema", { type: "array", items: { type: "string" } })],
      Array.from({ length: 25 }, (_, n) => n),
    )
    expect(outcome!.detail).toBe("25 schema violations")
    expect(outcome!.schemaErrors).toHaveLength(10)
  })

  it("reports a disallowed property once, not again as a failed one", async () => {
    const regex = await RegexSandbox.load()
    const validator = compileSchema({ type: "object", additionalProperties: false, properties: { id: { type: "integer" } } })
    expect(schemaViolations(validator, { id: "x", extra: 1 }, regex)).toEqual([
      { path: "/id", message: 'Instance type "string" is invalid. Expected "integer".' },
      { path: "/extra", message: "Value is not allowed here." },
    ])
    expect(schemaViolations(validator, { id: 1 }, regex)).toEqual([])
  })

  it("stops a backtracking schema pattern instead of hanging the process", async () => {
    const native = RegExp
    const started = Date.now()
    const [outcome] = await evaluate(
      [rule("response.body", "matchesSchema", { type: "object", properties: { name: { type: "string", pattern: "^(a+)+$" } } })],
      { name: `${"a".repeat(40)}!` },
    )
    expect(Date.now() - started).toBeLessThan(2000)
    expect(outcome).toMatchObject({ outcome: "fail", reasonCode: "comparison-error" })
    expect(outcome!.detail).toMatch(/timed out after 100 ms/)
    expect(globalThis.RegExp).toBe(native)

    const regex = await RegexSandbox.load()
    const keys = compileSchema({ type: "object", patternProperties: { "^(a+)+$": { type: "integer" } }, additionalProperties: false })
    expect(() => schemaViolations(keys, { [`${"a".repeat(40)}!`]: 1 }, regex)).toThrow(/timed out/)
    // Patterns still mean what they meant: matches, misses, and the keys they claim.
    expect(schemaViolations(keys, { aaa: 1 }, regex)).toEqual([])
    expect(schemaViolations(keys, { aaa: "x", b: 1 }, regex).map((violation) => violation.path)).toEqual(["/aaa", "/b"])
    expect(schemaViolations(compileSchema({ type: "string", pattern: "^\\p{Lu}" }), "école", regex)).toHaveLength(1)
    expect(() => schemaViolations(compileSchema({ type: "string", pattern: "(" }), "x", regex)).toThrow(SyntaxError)
  })
})

describe("http-request responseSchemas", () => {
  const schemas = {
    "200": { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    "4XX": { type: "object", required: ["error"] },
  }

  function requestWorkflow(config: Record<string, unknown>): WorkflowGraph {
    return {
      nodes: [
        { nodeId: "start", type: "start" },
        { nodeId: "req", type: "http-request", config: { url: "http://api.test/orders/1", ...config } },
        { nodeId: "end", type: "end" },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "req" },
        { edgeId: "e2", source: "req", target: "end" },
      ],
    }
  }

  it("passes a response that matches the schema for its status", async () => {
    const output = await executorReturning({ id: "ord_1" }).executeWorkflow(requestWorkflow({ responseSchemas: schemas }))
    expect(output.status).toBe("passed")
    const result = output.results.find((r) => r.nodeId === "req")!
    expect(result.assertions).toMatchObject([{ operator: "matchesSchema", path: "response.body", outcome: "pass" }])
    expect(RunResultSchema.safeParse(result).success).toBe(true)
  })

  it("fails the node when the body does not match, with the violations on its result", async () => {
    const output = await executorReturning({ id: 7 }).executeWorkflow(requestWorkflow({ responseSchemas: schemas }))
    expect(output.status).toBe("failed")
    const result = output.results.find((r) => r.nodeId === "req")!
    expect(result.error).toBe("Response does not match the schema for status 200")
    expect(result.assertions?.[0]?.schemaErrors).toEqual([{ path: "/id", message: 'Instance type "number" is invalid. Expected "string".' }])
    expect(output.nodeStatuses["end"]).toBeUndefined()
  })

  it("checks a negative test's body against its status class, and leaves undocumented statuses alone", async () => {
    const rejected = await executorReturning({ message: "nope" }, 404).executeWorkflow(
      requestWorkflow({ responseSchemas: schemas, expectedStatus: 404 }),
    )
    expect(rejected.results.find((r) => r.nodeId === "req")?.error).toBe("Response does not match the schema for status 4XX")

    const undocumented = await executorReturning({ id: 7 }, 201).executeWorkflow(requestWorkflow({ responseSchemas: schemas }))
    expect(undocumented.status).toBe("passed")
    expect(undocumented.results.find((r) => r.nodeId === "req")?.assertions).toBeNull()
  })

  it("picks the exact status, then its class, then default", () => {
    expect(responseSchemaKey({ "200": {}, "2XX": {}, default: {} }, 200)).toBe("200")
    expect(responseSchemaKey({ "200": {}, "2XX": {}, default: {} }, 204)).toBe("2XX")
    expect(responseSchemaKey({ "200": {}, default: {} }, 500)).toBe("default")
    expect(responseSchemaKey({ "200": {} }, 500)).toBeUndefined()
  })
})
