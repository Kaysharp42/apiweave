import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { HTTPNodeDataSchema } from "@shared/zod-schemas"
import { WorkflowExecutor, type WorkflowGraph, type WorkflowNode } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"

interface Received {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

/**
 * An in-process JSON-RPC 2.0 server. `respond` turns the parsed request into
 * the response body (and status) the server sends; `received` records every
 * request body so the test can assert on what was actually POSTed.
 */
async function startServer(
  respond: (request: Record<string, unknown>) => { status: number; body: unknown },
): Promise<{ server: Server; base: string; received: Received[] }> {
  const received: Received[] = []
  const server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      received.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body })
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(body) as Record<string, unknown>
      } catch {
        // respond with an empty request for a body that is not JSON
      }
      const result = respond(parsed)
      response.writeHead(result.status, { "Content-Type": "application/json" })
      response.end(JSON.stringify(result.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${port}`, received }
}

function makeExecutor(): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({ clock, rng, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng) })
}

function chain(...nodes: WorkflowNode[]): WorkflowGraph {
  const all: WorkflowNode[] = [{ nodeId: "start", type: "start" }, ...nodes, { nodeId: "end", type: "end" }]
  return {
    nodes: all,
    edges: all.slice(1).map((node, index) => ({ edgeId: `e${index}`, source: all[index]!.nodeId, target: node.nodeId })),
  }
}

const SUBTRACT = (request: Record<string, unknown>) => {
  const params = request["params"] as [number, number]
  return { status: 200, body: { jsonrpc: "2.0", result: params[0]! - params[1]!, id: request["id"] } }
}

describe("WorkflowExecutor — JSON-RPC bodies", () => {
  let server: Server | undefined
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
  })

  it("POSTs {jsonrpc, method, params, id} as application/json, params a JSON template", async () => {
    const api = await startServer(SUBTRACT)
    server = api.server
    const config = {
      method: "POST",
      url: `${api.base}/rpc`,
      bodyType: "jsonrpc",
      jsonrpc: { method: "subtract", params: "[{{variables.a}}, {{variables.b}}]" },
    }
    expect(HTTPNodeDataSchema.safeParse(config).success).toBe(true)
    const output = await makeExecutor().executeWorkflow({
      ...chain({ nodeId: "rpc", type: "http-request", config }),
      variables: { a: 42, b: 23 },
    })

    expect(output.nodeStatuses["rpc"]).toBe("passed")
    const sent = JSON.parse(api.received[0]!.body) as Record<string, unknown>
    expect(sent).toEqual({ jsonrpc: "2.0", method: "subtract", params: [42, 23], id: 1 })
    expect(api.received[0]!.headers["content-type"]).toBe("application/json")
    expect(output.results[0]!.response?.body).toEqual({ jsonrpc: "2.0", result: 19, id: 1 })
  })

  it("sends params by name as an object and increments the id per request within the run", async () => {
    const api = await startServer((request) => {
      const params = request["params"] as { readonly minuend: number; readonly subtrahend: number }
      return { status: 200, body: { jsonrpc: "2.0", result: params.minuend - params.subtrahend, id: request["id"] } }
    })
    server = api.server
    const rpc = (nodeId: string, a: number, b: number): WorkflowNode => ({
      nodeId,
      type: "http-request",
      config: {
        method: "POST",
        url: `${api.base}/rpc`,
        bodyType: "jsonrpc",
        jsonrpc: { method: "subtract", params: `{"minuend": {{variables.a}}, "subtrahend": ${b}}` },
      },
    })
    const output = await makeExecutor().executeWorkflow({
      ...chain(rpc("first", 42, 23), rpc("second", 7, 3)),
      variables: { a: 42 },
    })

    expect(output.nodeStatuses["first"]).toBe("passed")
    expect(output.nodeStatuses["second"]).toBe("passed")
    expect(JSON.parse(api.received[0]!.body)["id"]).toBe(1)
    expect(JSON.parse(api.received[1]!.body)["id"]).toBe(2)
  })

  it("omits the id for a notification", async () => {
    const api = await startServer((request) => ({ status: 200, body: { jsonrpc: "2.0", result: null, id: request["id"] ?? null } }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(
      chain({
        nodeId: "notify",
        type: "http-request",
        config: {
          method: "POST",
          url: `${api.base}/rpc`,
          bodyType: "jsonrpc",
          jsonrpc: { method: "log", params: '["hello"]', notification: true },
        },
      }),
    )

    expect(output.nodeStatuses["notify"]).toBe("passed")
    const sent = JSON.parse(api.received[0]!.body) as Record<string, unknown>
    expect(sent).toEqual({ jsonrpc: "2.0", method: "log", params: ["hello"] })
    expect("id" in sent).toBe(false)
  })

  it("fails the node on an error member, naming the code and message", async () => {
    const api = await startServer(() => ({ status: 200, body: { jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id: 1 } }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(
      chain({
        nodeId: "rpc",
        type: "http-request",
        config: { method: "POST", url: `${api.base}/rpc`, bodyType: "jsonrpc", jsonrpc: { method: "missing" } },
      }),
    )

    expect(output.status).toBe("failed")
    expect(output.nodeStatuses["rpc"]).toBe("failed")
    expect(output.results[0]!.error).toBe("JSON-RPC error -32601: Method not found")
  })

  it("treats a JSON-RPC error as success when allowRpcError is set", async () => {
    const api = await startServer(() => ({ status: 200, body: { jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id: 1 } }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(
      chain({
        nodeId: "rpc",
        type: "http-request",
        config: {
          method: "POST",
          url: `${api.base}/rpc`,
          bodyType: "jsonrpc",
          jsonrpc: { method: "missing" },
          allowRpcError: true,
        },
      }),
    )

    expect(output.nodeStatuses["rpc"]).toBe("passed")
    expect(output.results[0]!.response?.body).toEqual({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id: 1 })
  })

  it("lets continueOnFail carry the run past a JSON-RPC error", async () => {
    const api = await startServer(() => ({ status: 200, body: { jsonrpc: "2.0", error: { code: -32000, message: "boom" }, id: 1 } }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(
      chain(
        {
          nodeId: "rpc",
          type: "http-request",
          config: { method: "POST", url: `${api.base}/rpc`, bodyType: "jsonrpc", jsonrpc: { method: "missing" }, continueOnFail: true },
        },
        { nodeId: "after", type: "http-request", config: { method: "GET", url: `${api.base}/ok` } },
      ),
    )

    expect(output.status).toBe("failed")
    expect(output.nodeStatuses["rpc"]).toBe("failed")
    expect(output.nodeStatuses["after"]).toBe("passed")
  })

  it("fails the node without sending when params are not JSON or not an object/array", async () => {
    const api = await startServer(SUBTRACT)
    server = api.server
    for (const bad of ["{oops", '"just a string"', "42"]) {
      const output = await makeExecutor().executeWorkflow(
        chain({
          nodeId: "rpc",
          type: "http-request",
          config: { method: "POST", url: `${api.base}/rpc`, bodyType: "jsonrpc", jsonrpc: { method: "subtract", params: bad } },
        }),
      )
      expect(output.results[0]!.error).toMatch(/^Failed to build request body: Error: JSON-RPC params (are not valid JSON|must be a JSON object or array)$/)
    }
    expect(api.received).toHaveLength(0)
  })

  it("fails the node without sending when the method is empty", async () => {
    const api = await startServer(SUBTRACT)
    server = api.server
    const output = await makeExecutor().executeWorkflow(
      chain({
        nodeId: "rpc",
        type: "http-request",
        config: { method: "POST", url: `${api.base}/rpc`, bodyType: "jsonrpc", jsonrpc: { method: "  " } },
      }),
    )
    expect(output.results[0]!.error).toBe("Failed to build request body: Error: JSON-RPC method is required")
    expect(api.received).toHaveLength(0)
  })
})
