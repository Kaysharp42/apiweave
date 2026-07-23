import { describe, expect, it } from "vitest"
import type { RequestInit as UndiciRequestInit } from "undici"
import { WorkflowExecutor, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"

/**
 * Regression coverage for the HTTPRequestConfigPanel/executor contract mismatch:
 * the panel writes queryParams/auth/cookies/body-type fields/followRedirects/
 * sslVerify into node.config, and the executor must actually honor them
 * instead of silently dropping them (apiweave-other-contract-mismatch).
 */

interface CapturedRequest {
  url: string
  init: UndiciRequestInit
}

function makeExecutorWithCapture(response: () => Response) {
  const captured: CapturedRequest[] = []
  const fetchImpl = async (url: string, init: UndiciRequestInit): Promise<Response> => {
    captured.push({ url, init })
    return response()
  }

  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  const http = new SafeHttp({ allowLoopback: true, fetchImpl: fetchImpl as never })
  const functions = new DynamicFunctions(clock, rng)
  const executor = new WorkflowExecutor({ clock, rng, http, functions })
  return { executor, captured }
}

function singleHttpNodeWorkflow(config: Record<string, unknown>): WorkflowGraph {
  return {
    nodes: [
      { nodeId: "start", type: "start" },
      { nodeId: "http_1", type: "http-request", config },
      { nodeId: "end", type: "end" },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "http_1" },
      { edgeId: "e2", source: "http_1", target: "end" },
    ],
  }
}

describe("WorkflowExecutor — HTTP request config panel contract", () => {
  it("appends active queryParams to the URL", async () => {
    const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }))
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({
        method: "GET",
        url: "http://localhost/resource",
        queryParams: [
          { key: "page", value: "1", active: true },
          { key: "disabled", value: "x", active: false },
        ],
      }),
    )
    expect(captured[0]!.url).toBe("http://localhost/resource?page=1")
  })

  it("builds an Authorization header for bearer auth", async () => {
    const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }))
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({
        method: "GET",
        url: "http://localhost/resource",
        auth: { type: "bearer", bearer: { token: "abc123" } },
      }),
    )
    const headers = captured[0]!.init.headers as Record<string, string>
    expect(headers["Authorization"]).toBe("Bearer abc123")
  })

  it("builds a base64 Authorization header for basic auth", async () => {
    const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }))
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({
        method: "GET",
        url: "http://localhost/resource",
        auth: { type: "basic", basic: { username: "alice", password: "hunter2" } },
      }),
    )
    const headers = captured[0]!.init.headers as Record<string, string>
    expect(headers["Authorization"]).toBe(`Basic ${Buffer.from("alice:hunter2").toString("base64")}`)
  })

  it("appends apiKey auth to the query string when addTo=query", async () => {
    const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }))
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({
        method: "GET",
        url: "http://localhost/resource",
        auth: { type: "apiKey", apiKey: { key: "api_key", value: "secretval", addTo: "query" } },
      }),
    )
    expect(captured[0]!.url).toBe("http://localhost/resource?api_key=secretval")
  })

  it("merges active cookies into a Cookie header", async () => {
    const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }))
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({
        method: "GET",
        url: "http://localhost/resource",
        cookies: [
          { key: "session", value: "abc", active: true },
          { key: "off", value: "y", active: false },
        ],
      }),
    )
    const headers = captured[0]!.init.headers as Record<string, string>
    expect(headers["Cookie"]).toBe("session=abc")
  })

  it("builds an x-www-form-urlencoded body from urlEncodedEntries", async () => {
    const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }))
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({
        method: "POST",
        url: "http://localhost/resource",
        bodyType: "x-www-form-urlencoded",
        urlEncodedEntries: [{ key: "a", value: "1", active: true }],
      }),
    )
    const { init } = captured[0]!
    expect(init.body).toBe("a=1")
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded")
  })

  it("builds a multipart form-data body from formDataEntries", async () => {
    const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }))
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({
        method: "POST",
        url: "http://localhost/resource",
        bodyType: "form-data",
        formDataEntries: [{ key: "name", value: "apiweave", type: "text", active: true }],
      }),
    )
    const form = captured[0]!.init.body as unknown as { get(name: string): unknown }
    expect(form.get("name")).toBe("apiweave")
  })

  it("does not follow redirects when followRedirects=false", async () => {
    let calls = 0
    const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
    const rng = new SeededRandomProvider("0xDEADBEEF")
    const fetchImpl = async (): Promise<Response> => {
      calls++
      return new Response("", { status: 302, headers: { location: "http://localhost/other" } })
    }
    const http = new SafeHttp({ allowLoopback: true, fetchImpl: fetchImpl as never })
    const functions = new DynamicFunctions(clock, rng)
    const executor = new WorkflowExecutor({ clock, rng, http, functions })

    const output = await executor.executeWorkflow(
      singleHttpNodeWorkflow({ method: "GET", url: "http://localhost/resource", followRedirects: false }),
    )
    expect(calls).toBe(1)
    const response = output.results[0]!.response as Record<string, unknown>
    expect(response["statusCode"]).toBe(302)
  })
})
