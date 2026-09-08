import { describe, expect, it } from "vitest"
import { WorkflowExecutor, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"

function makeExecutor(): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({ clock, rng, http: new SafeHttp({ allowLoopback: true }), functions: new DynamicFunctions(clock, rng) })
}

function sseWorkflow(url: string, config: Record<string, unknown> = {}): WorkflowGraph {
  return {
    nodes: [
      { nodeId: "start", type: "start" },
      { nodeId: "stream", type: "sse", config: { url, timeout: 2, ...config } },
      { nodeId: "end", type: "end" },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "stream" },
      { edgeId: "e2", source: "stream", target: "end", sourceHandle: "complete" },
    ],
  }
}

describe("WorkflowExecutor — SSE node", () => {
  it("collects a fragmented, multi-line event then closes the finite probe", async () => {
    const { createServer } = await import("node:http")
    let accept = ""
    const server = createServer((request, response) => {
      accept = request.headers.accept ?? ""
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write("event: order.")
      response.write("updated\nid: evt-7\ndata: {\"id\":\"")
      response.write("order-1\"}\ndata: second line\n\n")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      const output = await makeExecutor().executeWorkflow(sseWorkflow(`http://127.0.0.1:${port}/events`, {
        eventType: "order.updated",
        maxEvents: 1,
        headers: [{ key: "Accept", value: "application/json" }],
        extractors: { payload: "response.body.events[0].data" },
      }))
      const result = output.results.find((entry) => entry.nodeId === "stream")
      expect(output.status).toBe("passed")
      expect(accept).toContain("text/event-stream")
      expect(result?.response).toMatchObject({
        statusCode: 200,
        body: {
          eventCount: 1,
          termination: "event-limit",
          events: [{ event: "order.updated", id: "evt-7", data: "{\"id\":\"order-1\"}\nsecond line" }],
        },
      })
      expect(output.extractedVariables["payload"]).toBe("{\"id\":\"order-1\"}\nsecond line")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("ignores other event types and fails when the stream ends before the target", async () => {
    const { createServer } = await import("node:http")
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.end("event: heartbeat\ndata: alive\n\n")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      const output = await makeExecutor().executeWorkflow(sseWorkflow(`http://127.0.0.1:${port}/events`, {
        eventType: "order.updated",
        maxEvents: 1,
        continueOnFail: true,
      }))
      const result = output.results.find((entry) => entry.nodeId === "stream")
      expect(output.nodeStatuses["stream"]).toBe("failed")
      expect(output.nodeStatuses["end"]).toBeUndefined()
      expect(result?.error).toContain("0/1 captured matching event")
      expect(result?.response).toMatchObject({ body: { events: [], eventCount: 0, termination: "stream-ended" } })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("rejects a successful HTTP response that is not an SSE media type", async () => {
    const { createServer } = await import("node:http")
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end("{}")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      const output = await makeExecutor().executeWorkflow(sseWorkflow(`http://127.0.0.1:${port}/events`, { continueOnFail: true }))
      const result = output.results.find((entry) => entry.nodeId === "stream")
      expect(result?.error).toContain("Expected text/event-stream")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("makes collected event data available to a downstream assertion", async () => {
    const { createServer } = await import("node:http")
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write("event: order.updated\ndata: shipped\n\n")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      const output = await makeExecutor().executeWorkflow({
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "stream", type: "sse", config: { url: `http://127.0.0.1:${port}/events`, maxEvents: 1 } },
          { nodeId: "assert", type: "assertion", config: { assertions: [{ source: "prev", path: "response.body.events[0].data", operator: "equals", expectedValue: "shipped" }] } },
          { nodeId: "end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "stream" },
      { edgeId: "e2", source: "stream", target: "assert", sourceHandle: "complete" },
          { edgeId: "e3", source: "assert", target: "end", sourceHandle: "pass" },
        ],
      })
      expect(output.status).toBe("passed")
      expect(output.nodeStatuses["assert"]).toBe("passed")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("signals ready before the trigger request, then completes when a finish rule matches", async () => {
    const { createServer } = await import("node:http")
    let listenerConnected = false
    let streamResponse: import("node:http").ServerResponse | undefined
    const server = createServer((request, response) => {
      if (request.url === "/events") {
        listenerConnected = true
        streamResponse = response
        response.writeHead(200, { "content-type": "text/event-stream" })
        response.flushHeaders()
        return
      }
      if (request.url === "/trigger") {
        response.writeHead(listenerConnected ? 204 : 500)
        response.end()
        streamResponse?.end("event: order.updated\ndata: {\"status\":\"complete\"}\n\n")
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      const output = await makeExecutor().executeWorkflow({
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "stream", type: "sse", config: { url: `http://127.0.0.1:${port}/events`, timeout: 0, finishConditions: [{ path: "data.status", operator: "equals", expectedValue: "complete" }] } },
          { nodeId: "trigger", type: "http-request", config: { method: "POST", url: `http://127.0.0.1:${port}/trigger` } },
          { nodeId: "assert", type: "assertion", config: { assertions: [{ source: "prev", path: "response.body.events[0].data", operator: "contains", expectedValue: "complete" }] } },
          { nodeId: "ready-end", type: "end" },
          { nodeId: "complete-end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "stream" },
          { edgeId: "e2", source: "stream", target: "trigger", sourceHandle: "ready" },
          { edgeId: "e3", source: "trigger", target: "ready-end" },
          { edgeId: "e4", source: "stream", target: "assert", sourceHandle: "complete" },
          { edgeId: "e5", source: "assert", target: "complete-end", sourceHandle: "pass" },
        ],
      })
      expect(listenerConnected).toBe(true)
      expect(output.status).toBe("passed")
      expect(output.nodeStatuses["trigger"]).toBe("passed")
      expect(output.nodeStatuses["assert"]).toBe("passed")
      expect(output.results.find((entry) => entry.nodeId === "stream")?.response).toMatchObject({ body: { termination: "finish-condition", eventCount: 1 } })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("settles the listener before snapshotting a failure on the ready path", async () => {
    const { createServer } = await import("node:http")
    const server = createServer((request, response) => {
      if (request.url === "/events") {
        response.writeHead(200, { "content-type": "text/event-stream" })
        response.flushHeaders()
        return
      }
      response.writeHead(500)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      const output = await makeExecutor().executeWorkflow({
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "stream", type: "sse", config: { url: `http://127.0.0.1:${port}/events` } },
          { nodeId: "trigger", type: "http-request", config: { method: "POST", url: `http://127.0.0.1:${port}/trigger` } },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "stream" },
          { edgeId: "e2", source: "stream", target: "trigger", sourceHandle: "ready" },
        ],
      })

      expect(output.status).toBe("failed")
      expect(output.nodeStatuses["stream"]).toBe("failed")
      expect(output.results.find((entry) => entry.nodeId === "stream")).toBeDefined()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
