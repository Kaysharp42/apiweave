import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { callUnary, loadGrpcSchema, type GrpcConnection } from "../grpc"
import { describeSchema, GrpcSchemaError, schemaFromProtoFiles } from "../grpc_schema"
import { NetworkDispatchers } from "../network"
import { startGrpcServer, TEST_PROTO_FILES, type TestGrpcServer } from "./grpc_test_server"
import { fixture, fixturePath } from "./network_test_servers"
import { loadClientCertificate } from "../network"

let server: TestGrpcServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const network = new NetworkDispatchers()
const plain = (target: string): GrpcConnection => ({ target, tls: false, sslVerify: true, tlsOptionsFor: (url, verify) => network.tlsOptionsFor(url, verify) })

describe("gRPC schema from inline .proto files", () => {
  it("lists services and methods with request skeletons, resolving imports between files", () => {
    const described = describeSchema(schemaFromProtoFiles(TEST_PROTO_FILES))
    expect(described.services).toHaveLength(1)
    const orders = described.services[0]!
    expect(orders.name).toBe("shop.Orders")
    expect(orders.methods.map((method) => [method.name, method.requestType, method.responseStreaming])).toEqual([
      ["GetOrder", "shop.GetOrderRequest", false],
      ["Watch", "shop.WatchRequest", true],
    ])
    expect(JSON.parse(orders.methods[0]!.requestSkeleton)).toEqual({ order_id: "", tags: [], labels: {}, token: "" })
  })

  it("reports a missing import and a syntax error by file", () => {
    expect(() => schemaFromProtoFiles({ "a.proto": 'syntax = "proto3"; import "b.proto";' })).toThrow(/imported file "b.proto"/)
    expect(() => schemaFromProtoFiles({ "a.proto": "this is not proto" })).toThrow(/a\.proto/)
    expect(() => schemaFromProtoFiles({})).toThrow(GrpcSchemaError)
  })

  it("provides Google's well-known types to imports", () => {
    const schema = schemaFromProtoFiles({
      "t.proto": 'syntax = "proto3"; import "google/protobuf/timestamp.proto"; message M { google.protobuf.Timestamp at = 1; } service S { rpc Get(M) returns (M); }',
    })
    expect(JSON.parse(describeSchema(schema).services[0]!.methods[0]!.requestSkeleton)).toEqual({ at: { seconds: "0", nanos: 0 } })
  })
})

describe("gRPC reflection", () => {
  it("discovers the same services as the inline schema, v1 first, and hides the reflection service", async () => {
    server = await startGrpcServer({ reflection: true })
    const discovered = describeSchema(await loadGrpcSchema(plain(server.target), { kind: "reflection" }))
    expect(discovered).toEqual(describeSchema(schemaFromProtoFiles(TEST_PROTO_FILES)))
  })

  it("explains a server without reflection", async () => {
    server = await startGrpcServer()
    await expect(loadGrpcSchema(plain(server.target), { kind: "reflection" })).rejects.toThrow(/Reflection failed/)
  })

  it("calls through a reflected schema", async () => {
    server = await startGrpcServer({ reflection: true })
    const schema = await loadGrpcSchema(plain(server.target), { kind: "reflection" })
    const response = await callUnary({ connection: plain(server.target), schema, service: "shop.Orders", method: "GetOrder", message: { order_id: "o1", labels: { a: "b" } }, metadata: {}, deadlineMs: 5_000 })
    expect(response).toMatchObject({ code: 0, codeName: "OK", body: { order_id: "o1" } })
  })
})

describe("gRPC unary calls", () => {
  beforeEach(async () => {
    server = await startGrpcServer()
  })
  const schema = schemaFromProtoFiles(TEST_PROTO_FILES)
  const call = (message: unknown, metadata: Record<string, string> = {}, extra: { deadlineMs?: number; signal?: AbortSignal } = {}) =>
    callUnary({ connection: plain(server!.target), schema, service: "shop.Orders", method: "GetOrder", message, metadata, deadlineMs: extra.deadlineMs ?? 5_000, signal: extra.signal })

  it("decodes longs as strings and enums as names, with headers and trailers", async () => {
    const response = await call({ order_id: "o1", tags: ["a", "b"], token: "AQID" }, { "x-trace": "t-1", authorization: "Bearer abc" })
    expect(response.body).toEqual({ order_id: "o1", total: { currency: "EUR", cents: "9007199254740993" }, caller: "Bearer abc", trace: "t-1", tags: ["a", "b"], token: "AQID" })
    expect(response.headers["x-server"]).toBe("test")
    expect(response.trailers["x-trailer"]).toBe("done")
    expect(server!.lastMetadata()["x-trace"]).toBe("t-1")
  })

  it("returns a non-OK status as a result", async () => {
    expect(await call({ order_id: "missing" })).toMatchObject({ code: 5, codeName: "NOT_FOUND", statusMessage: "no such order", body: undefined, trailers: { "x-trailer": "done" } })
  })

  it("ends at the deadline with DEADLINE_EXCEEDED", async () => {
    expect(await call({ order_id: "slow" }, {}, { deadlineMs: 100 })).toMatchObject({ codeName: "DEADLINE_EXCEEDED" })
  })

  it("is cancelled by the abort signal", async () => {
    const controller = new AbortController()
    const pending = call({ order_id: "slow" }, {}, { signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    expect(await pending).toMatchObject({ codeName: "CANCELLED" })
  })

  it("refuses a streaming method, an unknown method and a message that does not fit", async () => {
    const run = (method: string, message: unknown) => callUnary({ connection: plain(server!.target), schema, service: "shop.Orders", method, message, metadata: {}, deadlineMs: 1_000 })
    await expect(run("Watch", {})).rejects.toThrow(/streaming/)
    await expect(run("Nope", {})).rejects.toThrow(/not in service/)
    await expect(run("GetOrder", { tags: "not-an-array" })).rejects.toThrow(/does not match/)
  })

  it("reports an unreachable server as UNAVAILABLE", async () => {
    expect(await callUnary({ connection: plain("127.0.0.1:1"), schema, service: "shop.Orders", method: "GetOrder", message: {}, metadata: {}, deadlineMs: 2_000 })).toMatchObject({ codeName: "UNAVAILABLE" })
  })
})

describe("gRPC over TLS", () => {
  const schema = schemaFromProtoFiles(TEST_PROTO_FILES)
  const secure = (target: string, config: ConstructorParameters<typeof NetworkDispatchers>[0], sslVerify = true): GrpcConnection => {
    const dispatchers = new NetworkDispatchers(config)
    return { target, tls: true, sslVerify, tlsOptionsFor: (url, verify) => dispatchers.tlsOptionsFor(url, verify) }
  }
  const run = (connection: GrpcConnection) => callUnary({ connection, schema, service: "shop.Orders", method: "GetOrder", message: { order_id: "o1" }, metadata: {}, deadlineMs: 3_000 })

  it("trusts the CA from the network settings, and refuses an untrusted server unless sslVerify is off", async () => {
    server = await startGrpcServer({ tls: { requireClientCert: false } })
    expect(await run(secure(server.target, { ca: [fixture("ca.pem").toString()] }))).toMatchObject({ codeName: "OK" })
    expect(await run(secure(server.target, {}))).toMatchObject({ codeName: "UNAVAILABLE" })
    expect(await run(secure(server.target, {}, false))).toMatchObject({ codeName: "OK" })
  })

  it("presents the client certificate configured for the host", async () => {
    server = await startGrpcServer({ tls: { requireClientCert: true } })
    const ca = [fixture("ca.pem").toString()]
    expect(await run(secure(server.target, { ca }))).toMatchObject({ codeName: "UNAVAILABLE" })
    const certificate = loadClientCertificate({ host: "127.0.0.1", certFile: fixturePath("client.pem"), keyFile: fixturePath("client.key") })
    expect(await run(secure(server.target, { ca, clientCertificates: [certificate] }))).toMatchObject({ codeName: "OK" })
  })
})
