import { afterEach, describe, expect, it } from "vitest"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { WebSocketServer, type WebSocket as ServerSocket } from "ws"
import { WorkflowExecutor, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"

function makeExecutor(secrets?: Record<string, string>): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({ clock, rng, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng), ...(secrets ? { secrets } : {}) })
}

function socketWorkflow(config: Record<string, unknown>): WorkflowGraph {
  return {
    nodes: [
      { nodeId: "start", type: "start" },
      { nodeId: "socket", type: "websocket", config: { timeout: 3, ...config } },
      { nodeId: "end", type: "end" },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "socket" },
      { edgeId: "e2", source: "socket", target: "end", sourceHandle: "complete" },
    ],
  }
}

interface Harness {
  readonly url: string
  readonly requests: IncomingMessage[]
  readonly received: Array<string | Buffer>
  readonly sockets: ServerSocket[]
}

const servers: Array<{ http: Server; wss: WebSocketServer }> = []

async function startServer(onConnection: (socket: ServerSocket, harness: Harness) => void, protocols = false): Promise<Harness> {
  const http = createServer()
  const wss = new WebSocketServer({
    server: http,
    ...(protocols ? { handleProtocols: (offered: Set<string>) => (offered.has("chat.v1") ? "chat.v1" : false) } : {}),
  })
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  servers.push({ http, wss })
  const harness: Harness = { url: `ws://127.0.0.1:${(http.address() as AddressInfo).port}`, requests: [], received: [], sockets: [] }
  wss.on("connection", (socket, request) => {
    harness.requests.push(request)
    harness.sockets.push(socket)
    socket.on("message", (data, isBinary) => harness.received.push(isBinary ? (data as Buffer) : data.toString()))
    onConnection(socket, harness)
  })
  return harness
}

afterEach(async () => {
  for (const { http, wss } of servers.splice(0)) {
    for (const client of wss.clients) client.terminate()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
})

const resultOf = (output: Awaited<ReturnType<WorkflowExecutor["executeWorkflow"]>>) => output.results.find((entry) => entry.nodeId === "socket")

describe("WorkflowExecutor — WebSocket node", () => {
  it("sends its messages after the handshake and collects text and binary frames", async () => {
    const server = await startServer((socket) => {
      socket.on("message", () => {
        socket.send("hello")
        socket.send(Buffer.from([1, 2, 3]))
      })
    })
    const output = await makeExecutor().executeWorkflow(socketWorkflow({
      url: server.url,
      maxMessages: 2,
      messages: [{ data: "ping", type: "text" }],
      extractors: { first: "response.body.messages[0].data" },
    }))
    expect(output.status).toBe("passed")
    expect(server.received).toEqual(["ping"])
    expect(resultOf(output)?.response).toMatchObject({
      statusCode: 101,
      body: {
        messageCount: 2,
        termination: "message-limit",
        messages: [{ type: "text", data: "hello" }, { type: "binary", data: Buffer.from([1, 2, 3]).toString("base64") }],
      },
    })
    expect(output.extractedVariables["first"]).toBe("hello")
  })

  it("sends binary messages from base64 and substitutes placeholders", async () => {
    const server = await startServer((socket) => socket.on("message", () => socket.send("ok")))
    const executor = makeExecutor()
    const workflow = socketWorkflow({
      url: server.url,
      messages: [{ data: Buffer.from([9, 8, 7]).toString("base64"), type: "binary" }, { data: "id-{{variables.id}}", type: "text" }],
    })
    const output = await executor.executeWorkflow({ ...workflow, variables: { id: "42" } })
    expect(output.status).toBe("passed")
    expect(Buffer.isBuffer(server.received[0])).toBe(true)
    expect([...(server.received[0] as Buffer)]).toEqual([9, 8, 7])
    expect(server.received[1]).toBe("id-42")
  })

  it("sends handshake headers, query parameters, subprotocols and auth", async () => {
    const server = await startServer((socket) => socket.send("hi"), true)
    const output = await makeExecutor({ TOKEN: "s3cret-token" }).executeWorkflow(socketWorkflow({
      url: server.url,
      headers: [{ key: "X-Trace", value: "abc" }],
      queryParams: [{ key: "topic", value: "orders" }],
      subprotocols: ["chat.v1"],
      auth: { type: "bearer", bearer: { token: "{{secrets.TOKEN}}" } },
    }))
    expect(output.status).toBe("passed")
    const request = server.requests[0]!
    expect(request.headers["x-trace"]).toBe("abc")
    expect(request.headers["authorization"]).toBe("Bearer s3cret-token")
    expect(request.headers["sec-websocket-protocol"]).toContain("chat.v1")
    expect(request.url).toBe("/?topic=orders")
  })

  it("closes on a finish rule, keeping the terminal message, and resolves JSONPath rules", async () => {
    const server = await startServer((socket) => {
      socket.send(JSON.stringify({ status: "pending" }))
      socket.send(JSON.stringify({ status: "complete", items: [{ id: 3 }] }))
      socket.send(JSON.stringify({ status: "after" }))
    })
    const rules = [
      { path: "data.status", operator: "equals", expectedValue: "complete" },
      { path: "$.data.status", operator: "equals", expectedValue: "complete" },
      // A non-singular query yields an array of every match.
      { path: "$.data.items[?@.id==3].id", operator: "count", expectedValue: 1 },
    ] as const
    for (const rule of rules) {
      const output = await makeExecutor().executeWorkflow(socketWorkflow({
        url: server.url,
        timeout: 0,
        maxMessages: 1,
        finishConditions: [rule],
      }))
      expect(output.status).toBe("passed")
      expect(resultOf(output)?.response).toMatchObject({ body: { termination: "finish-condition", messageCount: 1 } })
    }
  })

  it("fails when the socket closes before the limit and reports the close code", async () => {
    const server = await startServer((socket) => socket.close(4001, "bye"))
    const output = await makeExecutor().executeWorkflow(socketWorkflow({ url: server.url, maxMessages: 2, continueOnFail: true }))
    const result = resultOf(output)
    expect(output.nodeStatuses["socket"]).toBe("failed")
    expect(result?.error).toContain("0/2 captured matching message")
    expect(result?.response).toMatchObject({ body: { termination: "stream-ended", closeCode: 4001, closeReason: "bye" } })
  })

  it("fails the node when the timeout elapses with no message", async () => {
    const server = await startServer(() => undefined)
    const output = await makeExecutor().executeWorkflow(socketWorkflow({ url: server.url, timeout: 1, continueOnFail: true }))
    expect(resultOf(output)?.error).toContain("timed out")
    expect(output.status).toBe("failed")
  })

  it("fails the node when the connection is refused", async () => {
    const server = await startServer(() => undefined)
    const refused = server.url
    for (const entry of servers.splice(0)) {
      entry.wss.close()
      await new Promise<void>((resolve) => entry.http.close(() => resolve()))
    }
    const output = await makeExecutor().executeWorkflow(socketWorkflow({ url: refused, continueOnFail: true }))
    expect(output.status).toBe("failed")
    expect(resultOf(output)?.error).toBeTruthy()
  })

  it.each([
    ["an http URL", "http://127.0.0.1:1/socket"],
    ["a missing URL", ""],
  ])("rejects %s", async (_label, url) => {
    const output = await makeExecutor().executeWorkflow(socketWorkflow({ url, continueOnFail: true }))
    expect(output.status).toBe("failed")
    expect(resultOf(output)?.error).toMatch(/WebSocket/)
  })

  it("signals ready before the trigger, then completes through the Complete path to an assertion", async () => {
    let connected = false
    const server = await startServer((socket, harness) => {
      connected = true
      socket.on("close", () => harness.sockets.splice(0))
    })
    const http = createServer((request, response) => {
      response.writeHead(connected ? 204 : 500)
      response.end()
      for (const socket of server.sockets) socket.send(JSON.stringify({ status: "complete" }))
      void request
    })
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
    try {
      const triggerPort = (http.address() as AddressInfo).port
      const output = await makeExecutor().executeWorkflow({
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "socket", type: "websocket", config: { url: server.url, timeout: 0, finishConditions: [{ path: "data.status", operator: "equals", expectedValue: "complete" }] } },
          { nodeId: "trigger", type: "http-request", config: { method: "POST", url: `http://127.0.0.1:${triggerPort}/trigger` } },
          { nodeId: "assert", type: "assertion", config: { assertions: [{ source: "prev", path: "response.body.messages[0].data", operator: "contains", expectedValue: "complete" }] } },
          { nodeId: "ready-end", type: "end" },
          { nodeId: "complete-end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "socket" },
          { edgeId: "e2", source: "socket", target: "trigger", sourceHandle: "ready" },
          { edgeId: "e3", source: "trigger", target: "ready-end" },
          { edgeId: "e4", source: "socket", target: "assert", sourceHandle: "complete" },
          { edgeId: "e5", source: "assert", target: "complete-end", sourceHandle: "pass" },
        ],
      })
      expect(output.status).toBe("passed")
      expect(output.nodeStatuses["trigger"]).toBe("passed")
      expect(output.nodeStatuses["assert"]).toBe("passed")
    } finally {
      await new Promise<void>((resolve) => http.close(() => resolve()))
    }
  })

  it("closes the connection when the run is cancelled", async () => {
    let closed: () => void = () => undefined
    const serverClosed = new Promise<void>((resolve) => { closed = resolve })
    const server = await startServer((socket) => socket.on("close", () => closed()))
    const controller = new AbortController()
    const running = makeExecutor().executeWorkflow(
      socketWorkflow({ url: server.url, timeout: 0, finishConditions: [{ path: "data", operator: "equals", expectedValue: "never" }] }),
      { cancelSignal: controller.signal },
    )
    while (server.sockets.length === 0) await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    const output = await running
    await serverClosed
    expect(output.status).toBe("cancelled")
  })
})
