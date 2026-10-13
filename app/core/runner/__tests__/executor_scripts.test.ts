import { createHmac } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { HTTPNodeDataSchema, RunResultSchema } from "@shared/zod-schemas"
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

/** Records every request and answers `{"id": 42, "echo": <path>}`. */
async function startServer(): Promise<{ server: Server; base: string; received: Received[] }> {
  const received: Received[] = []
  const server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      received.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body })
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ id: 42, echo: request.url }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${port}`, received }
}

function makeExecutor(secrets: Record<string, string> = {}): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({ clock, rng, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng), secrets })
}

function chain(...nodes: WorkflowNode[]): WorkflowGraph {
  const all: WorkflowNode[] = [{ nodeId: "start", type: "start" }, ...nodes, { nodeId: "end", type: "end" }]
  return {
    nodes: all,
    edges: all.slice(1).map((node, index) => ({ edgeId: `e${index}`, source: all[index]!.nodeId, target: node.nodeId })),
  }
}

describe("WorkflowExecutor — http-request scripts", () => {
  let server: Server | undefined
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
  })

  it("signs the request it sends with a pre-request script", async () => {
    const api = await startServer()
    server = api.server
    const config = {
      method: "POST",
      url: `${api.base}/orders`,
      bodyType: "json",
      body: '{"item": "{{variables.item}}"}',
      scripts: {
        preRequest: `const signature = aw.crypto.hmacSha256(aw.secrets.get("SIGNING_KEY"), aw.request.method + "\\n" + aw.request.url + "\\n" + aw.request.body)
aw.request.headers["X-Signature"] = signature
console.log("signed with", aw.secrets.get("SIGNING_KEY"))`,
      },
    }
    expect(HTTPNodeDataSchema.safeParse(config).success).toBe(true)
    const output = await makeExecutor({ SIGNING_KEY: "k3y-material" }).executeWorkflow({
      ...chain({ nodeId: "order", type: "http-request", config }),
      variables: { item: "book" },
    })

    expect(output.status).toBe("passed")
    const sent = api.received[0]!
    expect(sent.body).toBe('{"item": "book"}')
    const expected = createHmac("sha256", "k3y-material").update(`POST\n${api.base}/orders\n{"item": "book"}`).digest("hex")
    expect(sent.headers["x-signature"]).toBe(expected)

    const result = output.results.find((r) => r.nodeId === "order")!
    expect(RunResultSchema.safeParse(result).success).toBe(true)
    expect(result.secretRefs).toEqual(["SIGNING_KEY"])
    // The executor keeps real values; masking is the scheduler's (see scheduler.test.ts).
    expect(result.scripts).toEqual([{ phase: "preRequest", duration: expect.any(Number), logs: ["signed with k3y-material"], tests: [] }])
  })

  it("passes a value a post-response script sets to the next node", async () => {
    const api = await startServer()
    server = api.server
    const output = await makeExecutor().executeWorkflow(
      chain(
        {
          nodeId: "create",
          type: "http-request",
          config: { method: "POST", url: `${api.base}/items`, scripts: { postResponse: 'aw.variables.set("itemPath", "/items/" + aw.response.json().id)' } },
        },
        { nodeId: "read", type: "http-request", config: { method: "GET", url: `${api.base}{{variables.itemPath}}` } },
      ),
    )
    expect(output.status).toBe("passed")
    expect(api.received.map((r) => r.url)).toEqual(["/items", "/items/42"])
    expect(output.extractedVariables).toMatchObject({ itemPath: "/items/42" })
  })

  it("fails the node, and stops the branch, when an aw.test fails", async () => {
    const api = await startServer()
    server = api.server
    const output = await makeExecutor().executeWorkflow(
      chain(
        {
          nodeId: "check",
          type: "http-request",
          config: {
            method: "GET",
            url: `${api.base}/items/42`,
            scripts: {
              postResponse: `aw.test("is 42", () => aw.expect(aw.response.json().id).toBe(42))
aw.test("is 43", () => aw.expect(aw.response.json().id).toBe(43))`,
            },
          },
        },
        { nodeId: "after", type: "http-request", config: { method: "GET", url: `${api.base}/after` } },
      ),
    )
    expect(output.status).toBe("failed")
    expect(output.failedNodes).toEqual(["check"])
    expect(api.received.map((r) => r.url)).toEqual(["/items/42"])
    const result = output.results.find((r) => r.nodeId === "check")!
    expect(result.status).toBe("failed")
    expect(result.error).toBe("Post-response script: 1 of 2 tests failed")
    expect(result.scripts?.[0]?.tests).toEqual([
      { name: "is 42", passed: true },
      { name: "is 43", passed: false, error: "AssertionError: expected 42 to be 43" },
    ])
    expect(RunResultSchema.safeParse(result).success).toBe(true)
  })

  it("does not send a request whose pre-request script throws", async () => {
    const api = await startServer()
    server = api.server
    const output = await makeExecutor().executeWorkflow(
      chain({
        nodeId: "broken",
        type: "http-request",
        config: { method: "GET", url: `${api.base}/x`, scripts: { preRequest: "console.log('before')\nundefinedFunction()" } },
      }),
    )
    expect(output.status).toBe("failed")
    expect(api.received).toEqual([])
    const result = output.results.find((r) => r.nodeId === "broken")!
    expect(result.error).toBe("Pre-request script failed: ReferenceError: 'undefinedFunction' is not defined (line 2, column 1)")
    expect(result.scripts?.[0]?.logs).toEqual(["before"])
  })

  it("still refuses a URL SafeHttp refuses, whatever the script sets", async () => {
    const output = await makeExecutor().executeWorkflow(
      chain({
        nodeId: "redirected",
        type: "http-request",
        config: { method: "GET", url: "https://api.test/", scripts: { preRequest: 'aw.request.url = "file:///etc/passwd"' } },
      }),
    )
    expect(output.status).toBe("failed")
    expect(output.results.find((r) => r.nodeId === "redirected")?.error).toBe("Not a requestable http(s) URL: file:///etc/passwd")
  })
})
