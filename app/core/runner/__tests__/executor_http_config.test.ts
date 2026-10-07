import { describe, expect, it } from "vitest"
import type { RequestInit as UndiciRequestInit } from "undici"
import { WorkflowExecutor, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { createSecretMasker } from "../secret_masker"

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

function makeExecutorWithCapture(response: () => Response, secrets?: Record<string, string>) {
  const captured: CapturedRequest[] = []
  const fetchImpl = async (url: string, init: UndiciRequestInit): Promise<Response> => {
    captured.push({ url, init })
    return response()
  }

  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  const http = new SafeHttp({ fetchImpl: fetchImpl as never })
  const functions = new DynamicFunctions(clock, rng)
  const executor = new WorkflowExecutor({ clock, rng, http, functions, secrets })
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

  it("substitutes active pathVariables into the URL", async () => {
    const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }))
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({
        method: "GET",
        url: "http://localhost/users/{userId}/posts/{postId}",
        pathVariables: [
          { key: "userId", value: "42", active: true },
          { key: "postId", value: "7", active: true },
          { key: "unused", value: "x", active: false },
        ],
      }),
    )
    expect(captured[0]!.url).toBe("http://localhost/users/42/posts/7")
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
    const http = new SafeHttp({ fetchImpl: fetchImpl as never })
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

describe("WorkflowExecutor — placeholders in JSON bodies", () => {
  const awkward = 'say "hi"\\ to\nyou'

  async function sentBody(
    config: Record<string, unknown>,
    variables: Record<string, unknown>,
    secrets?: Record<string, string>,
  ): Promise<string> {
    const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }), secrets)
    await executor.executeWorkflow({ ...singleHttpNodeWorkflow({ method: "POST", url: "http://localhost/x", ...config }), variables })
    return captured[0]!.init.body as string
  }

  it("escapes a value inside a string literal and keeps a standalone one raw", async () => {
    const body = await sentBody(
      { bodyType: "json", body: '{"name": "{{variables.name}}", "id": {{variables.id}}, "ok": {{variables.ok}}}' },
      { name: awkward, id: 42, ok: true },
    )
    expect(JSON.parse(body)).toEqual({ name: awkward, id: 42, ok: true })
  })

  it("tracks escaped quotes in the template and escapes placeholders used as keys", async () => {
    const body = await sentBody(
      { bodyType: "json", body: '{"note": "she said \\"{{variables.name}}\\"", "{{variables.name}}": {{variables.id}}}' },
      { name: awkward, id: 7 },
    )
    expect(JSON.parse(body)).toEqual({ note: `she said "${awkward}"`, [awkward]: 7 })
  })

  it("is not thrown off by quotes inside a placeholder's own text", async () => {
    const body = await sentBody(
      { bodyType: "json", body: '{"env": "{{randomChoice("prod)}}", "name": "{{variables.name}}"}' },
      { name: awkward },
    )
    expect(JSON.parse(body)).toEqual({ env: "prod", name: awkward })
  })

  it("escapes a secret, and the run-history masker still hides the escaped form", async () => {
    const secret = 'pa"ss\\word'
    const body = await sentBody(
      { bodyType: "json", body: '{"password": "{{secrets.pw}}"}' },
      {},
      { pw: secret },
    )
    expect(JSON.parse(body)).toEqual({ password: secret })
    expect(createSecretMasker([secret])(body)).toBe('{"password": "<SECRET>"}')
  })

  it("writes an object or array value as JSON, never [object Object]", async () => {
    const user = { name: awkward, tags: ["a", "b"] }
    const body = await sentBody(
      { bodyType: "json", body: '{"user": {{variables.user}}, "tags": {{variables.user.tags}}, "note": "{{variables.user}}"}' },
      { user },
    )
    expect(JSON.parse(body)).toEqual({ user, tags: ["a", "b"], note: JSON.stringify(user) })

    const text = await sentBody(
      { bodyType: "raw", body: "user={{variables.user}}", headers: [{ key: "Content-Type", value: "text/plain" }] },
      { user },
    )
    expect(text).toBe(`user=${JSON.stringify(user)}`)
  })

  it("escapes placeholders in an object body", async () => {
    const body = await sentBody({ bodyType: "json", body: { name: "{{variables.name}}" } }, { name: awkward })
    expect(JSON.parse(body)).toEqual({ name: awkward })
  })

  it("escapes a raw body only when its Content-Type is JSON", async () => {
    const asJson = await sentBody(
      {
        bodyType: "raw",
        body: '{"name": "{{variables.name}}"}',
        headers: [{ key: "Content-Type", value: "application/vnd.api+json; charset=utf-8" }],
      },
      { name: awkward },
    )
    expect(JSON.parse(asJson)).toEqual({ name: awkward })

    const asText = await sentBody(
      { bodyType: "raw", body: 'name="{{variables.name}}"', headers: [{ key: "Content-Type", value: "text/plain" }] },
      { name: awkward },
    )
    expect(asText).toBe(`name="${awkward}"`)
  })
})
