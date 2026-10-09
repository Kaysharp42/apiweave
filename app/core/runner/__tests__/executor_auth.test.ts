import { afterEach, describe, expect, it } from "vitest"
import { HTTPNodeDataSchema } from "@shared/zod-schemas"
import { WorkflowExecutor, type WorkflowGraph, type WorkflowNode } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { AWS_ACCESS_KEY_ID, AWS_SECRET, startServer as startTestServer, verifyAwsSignature, type Handler, type TestServer } from "./auth_test_servers"

let server: TestServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function startServer(handler: Handler): Promise<TestServer> {
  server = await startTestServer(handler)
  return server
}

function makeExecutor(secrets: Record<string, string> = {}, masked: string[] = []): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({
    clock,
    rng,
    http: new SafeHttp(),
    functions: new DynamicFunctions(clock, rng),
    secrets,
    environmentVariables: { KEY_ID: AWS_ACCESS_KEY_ID },
    maskValue: (value) => masked.push(value),
  })
}

/** The http node's result, with its response status lifted out. */
function callResult(output: Awaited<ReturnType<WorkflowExecutor["executeWorkflow"]>>) {
  const result = output.results.find((entry) => entry.nodeId === "call")!
  return { ...result, statusCode: (result.response as { statusCode?: number } | null)?.statusCode }
}

function chain(...nodes: WorkflowNode[]): WorkflowGraph {
  const all: WorkflowNode[] = [{ nodeId: "start", type: "start" }, ...nodes, { nodeId: "end", type: "end" }]
  return {
    nodes: all,
    edges: all.slice(1).map((node, index) => ({ edgeId: `e${index}`, source: all[index]!.nodeId, target: node.nodeId })),
  }
}

function httpNode(config: Record<string, unknown>): WorkflowNode {
  HTTPNodeDataSchema.parse(config)
  return { nodeId: "call", type: "http-request", config }
}

// -------------------- AWS Signature V4 --------------------

const awsAuth = {
  type: "awsSigV4",
  awsSigV4: {
    accessKeyId: "{{env.KEY_ID}}",
    secretAccessKey: "{{secrets.AWS_SECRET}}",
    sessionToken: "{{secrets.AWS_TOKEN}}",
    region: "eu-west-1",
    service: "execute-api",
  },
}

describe("WorkflowExecutor — AWS Signature V4", () => {
  const secrets = { AWS_SECRET, AWS_TOKEN: "session-token-value" }

  async function run(config: Record<string, unknown>, handler: Handler = verifyAwsSignature, runSecrets: Record<string, string> = secrets) {
    const api = await startServer(handler)
    const executor = makeExecutor(runSecrets)
    const output = await executor.executeWorkflow(chain(httpNode({ auth: awsAuth, ...config, url: `${api.base}/items` })))
    return { output, received: api.received }
  }

  it("signs the request the pre-request script left, body, query and session token included", async () => {
    const api = await startServer(verifyAwsSignature)
    const output = await makeExecutor(secrets).executeWorkflow(chain(httpNode({
      method: "POST",
      url: `${api.base}/items/a b`,
      auth: awsAuth,
      queryParams: [{ key: "q", value: "two words" }, { key: "a", value: "1" }],
      bodyType: "json",
      body: '{"name": "widget"}',
      scripts: { preRequest: 'aw.request.headers["X-Extra"] = "set by script"\naw.request.body = JSON.stringify({ name: "changed" })' },
    })))

    expect(callResult(output).statusCode).toBe(200)
    const [request] = api.received
    expect(request!.url).toBe("/items/a%20b?a=1&q=two%20words")
    expect(request!.body.toString()).toBe('{"name":"changed"}')
    expect(request!.headers["x-amz-security-token"]).toBe("session-token-value")
    expect(request!.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260102\/eu-west-1\/execute-api\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-extra, Signature=[0-9a-f]{64}$/)
  })

  it("is refused by the verifying server when signed with the wrong key", async () => {
    const { output } = await run({}, verifyAwsSignature, { ...secrets, AWS_SECRET: "not-the-key" })
    expect(callResult(output).statusCode).toBe(403)
  })

  it("signs a form-data body over the bytes it sends", async () => {
    const { output, received } = await run({
      method: "POST",
      bodyType: "form-data",
      formDataEntries: [{ key: "note", value: "hello", type: "text", active: true }],
    })
    expect(callResult(output).statusCode).toBe(200)
    expect(String(received[0]!.headers["content-type"])).toMatch(/^multipart\/form-data; boundary=/)
    expect(received[0]!.body.toString()).toContain("hello")
  })

  it("signs every retry attempt", async () => {
    let calls = 0
    const { output, received } = await run(
      { retry: { maxAttempts: 3, intervalMs: 0 } },
      (request, response) => (++calls < 3 ? response.writeHead(503).end() : verifyAwsSignature(request, response)),
    )
    expect(received).toHaveLength(3)
    for (const request of received) expect(request.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 /)
    expect(callResult(output).statusCode).toBe(200)
  })

  it("does not follow a redirect with a signature made for another URL", async () => {
    const { output, received } = await run(
      { followRedirects: true },
      (_request, response) => response.writeHead(302, { Location: "/elsewhere" }).end(),
    )
    expect(received).toHaveLength(1)
    expect(callResult(output).statusCode).toBe(302)
  })

  it("fails the node, sending nothing, when a secret is missing", async () => {
    const { output, received } = await run(
      {},
      verifyAwsSignature,
      { AWS_SECRET },
    )
    expect(received).toHaveLength(0)
    expect(callResult(output).error).toBe("AWS Signature V4: secret AWS_TOKEN is not set")
  })
})
