import { afterEach, describe, expect, it } from "vitest"
import { IpcRouter } from "../../router"
import { registerAllHandlers, type HandlerDeps } from ".."
import { MCP_TOOLS } from "../../../mcp/tools"
import { startGrpcServer, TEST_PROTO_FILES, type TestGrpcServer } from "../../../runner/__tests__/grpc_test_server"

let server: TestGrpcServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

// Only the grpc domain is exercised; the other services are never reached.
const router = new IpcRouter()
registerAllHandlers(router, {} as HandlerDeps)

const discover = (payload: unknown) => router.dispatch({ domain: "grpc", action: "discover", payload }, { redactSecrets: true })

describe("grpc.discover", () => {
  it("is published to agents as a read-only tool", () => {
    const spec = MCP_TOOLS.find((tool) => tool.domain === "grpc" && tool.action === "discover")
    expect(spec).toMatchObject({ intent: "read" })
    expect(spec?.destructive).toBeUndefined()
  })

  it("lists inline .proto services with request skeletons", async () => {
    const result = await discover({ schemaSource: "proto", protoFiles: TEST_PROTO_FILES })
    expect(result).toMatchObject({ ok: true, data: { services: [{ name: "shop.Orders", methods: [{ name: "GetOrder" }, { name: "Watch" }] }] } })
  })

  it("lists a server's services through reflection", async () => {
    server = await startGrpcServer({ reflection: true })
    const result = await discover({ schemaSource: "reflection", target: server.target })
    expect(result).toMatchObject({ ok: true, data: { services: [{ name: "shop.Orders" }] } })
  })

  it("rejects reflection without a target, and reports an unusable schema as a validation error", async () => {
    expect(await discover({ schemaSource: "reflection" })).toMatchObject({ ok: false, error: { code: "validation" } })
    expect(await discover({ schemaSource: "proto", protoFiles: { "a.proto": "garbage" } })).toMatchObject({ ok: false, error: { code: "validation", message: expect.stringContaining("a.proto") } })
    server = await startGrpcServer()
    expect(await discover({ schemaSource: "reflection", target: server.target })).toMatchObject({ ok: false, error: { code: "validation", message: expect.stringContaining("Reflection failed") } })
  })
})
