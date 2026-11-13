import { afterEach, describe, expect, it } from "vitest"
import { WorkflowExecutor, type ExecutorOutput, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { startGrpcServer, TEST_PROTO_FILES, type TestGrpcServer } from "./grpc_test_server"

let server: TestGrpcServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

function executor(): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({ clock, rng, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng) })
}

/** A server-streaming call whose Ready and Complete outputs each lead to their own end node. */
function workflow(config: Record<string, unknown>): WorkflowGraph {
  return {
    nodes: [
      { nodeId: "start", type: "start" },
      { nodeId: "watch", type: "grpc", config: { callType: "server-streaming", service: "shop.Orders", method: "Watch", schemaSource: "proto", protoFiles: TEST_PROTO_FILES, message: '{"order_id": "o1"}', ...config } },
      { nodeId: "ready-end", type: "end" },
      { nodeId: "complete-end", type: "end" },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "watch" },
      { edgeId: "e2", source: "watch", target: "ready-end", sourceHandle: "ready" },
      { edgeId: "e3", source: "watch", target: "complete-end", sourceHandle: "complete" },
    ],
  }
}

interface StreamResult {
  readonly status: string
  readonly error?: string
  readonly duration: number
  readonly response: {
    readonly status: string
    readonly statusCode: number
    readonly statusMessage: string
    readonly headers: Record<string, string>
    readonly trailers: Record<string, string>
    readonly body: {
      readonly messages: readonly { readonly order_id: string }[]
      readonly messageCount: number
      readonly termination: string
      readonly status: string
    }
  }
}

const resultOf = (output: ExecutorOutput): StreamResult => output.results.find((result) => result.nodeId === "watch")! as unknown as StreamResult

describe("WorkflowExecutor — gRPC server streaming", () => {
  it("collects every response until the server ends the stream, and fires Ready then Complete", async () => {
    server = await startGrpcServer()
    const output = await executor().executeWorkflow(workflow({ target: server.target }))
    expect(output.status).toBe("passed")
    const result = resultOf(output)
    expect(result.response.body.messages.map((message) => message.order_id)).toEqual(["o1-1", "o1-2", "o1-3"])
    expect(result.response.body).toMatchObject({ messageCount: 3, termination: "stream-ended", status: "OK" })
    expect(result.response).toMatchObject({ status: "OK", statusCode: 0, statusMessage: "OK" })
    expect(result.response.headers["x-server"]).toBe("test")
    expect(result.response.trailers["x-trailer"]).toBe("done")
    expect(output.nodeStatuses["ready-end"]).toBe("passed")
    expect(output.nodeStatuses["complete-end"]).toBe("passed")
  })

  it("closes the call on a finish rule and keeps the terminal message", async () => {
    server = await startGrpcServer()
    const output = await executor().executeWorkflow(workflow({
      target: server.target,
      message: '{"order_id": "many"}',
      finishConditions: [{ path: "order_id", operator: "equals", expectedValue: "many-2" }],
    }))
    expect(output.status).toBe("passed")
    const result = resultOf(output)
    expect(result.response.body).toMatchObject({ messageCount: 2, termination: "finish-condition" })
  })

  it("retains at most maxMessages and reports the message limit", async () => {
    server = await startGrpcServer()
    const output = await executor().executeWorkflow(workflow({ target: server.target, message: '{"order_id": "many"}', maxMessages: 2 }))
    expect(output.status).toBe("passed")
    expect(resultOf(output).response.body).toMatchObject({ messageCount: 2, termination: "message-limit" })
  })

  it("fails the node on an unexpected non-OK status, naming the code and message", async () => {
    server = await startGrpcServer()
    const output = await executor().executeWorkflow(workflow({ target: server.target, message: '{"order_id": "missing"}' }))
    expect(output.status).toBe("failed")
    expect(resultOf(output).error).toBe("gRPC shop.Orders/Watch returned NOT_FOUND: no such order")
  })

  it("passes a non-OK status that is the expectedStatus", async () => {
    server = await startGrpcServer()
    const output = await executor().executeWorkflow(workflow({ target: server.target, message: '{"order_id": "missing"}', expectedStatus: "NOT_FOUND" }))
    expect(output.status).toBe("passed")
    expect(resultOf(output).response).toMatchObject({ status: "NOT_FOUND", statusCode: 5 })
  })

  it("captures extractors from the collected responses", async () => {
    server = await startGrpcServer()
    const output = await executor().executeWorkflow(workflow({
      target: server.target,
      extractors: { first: "response.body.messages[0].order_id", count: "response.body.messageCount", lastId: "$.response.body.messages[-1].order_id" },
    }))
    expect(output.status).toBe("passed")
    expect(output.extractedVariables).toMatchObject({ first: "o1-1", count: 3, lastId: "o1-3" })
  })

  it("fails a unary node pointed at a server-streaming method, and a streaming node at a unary one", async () => {
    server = await startGrpcServer()
    const unary = await executor().executeWorkflow({
      nodes: [
        { nodeId: "start", type: "start" },
        { nodeId: "watch", type: "grpc", config: { service: "shop.Orders", method: "Watch", schemaSource: "proto", protoFiles: TEST_PROTO_FILES, target: server.target, message: "{}" } },
        { nodeId: "end", type: "end" },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "watch" },
        { edgeId: "e2", source: "watch", target: "end" },
      ],
    })
    expect(unary.status).toBe("failed")
    expect(String((unary.results[0] as unknown as { error: string }).error)).toContain("streaming method")

    const streaming = await executor().executeWorkflow(workflow({ target: server.target, method: "GetOrder" }))
    expect(streaming.status).toBe("failed")
    expect(resultOf(streaming).error).toContain('is a unary method; use callType "unary"')
  })
})
