import * as grpc from "@grpc/grpc-js"
import { ReflectionService } from "@grpc/reflection"
import { schemaFromProtoFiles } from "../grpc_schema"
import { fixture } from "./network_test_servers"

/** The proto the tests serve and call. `common.proto` is imported to exercise multi-file schemas. */
export const TEST_PROTO_FILES: Readonly<Record<string, string>> = {
  "shop/common.proto": `
    syntax = "proto3";
    package shop;
    enum Currency { USD = 0; EUR = 1; }
    message Money { Currency currency = 1; int64 cents = 2; }
  `,
  "shop/orders.proto": `
    syntax = "proto3";
    package shop;
    import "shop/common.proto";
    message GetOrderRequest { string order_id = 1; repeated string tags = 2; map<string, string> labels = 3; bytes token = 4; }
    message Order { string order_id = 1; Money total = 2; string caller = 3; string trace = 4; repeated string tags = 5; bytes token = 6; }
    message WatchRequest { string order_id = 1; }
    service Orders {
      rpc GetOrder(GetOrderRequest) returns (Order);
      rpc Watch(WatchRequest) returns (stream Order);
    }
  `,
}

export interface TestGrpcServer {
  readonly target: string
  /** The metadata of the last GetOrder call, as the server saw it. */
  lastMetadata(): Record<string, string>
  close(): Promise<void>
}

/** A real @grpc/grpc-js server: `shop.Orders/GetOrder`, with server reflection (v1 and v1alpha) when `reflection` is set. */
export async function startGrpcServer(options: { reflection?: boolean; tls?: { requireClientCert: boolean } } = {}): Promise<TestGrpcServer> {
  const schema = schemaFromProtoFiles(TEST_PROTO_FILES)
  const server = new grpc.Server()
  let seen: Record<string, string> = {}
  server.addService(schema.definition["shop.Orders"] as grpc.ServiceDefinition, {
    getOrder: (call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      seen = Object.fromEntries(Object.entries(call.metadata.getMap()).map(([key, value]) => [key, String(value)]))
      const orderId = String(call.request["order_id"])
      if (orderId === "missing") return callback({ code: grpc.status.NOT_FOUND, details: "no such order", metadata: trailers() })
      if (orderId === "slow") return void setTimeout(() => callback(null, { order_id: orderId }), 2_000)
      call.sendMetadata(headers())
      callback(
        null,
        { order_id: orderId, total: { currency: "EUR", cents: "9007199254740993" }, caller: seen["authorization"] ?? "", trace: seen["x-trace"] ?? "", tags: call.request["tags"], token: call.request["token"] },
        trailers(),
      )
    },
    watch: (call: grpc.ServerWritableStream<unknown, unknown>) => {
      const orderId = String(call.request["order_id"])
      if (orderId === "missing") {
        // grpc-js turns a stream handler's emitted error into the call's status on end().
        call.emit("error", { code: grpc.status.NOT_FOUND, details: "no such order", metadata: trailers() })
        call.end()
        return
      }
      call.sendMetadata(headers())
      // `many` streams five orders so the message limit can close a call early;
      // any other id streams three so a stream can also run to its natural end.
      const count = orderId === "many" ? 5 : 3
      for (let index = 1; index <= count; index++) {
        call.write({ order_id: `${orderId}-${index}`, total: { currency: "EUR", cents: String(index * 100) } })
      }
      call.end(trailers())
    },
  })
  if (options.reflection) new ReflectionService(schema.definition).addToServer(server)
  const credentials = options.tls
    ? grpc.ServerCredentials.createSsl(fixture("ca.pem"), [{ private_key: fixture("server.key"), cert_chain: fixture("server.pem") }], options.tls.requireClientCert)
    : grpc.ServerCredentials.createInsecure()
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", credentials, (error, bound) => (error ? reject(error) : resolve(bound)))
  })
  return {
    target: `127.0.0.1:${port}`,
    lastMetadata: () => seen,
    close: () => new Promise((resolve) => server.tryShutdown(() => resolve())),
  }
}

function headers(): grpc.Metadata {
  const metadata = new grpc.Metadata()
  metadata.set("x-server", "test")
  return metadata
}

function trailers(): grpc.Metadata {
  const metadata = new grpc.Metadata()
  metadata.set("x-trailer", "done")
  return metadata
}
