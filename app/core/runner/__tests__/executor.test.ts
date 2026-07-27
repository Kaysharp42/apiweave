import { describe, expect, it } from "vitest"
import { WorkflowExecutor, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"

function makeDeps(overrides: { baseUrl?: string; secrets?: Record<string, string> } = {}) {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  const http = new SafeHttp({ allowLoopback: true })
  const functions = new DynamicFunctions(clock, rng)
  return {
    clock,
    rng,
    http,
    functions,
    baseUrl: overrides.baseUrl,
    secrets: overrides.secrets,
  }
}

describe("WorkflowExecutor", () => {
  describe("start and end nodes", () => {
    it("marks start and end as passed", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "end", type: "end" },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "end" }],
      }
      const executor = new WorkflowExecutor(makeDeps())
      const output = await executor.executeWorkflow(workflow)
      expect(output.status).toBe("passed")
      expect(output.nodeStatuses["start"]).toBe("passed")
      expect(output.nodeStatuses["end"]).toBe("passed")
    })
  })

  describe("variable substitution", () => {
    it("substitutes workflow variables", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "end", type: "end" },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "end" }],
        variables: { token: "abc123" },
      }
      const executor = new WorkflowExecutor(makeDeps())
      const output = await executor.executeWorkflow(workflow)
      expect(output.extractedVariables["token"]).toBe("abc123")
    })

    it("substitutes secrets", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "end", type: "end" },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "end" }],
      }
      const executor = new WorkflowExecutor(makeDeps({ secrets: { apiKey: "secret-value" } }))
      // Secrets are substituted during HTTP request execution, tested in HTTP tests
      const output = await executor.executeWorkflow(workflow)
      expect(output.status).toBe("passed")
    })
  })

  describe("assertion nodes", () => {
    it("evaluates passing assertion", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "prev_node", type: "http-request" },
          {
            nodeId: "assert1",
            type: "assertion",
            config: { path: "body.value", operator: "equals", expected: 42, source: "prev" },
          },
          { nodeId: "end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "assert1" },
          { edgeId: "e2", source: "assert1", target: "end" },
          { edgeId: "e3", source: "prev_node", target: "assert1" },
        ],
      }
      const executor = new WorkflowExecutor(makeDeps())
      // Pre-populate a result for the assertion to evaluate
      ;(executor as unknown as { results: Map<string, unknown> }).results.set("prev_node", {
        type: "http-request",
        body: { value: 42 },
      })
      const output = await executor.executeWorkflow(workflow)
      expect(output.nodeStatuses["assert1"]).toBe("passed")
    })

    it("evaluates failing assertion", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "prev_node", type: "http-request" },
          {
            nodeId: "assert1",
            type: "assertion",
            config: { path: "body.value", operator: "equals", expected: 99, source: "prev" },
          },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "assert1" },
          { edgeId: "e2", source: "prev_node", target: "assert1" },
        ],
      }
      const executor = new WorkflowExecutor(makeDeps())
      ;(executor as unknown as { results: Map<string, unknown> }).results.set("prev_node", {
        type: "http-request",
        body: { value: 42 },
      })
      const output = await executor.executeWorkflow(workflow)
      expect(output.nodeStatuses["assert1"]).toBe("failed")
    })

    it("evaluates a header-source assertion case-insensitively", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "prev_node", type: "http-request" },
          {
            nodeId: "assert1",
            type: "assertion",
            config: { path: "Content-Type", operator: "contains", expected: "json", source: "headers" },
          },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "assert1" },
          { edgeId: "e2", source: "prev_node", target: "assert1" },
        ],
      }
      const executor = new WorkflowExecutor(makeDeps())
      ;(executor as unknown as { results: Map<string, unknown> }).results.set("prev_node", {
        type: "http-request",
        headers: { "content-type": "application/json" },
      })
      const output = await executor.executeWorkflow(workflow)
      expect(output.nodeStatuses["assert1"]).toBe("passed")
    })

    it("evaluates a cookie-source assertion from Set-Cookie", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "prev_node", type: "http-request" },
          {
            nodeId: "assert1",
            type: "assertion",
            config: { path: "session", operator: "equals", expected: "abc", source: "cookies" },
          },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "assert1" },
          { edgeId: "e2", source: "prev_node", target: "assert1" },
        ],
      }
      const executor = new WorkflowExecutor(makeDeps())
      ;(executor as unknown as { results: Map<string, unknown> }).results.set("prev_node", {
        type: "http-request",
        headers: { "set-cookie": "session=abc; Path=/; HttpOnly, theme=dark; Path=/" },
      })
      const output = await executor.executeWorkflow(workflow)
      expect(output.nodeStatuses["assert1"]).toBe("passed")
    })

    it("resolves each branched assertion from its own HTTP predecessor", async () => {
      const { createServer } = await import("node:http")
      const server = createServer((request, response) => {
        const finish = () => {
          response.statusCode = request.url === "/first" ? 201 : 202
          response.end("{}")
        }
        if (request.url === "/second") setTimeout(finish, 10)
        else finish()
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const port = (server.address() as { port: number }).port
      try {
        const workflow: WorkflowGraph = {
          nodes: [
            { nodeId: "start", type: "start" },
            { nodeId: "http_first", type: "http-request", config: { url: `http://127.0.0.1:${port}/first` } },
            { nodeId: "delay_first", type: "delay", config: { duration: 60 } },
            { nodeId: "http_second", type: "http-request", config: { url: `http://127.0.0.1:${port}/second` } },
            {
              nodeId: "assert_first",
              type: "assertion",
              config: { assertions: [{ source: "status", path: "", operator: "equals", expectedValue: 201 }] },
            },
            {
              nodeId: "assert_second",
              type: "assertion",
              config: { assertions: [{ source: "status", path: "", operator: "equals", expectedValue: 202 }] },
            },
          ],
          edges: [
            { edgeId: "start-first", source: "start", target: "http_first" },
            { edgeId: "first-delay", source: "http_first", target: "delay_first" },
            { edgeId: "delay-assert", source: "delay_first", target: "assert_first" },
            { edgeId: "start-second", source: "start", target: "http_second" },
            { edgeId: "second-assert", source: "http_second", target: "assert_second" },
          ],
        }

        const output = await new WorkflowExecutor(makeDeps()).executeWorkflow(workflow)

        expect(output.nodeStatuses["assert_first"]).toBe("passed")
        expect(output.nodeStatuses["assert_second"]).toBe("passed")
        expect(output.results.find((result) => result.nodeId === "assert_first")?.assertions?.[0]?.sourceNodeId).toBe("http_first")
        expect(output.results.find((result) => result.nodeId === "assert_second")?.assertions?.[0]?.sourceNodeId).toBe("http_second")
      } finally {
        server.close()
      }
    })

    it("records ambiguous HTTP predecessors instead of choosing one", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "http_a", type: "http-request" },
          { nodeId: "http_b", type: "http-request" },
          {
            nodeId: "assert1",
            type: "assertion",
            config: { assertions: [{ source: "status", path: "", operator: "equals", expectedValue: 200 }] },
          },
        ],
        edges: [
          { edgeId: "start-assert", source: "start", target: "assert1" },
          { edgeId: "a-assert", source: "http_a", target: "assert1" },
          { edgeId: "b-assert", source: "http_b", target: "assert1" },
        ],
      }
      const executor = new WorkflowExecutor(makeDeps())
      const results = (executor as unknown as { results: Map<string, unknown> }).results
      results.set("http_a", { type: "http-request", statusCode: 200 })
      results.set("http_b", { type: "http-request", statusCode: 200 })

      const output = await executor.executeWorkflow(workflow)
      const evaluation = output.results.find((result) => result.nodeId === "assert1")?.assertions?.[0]

      expect(output.status).toBe("failed")
      expect(evaluation).toMatchObject({
        actualState: "ambiguous-source",
        outcome: "fail",
        reasonCode: "ambiguous-source",
      })
    })

    it("persists every rule while honoring failureMode and expected templates", async () => {
      const workflow: WorkflowGraph = {
        variables: { expectedValue: 42 },
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "http_1", type: "http-request" },
          {
            nodeId: "assert1",
            type: "assertion",
            config: {
              failureMode: "first",
              assertions: [
                { source: "prev", path: "response.body.token", operator: "equals", expectedValue: "wrong" },
                { source: "prev", path: "response.body.value", operator: "equals", expectedValue: "{{variables.expectedValue}}" },
              ],
            },
          },
        ],
        edges: [
          { edgeId: "start-assert", source: "start", target: "assert1" },
          { edgeId: "http-assert", source: "http_1", target: "assert1" },
        ],
      }
      const executor = new WorkflowExecutor(makeDeps())
      ;(executor as unknown as { results: Map<string, unknown> }).results.set("http_1", {
        type: "http-request",
        body: { token: "raw-secret-token", value: 42 },
      })

      const output = await executor.executeWorkflow(workflow)
      const result = output.results.find((item) => item.nodeId === "assert1")

      expect(result?.assertions).toHaveLength(2)
      expect(result?.assertions?.[0]).toMatchObject({ outcome: "fail", reasonCode: "comparison-failed" })
      expect(result?.assertions?.[1]).toMatchObject({ outcome: "skipped", reasonCode: "skipped-after-failure" })
      expect(output.failedNodes).toContain("assert1")
      expect(JSON.stringify(result?.assertions)).not.toContain("raw-secret-token")
      expect(result?.assertions?.[1]?.expectedState).toBe("resolved-template")
    })

    it("resolves an expected-value template before comparison", async () => {
      const workflow: WorkflowGraph = {
        variables: { actual: 42, expected: 42, secretActual: "resolved-secret-value" },
        nodes: [
          { nodeId: "start", type: "start" },
          {
            nodeId: "assert1",
            type: "assertion",
            config: {
              assertions: [
                { source: "variables", path: "actual", operator: "equals", expectedValue: "{{variables.expected}}" },
                { source: "variables", path: "secretActual", operator: "equals", expectedValue: "{{secrets.API_KEY}}" },
              ],
            },
          },
        ],
        edges: [{ edgeId: "start-assert", source: "start", target: "assert1" }],
      }

      const output = await new WorkflowExecutor(
        makeDeps({ secrets: { API_KEY: "resolved-secret-value" } }),
      ).executeWorkflow(workflow)

      expect(output.status).toBe("passed")
      const evaluations = output.results.find((result) => result.nodeId === "assert1")?.assertions
      expect(evaluations?.[0]).toMatchObject({
        expectedState: "resolved-template",
        outcome: "pass",
        reasonCode: "passed",
      })
      expect(evaluations?.[1]).toMatchObject({ expectedState: "resolved-template", outcome: "pass" })
      expect(JSON.stringify(evaluations)).not.toContain("resolved-secret-value")
    })

    it("preserves a canonical null expected value in structured evidence", async () => {
      const workflow: WorkflowGraph = {
        variables: { actualNull: null },
        nodes: [
          { nodeId: "start", type: "start" },
          {
            nodeId: "assert1",
            type: "assertion",
            config: {
              failureMode: "all",
              assertions: [
                { source: "variables", path: "actualNull", operator: "equals", expectedValue: null },
                { source: "variables", path: "missing", operator: "equals", expectedValue: null },
              ],
            },
          },
        ],
        edges: [{ edgeId: "start-assert", source: "start", target: "assert1" }],
      }

      const output = await new WorkflowExecutor(makeDeps()).executeWorkflow(workflow)
      const evaluations = output.results.find((result) => result.nodeId === "assert1")?.assertions

      expect(evaluations?.[0]).toMatchObject({ expectedType: "null", actualType: "null", outcome: "pass" })
      expect(evaluations?.[1]).toMatchObject({ expectedType: "null", actualState: "missing", outcome: "fail" })
    })

    it("honors assertion continueOnFail and response.duration in milliseconds", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "http_1", type: "http-request" },
          {
            nodeId: "assert1",
            type: "assertion",
            config: {
              continueOnFail: true,
              failureMode: "all",
              assertions: [
                { source: "prev", path: "response.duration", operator: "lt", expectedValue: 100 },
                { source: "prev", path: "response.duration", operator: "lt", expectedValue: 1000 },
              ],
            },
          },
          { nodeId: "delay", type: "delay", config: { duration: 0 } },
        ],
        edges: [
          { edgeId: "start-assert", source: "start", target: "assert1" },
          { edgeId: "http-assert", source: "http_1", target: "assert1" },
          { edgeId: "assert-delay", source: "assert1", target: "delay" },
        ],
      }
      const executor = new WorkflowExecutor({ ...makeDeps(), baseUrl: "http://harness" })
      ;(executor as unknown as { results: Map<string, unknown> }).results.set("http_1", {
        type: "http-request",
        duration: 250,
      })

      const output = await executor.executeWorkflow(workflow)

      expect(output.status).toBe("failed")
      expect(output.nodeStatuses["delay"]).toBe("passed")
      expect(output.results.find((result) => result.nodeId === "assert1")?.assertions).toEqual([
        expect.objectContaining({ outcome: "fail", actualType: "number" }),
        expect.objectContaining({ outcome: "pass", actualType: "number" }),
      ])
    })
  })

  describe("delay nodes", () => {
    it("collapses delay to 0 in harness mode", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "delay1", type: "delay", config: { duration: 5000 } },
          { nodeId: "end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "delay1" },
          { edgeId: "e2", source: "delay1", target: "end" },
        ],
      }
      const executor = new WorkflowExecutor(makeDeps({ baseUrl: "http://localhost:9999" }))
      const start = Date.now()
      const output = await executor.executeWorkflow(workflow)
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(1000) // Should be instant in harness mode
      expect(output.nodeStatuses["delay1"]).toBe("passed")
    })

    it("uses the jitter bounds instead of the fixed duration when jitter is configured", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "delay1", type: "delay", config: { duration: 5000, jitter: { minMs: 2000, maxMs: 2000 } } },
          { nodeId: "end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "delay1" },
          { edgeId: "e2", source: "delay1", target: "end" },
        ],
      }
      const executor = new WorkflowExecutor(makeDeps())
      const output = await executor.executeWorkflow(workflow)
      expect(output.nodeStatuses["delay1"]).toBe("passed")
      expect(output.results.find((r) => r.nodeId === "delay1")?.duration).toBe(2000)
    })
  })

  describe("cancellation", () => {
    it("stops execution when cancelled before start", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "end", type: "end" },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "end" }],
      }
      const controller = new AbortController()
      controller.abort()
      const executor = new WorkflowExecutor(makeDeps())
      const output = await executor.executeWorkflow(workflow, { cancelSignal: controller.signal })
      expect(output.status).toBe("failed")
    })
  })

  describe("extraction", () => {
    it("extracts variables from HTTP response via dotted path", async () => {
      const executor = new WorkflowExecutor(makeDeps())
      // Simulate extraction by calling the private method
      const extractors = { userId: "body.id", token: "body.token" }
      const response = { status: "success", body: { id: 42, token: "abc" } }
      const outcomes = (executor as unknown as {
        extractVariables: (nodeId: string, e: Record<string, string>, r: unknown) => unknown
      }).extractVariables(
        "http_1",
        extractors,
        response,
      )
      const vars = (executor as unknown as { workflowVariables: Record<string, unknown> }).workflowVariables
      expect(vars["userId"]).toBe(42)
      expect(vars["token"]).toBe("abc")
      expect(outcomes).toEqual([
        { producerNodeId: "http_1", variableName: "userId", path: "body.id", matched: true, observedType: "number" },
        { producerNodeId: "http_1", variableName: "token", path: "body.token", matched: true, observedType: "string" },
      ])
    })

    it("records missing and null extractor outcomes without values", () => {
      const executor = new WorkflowExecutor(makeDeps())
      const outcomes = (executor as unknown as {
        extractVariables: (nodeId: string, e: Record<string, string>, r: unknown) => unknown
      }).extractVariables(
        "http_1",
        { missing: "body.missing", nullable: "body.nullable" },
        { status: "success", body: { nullable: null } },
      )

      expect(outcomes).toEqual([
        { producerNodeId: "http_1", variableName: "missing", path: "body.missing", matched: false, observedType: null },
        { producerNodeId: "http_1", variableName: "nullable", path: "body.nullable", matched: true, observedType: "null" },
      ])
      expect(JSON.stringify(outcomes)).not.toContain("value")
    })
  })

  describe("comparison operators", () => {
    const executor = new WorkflowExecutor(makeDeps())
    const compare = (executor as unknown as { compareValues: (a: unknown, op: string, e: unknown) => boolean })
      .compareValues

    it("equals with numeric comparison", () => {
      expect(compare(42, "equals", 42)).toBe(true)
      expect(compare(42, "equals", "42")).toBe(true)
      expect(compare(42, "equals", 99)).toBe(false)
    })

    it("distinguishes an expected JSON null from a missing value", () => {
      expect(compare(null, "equals", null)).toBe(true)
      expect(compare(undefined, "equals", null)).toBe(false)
      expect(compare(undefined, "notEquals", null)).toBe(true)
    })

    it("contains", () => {
      expect(compare("hello world", "contains", "world")).toBe(true)
      expect(compare("hello", "contains", "xyz")).toBe(false)
    })

    it("gt/lt/gte/lte", () => {
      expect(compare(10, "gt", 5)).toBe(true)
      expect(compare(5, "gt", 10)).toBe(false)
      expect(compare(10, "gte", 10)).toBe(true)
      expect(compare(5, "lt", 10)).toBe(true)
      expect(compare(10, "lte", 10)).toBe(true)
    })

    it("exists/notExists", () => {
      expect(compare("value", "exists", null)).toBe(true)
      expect(compare(null, "exists", null)).toBe(false)
      expect(compare(null, "notExists", null)).toBe(true)
      expect(compare("value", "notExists", null)).toBe(false)
    })

    it("count operator", () => {
      expect(compare([1, 2, 3], "count", 3)).toBe(true)
      expect(compare("abc", "count", 3)).toBe(true)
      expect(compare({ a: 1, b: 2 }, "count", 2)).toBe(true)
    })
  })

  describe("conditional merge gate", () => {
    type MergeCond = { branchIndex: number; field: string; operator: string; value: string }
    const gate = (
      conditions: MergeCond[],
      conditionLogic: "AND" | "OR",
      branches: unknown[],
    ) => {
      const executor = new WorkflowExecutor(makeDeps())
      const results = (executor as unknown as { results: Map<string, unknown> }).results
      const predIds = branches.map((b, i) => {
        const id = `b${i}`
        results.set(id, { type: "http-request", ...(b as object) })
        return id
      })
      return () =>
        (
          executor as unknown as {
            evaluateMergeConditions: (
              c: Record<string, unknown>,
              p: readonly string[],
              e: readonly unknown[],
            ) => void
          }
        ).evaluateMergeConditions({ conditions, conditionLogic }, predIds, [])
    }

    it("passes when a branch field matches (OR)", () => {
      expect(
        gate(
          [{ branchIndex: 0, field: "response.statusCode", operator: "equals", value: "201" }],
          "OR",
          [{ statusCode: 201 }],
        ),
      ).not.toThrow()
    })

    it("throws when the configured condition is not met", () => {
      expect(
        gate(
          [{ branchIndex: 0, field: "response.statusCode", operator: "equals", value: "201" }],
          "OR",
          [{ statusCode: 200 }],
        ),
      ).toThrow(/Conditional merge gate not satisfied/)
    })

    it("AND requires every condition to pass", () => {
      const conds: MergeCond[] = [
        { branchIndex: 0, field: "response.statusCode", operator: "equals", value: "200" },
        { branchIndex: 1, field: "response.body.ok", operator: "equals", value: "true" },
      ]
      expect(gate(conds, "AND", [{ statusCode: 200 }, { body: { ok: true } }])).not.toThrow()
      expect(gate(conds, "AND", [{ statusCode: 200 }, { body: { ok: false } }])).toThrow()
    })

    it("no conditions means no gating", () => {
      expect(gate([], "AND", [{ statusCode: 500 }])).not.toThrow()
    })
  })

  describe("event emission", () => {
    it("emits node.completed events", async () => {
      const events: Array<{ nodeId: string; status: string }> = []
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "end", type: "end" },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "end" }],
      }
      const deps = {
        ...makeDeps(),
        emitProgress: (event: { nodeId: string; status: string }) => {
          events.push({ nodeId: event.nodeId, status: event.status })
        },
      }
      const executor = new WorkflowExecutor(deps)
      await executor.executeWorkflow(workflow)
      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e) => e.nodeId === "start")).toBe(true)
      expect(events.some((e) => e.nodeId === "end")).toBe(true)
    })

    it("emits the node error message when execution fails", async () => {
      const events: Array<{ nodeId: string; status: string; error?: string }> = []
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "http_1", type: "http-request", config: {} },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "http_1" }],
      }
      const executor = new WorkflowExecutor({
        ...makeDeps(),
        emitProgress: (event) => {
          if (event.kind === "node.completed") {
            events.push({ nodeId: event.nodeId, status: event.status, error: event.error })
          }
        },
      })

      const output = await executor.executeWorkflow(workflow)

      expect(output.status).toBe("failed")
      expect(output.failedNodes).toContain("http_1")
      expect(output.failureMessage).toBe("Node http_1 failed")
      expect(events).toContainEqual({
        nodeId: "http_1",
        status: "failed",
        error: "Error: URL is required for HTTP request",
      })
    })
  })

  describe("per-node execution window + secret refs (5.1/5.3)", () => {
    it("stamps startedAt/completedAt on a completed delay node", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "delay", type: "delay", config: { duration: 10 } },
          { nodeId: "end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "delay" },
          { edgeId: "e2", source: "delay", target: "end" },
        ],
      }
      const executor = new WorkflowExecutor({ ...makeDeps(), baseUrl: "http://harness" })
      const output = await executor.executeWorkflow(workflow)
      const delayResult = output.results.find((r) => r.nodeId === "delay")
      expect(delayResult?.status).toBe("passed")
      expect(delayResult?.startedAt).toBe("2026-01-02T03:04:05.000Z")
      expect(delayResult?.completedAt).toBe("2026-01-02T03:04:05.000Z")
    })

    it("records secretRefs (names only) on a node that references {{secrets.X}}", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          {
            nodeId: "http_1",
            type: "http-request",
            config: { method: "POST", url: "", body: "{{secrets.API_KEY}}" },
          },
          { nodeId: "end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "http_1" },
          { edgeId: "e2", source: "http_1", target: "end" },
        ],
        settings: { continueOnFail: true },
      }
      const executor = new WorkflowExecutor(makeDeps({ secrets: { API_KEY: "secret-value" } }))
      const output = await executor.executeWorkflow(workflow)
      expect(output.status).toBe("failed")
      const httpResult = output.results.find((r) => r.nodeId === "http_1")
      expect(httpResult?.secretRefs).toEqual(["API_KEY"])
      expect(httpResult?.startedAt).toBe("2026-01-02T03:04:05.000Z")
      expect(httpResult?.completedAt).toBe("2026-01-02T03:04:05.000Z")
    })
  })

  describe("cycle protection", () => {
    it("returns structured failure evidence for a cyclic graph instead of hanging", async () => {
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "delay", type: "delay", config: { duration: 0 } },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "delay" },
          { edgeId: "e2", source: "delay", target: "start" },
        ],
      }
      const executor = new WorkflowExecutor({ ...makeDeps(), baseUrl: "http://harness" })
      const output = await executor.executeWorkflow(workflow)
      expect(output.status).toBe("failed")
      expect(output.failedNodes).toContain("start")
      expect(output.failureMessage).toMatch(/cycle detected/i)
    })
  })
})
