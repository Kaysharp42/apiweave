import { afterEach, describe, expect, it } from "vitest"
import { WorkflowExecutor, type ExecutorOutput, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { createSecretMasker } from "../secret_masker"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { startGrpcServer, TEST_PROTO_FILES, type TestGrpcServer } from "./grpc_test_server"
import { fixture } from "./network_test_servers"

let server: TestGrpcServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

function executor(extra: { http?: SafeHttp; secrets?: Record<string, string> } = {}): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({ clock, rng, http: extra.http ?? new SafeHttp(), functions: new DynamicFunctions(clock, rng), ...(extra.secrets ? { secrets: extra.secrets } : {}) })
}

function workflow(config: Record<string, unknown>, variables: Record<string, unknown> = {}): WorkflowGraph {
  return {
    variables,
    nodes: [
      { nodeId: "start", type: "start" },
      { nodeId: "rpc", type: "grpc", config: { service: "shop.Orders", method: "GetOrder", schemaSource: "proto", protoFiles: TEST_PROTO_FILES, ...config } },
      { nodeId: "end", type: "end" },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "rpc" },
      { edgeId: "e2", source: "rpc", target: "end" },
    ],
  }
}

const resultOf = (output: ExecutorOutput) => output.results.find((result) => result.nodeId === "rpc")! as Record<string, any>

describe("WorkflowExecutor — gRPC node", () => {
  it("calls a unary method and exposes body, status, headers and trailers to extractors", async () => {
    server = await startGrpcServer()
    const output = await executor().executeWorkflow(workflow({
      target: server.target,
      message: '{"order_id": "{{variables.id}}"}',
      extractors: { orderId: "response.body.order_id", cents: "$.response.body.total.cents", trailer: "response.trailers.x-trailer", code: "response.status" },
    }, { id: "o-42" }))
    expect(output.status).toBe("passed")
    const result = resultOf(output)
    expect(result.response).toMatchObject({ status: "OK", statusCode: 0, statusMessage: "OK", body: { order_id: "o-42", total: { currency: "EUR", cents: "9007199254740993" } } })
    expect(result.response.headers["x-server"]).toBe("test")
    expect(output.extractedVariables).toMatchObject({ orderId: "o-42", cents: "9007199254740993", trailer: "done", code: "OK" })
  })

  it("fails the node on a non-OK status, naming the code and message", async () => {
    server = await startGrpcServer()
    const output = await executor().executeWorkflow(workflow({ target: server.target, message: '{"order_id": "missing"}' }))
    expect(output.status).toBe("failed")
    expect(resultOf(output)).toMatchObject({ status: "failed", error: "gRPC shop.Orders/GetOrder returned NOT_FOUND: no such order", response: { status: "NOT_FOUND", statusCode: 5 } })
  })

  it("passes a non-OK status that is the expectedStatus, and fails an OK one when another is expected", async () => {
    server = await startGrpcServer()
    const negative = await executor().executeWorkflow(workflow({ target: server.target, message: '{"order_id": "missing"}', expectedStatus: "NOT_FOUND" }))
    expect(negative.status).toBe("passed")
    const wrong = await executor().executeWorkflow(workflow({ target: server.target, message: '{"order_id": "o1"}', expectedStatus: "NOT_FOUND" }))
    expect(wrong.status).toBe("failed")
    expect(resultOf(wrong).error).toContain("returned OK (expected NOT_FOUND)")
  })

  it("continues past a failed call with continueOnFail", async () => {
    server = await startGrpcServer()
    const output = await executor().executeWorkflow(workflow({ target: server.target, message: '{"order_id": "missing"}', continueOnFail: true }))
    expect(output.nodeStatuses["end"]).toBe("passed")
    expect(output.failedNodes).toContain("rpc")
  })

  it("sends metadata and bearer auth, and a secret in either is masked in what the run stores", async () => {
    server = await startGrpcServer()
    const output = await executor({ secrets: { TOKEN: "s3cret-token" } }).executeWorkflow(workflow({
      target: server.target,
      message: '{"order_id": "o1"}',
      metadata: [{ key: "X-Trace", value: "{{secrets.TOKEN}}" }],
      auth: { type: "bearer", bearer: { token: "{{secrets.TOKEN}}" } },
    }))
    expect(server.lastMetadata()).toMatchObject({ "x-trace": "s3cret-token", authorization: "Bearer s3cret-token" })
    const result = resultOf(output)
    expect(result.secretRefs).toEqual(["TOKEN"])
    const stored = JSON.stringify(createSecretMasker(new Set(["s3cret-token"]))(output.results))
    expect(stored).not.toContain("s3cret-token")
    expect(stored).toContain("<SECRET>")
  })

  it("discovers the schema by reflection at run time", async () => {
    server = await startGrpcServer({ reflection: true })
    const output = await executor().executeWorkflow(workflow({ target: server.target, schemaSource: "reflection", protoFiles: undefined, message: '{"order_id": "r1"}' }))
    expect(output.status).toBe("passed")
    expect(resultOf(output).response.body.order_id).toBe("r1")
  })

  it("uses the network settings' CA for TLS, and sslVerify off for an untrusted server", async () => {
    server = await startGrpcServer({ tls: { requireClientCert: false } })
    const trusted = new SafeHttp({ network: { ca: [fixture("ca.pem").toString()] } })
    expect((await executor({ http: trusted }).executeWorkflow(workflow({ target: server.target, tls: true, message: '{"order_id": "o1"}' }))).status).toBe("passed")
    expect((await executor().executeWorkflow(workflow({ target: server.target, tls: true, message: '{"order_id": "o1"}' }))).status).toBe("failed")
    expect((await executor().executeWorkflow(workflow({ target: server.target, tls: true, sslVerify: false, message: '{"order_id": "o1"}' }))).status).toBe("passed")
  })

  it("fails with a readable error for bad config", async () => {
    server = await startGrpcServer()
    const error = async (config: Record<string, unknown>): Promise<string> => resultOf(await executor().executeWorkflow(workflow(config))).error
    expect(await error({ target: "" })).toMatch(/Target is required/)
    expect(await error({ target: server.target, message: "{nope" })).toMatch(/not valid JSON/)
    expect(await error({ target: server.target, method: "Watch" })).toMatch(/streaming/)
    expect(await error({ target: server.target, method: "Nope" })).toMatch(/not in service/)
    expect(await error({ target: server.target, protoFiles: { "a.proto": "garbage" } })).toMatch(/a\.proto/)
    expect(await error({ target: server.target, auth: { type: "digest", digest: { username: "u", password: "" } } })).toMatch(/not supported on gRPC/)
  })

  it("refuses a target outside the hosts an agent run was allowed to reach", async () => {
    server = await startGrpcServer()
    const restricted = new SafeHttp().restrictedTo(["api.example.com:50051"])
    const output = await executor({ http: restricted }).executeWorkflow(workflow({ target: server.target, message: "{}" }))
    expect(resultOf(output).error).toMatch(/not among the hosts this run was allowed to reach/)
  })

  it("is stopped by the run's cancel signal", async () => {
    server = await startGrpcServer()
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const output = await executor().executeWorkflow(workflow({ target: server.target, message: '{"order_id": "slow"}' }), { cancelSignal: controller.signal })
    expect(output.status).toBe("cancelled")
  })
})
