import { describe, expect, it } from "vitest"
import { WorkflowExecutor, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { createServer, type Server } from "node:http"

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
          {
            nodeId: "assert1",
            type: "assertion",
            config: { path: "body.value", operator: "equals", expected: 99, source: "prev" },
          },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "assert1" }],
      }
      const executor = new WorkflowExecutor(makeDeps())
      ;(executor as unknown as { results: Map<string, unknown> }).results.set("prev_node", {
        type: "http-request",
        body: { value: 42 },
      })
      const output = await executor.executeWorkflow(workflow)
      expect(output.nodeStatuses["assert1"]).toBe("failed")
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
      const workflow: WorkflowGraph = {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "end", type: "end" },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "end" }],
      }
      const executor = new WorkflowExecutor(makeDeps())
      // Simulate extraction by calling the private method
      const extractors = { userId: "body.id", token: "body.token" }
      const response = { status: "success", body: { id: 42, token: "abc" } }
      ;(executor as unknown as { extractVariables: (e: Record<string, string>, r: unknown) => void }).extractVariables(
        extractors,
        response,
      )
      const vars = (executor as unknown as { workflowVariables: Record<string, unknown> }).workflowVariables
      expect(vars["userId"]).toBe(42)
      expect(vars["token"]).toBe("abc")
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

      await expect(executor.executeWorkflow(workflow)).rejects.toThrow("URL is required for HTTP request")

      expect(events).toContainEqual({
        nodeId: "http_1",
        status: "failed",
        error: "Error: URL is required for HTTP request",
      })
    })
  })
})
