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

  it("labels a JSON body typed as text application/json unless a Content-Type is set", async () => {
    const send = async (config: Record<string, unknown>) => {
      const { executor, captured } = makeExecutorWithCapture(() => new Response("{}", { status: 200 }))
      await executor.executeWorkflow(singleHttpNodeWorkflow({ method: "POST", url: "http://localhost/r", bodyType: "json", ...config }))
      return captured[0]!.init.headers as Record<string, string>
    }

    expect((await send({ body: '{"a": 1}' }))["Content-Type"]).toBe("application/json")
    const own = await send({ body: '{"a": 1}', headers: [{ key: "content-type", value: "application/vnd.api+json" }] })
    expect(own["content-type"]).toBe("application/vnd.api+json")
    expect(own["Content-Type"]).toBeUndefined()
    expect((await send({ body: "" }))["Content-Type"]).toBeUndefined()
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

  it("substitutes an untyped non-JSON body verbatim, as cURL and HAR imports leave it", async () => {
    const body = await sentBody(
      { body: '<user name="{{variables.name}}"/>', headers: [{ key: "Content-Type", value: "application/xml" }] },
      { name: awkward },
    )
    expect(body).toBe(`<user name="${awkward}"/>`)
  })

  it("escapes an untyped body with no Content-Type, since it is sent as JSON", async () => {
    const body = await sentBody({ body: '{"name": "{{variables.name}}"}' }, { name: awkward })
    expect(JSON.parse(body)).toEqual({ name: awkward })
  })
})

describe("WorkflowExecutor — GraphQL bodies", () => {
  const query = "query User($id: ID!, $name: String) { user(id: $id, name: $name) { id } }"
  const graphql = {
    query: `${query} # by {{variables.who}}`,
    variables: '{"id": {{variables.id}}, "name": "{{variables.name}}", "filter": {{variables.filter}}}',
    operationName: "User",
  }
  const variables = { who: "ci", id: 42, name: 'say "hi"\\', filter: { active: true } }

  async function send(method: string, config: Record<string, unknown>, response = () => new Response("{}", { status: 200 })) {
    const { executor, captured } = makeExecutorWithCapture(response)
    const output = await executor.executeWorkflow({
      ...singleHttpNodeWorkflow({ method, url: "http://localhost/graphql", bodyType: "graphql", ...config }),
      variables,
    })
    return { output, request: captured[0] }
  }

  it("POSTs {query, variables, operationName} as JSON, the variables a JSON template", async () => {
    const { request } = await send("POST", { graphql })
    expect(request!.url).toBe("http://localhost/graphql")
    expect((request!.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
    expect(JSON.parse(request!.init.body as string)).toEqual({
      query: `${query} # by ci`,
      variables: { id: 42, name: 'say "hi"\\', filter: { active: true } },
      operationName: "User",
    })
  })

  it("leaves out empty variables and operation name, and keeps a Content-Type the user set", async () => {
    const { request } = await send("POST", {
      graphql: { query: "{ me { id } }", variables: "  " },
      headers: [{ key: "content-type", value: "application/graphql+json" }],
    })
    expect(JSON.parse(request!.init.body as string)).toEqual({ query: "{ me { id } }" })
    expect((request!.init.headers as Record<string, string>)["Content-Type"]).toBeUndefined()
  })

  it("sends a GET as query, variables and operationName parameters, with no body", async () => {
    const { request } = await send("GET", { graphql })
    const url = new URL(request!.url)
    expect(url.searchParams.get("query")).toBe(`${query} # by ci`)
    expect(JSON.parse(url.searchParams.get("variables")!)).toEqual({ id: 42, name: 'say "hi"\\', filter: { active: true } })
    expect(url.searchParams.get("operationName")).toBe("User")
    expect(request!.init.body).toBeUndefined()
  })

  it("fails the node without sending when the variables are not a JSON object", async () => {
    for (const bad of ["{oops", "[1, 2]"]) {
      const { output, request } = await send("POST", { graphql: { query: "{ me }", variables: bad } })
      expect(request).toBeUndefined()
      expect(output.results[0]!.error).toMatch(/^Failed to build request body: Error: GraphQL variables (are not valid JSON|must be a JSON object)$/)
    }
  })

  it("lets an assertion fail a 200 response that carries GraphQL errors", async () => {
    const { executor } = makeExecutorWithCapture(
      () => new Response(JSON.stringify({ data: null, errors: [{ message: "not found" }] }), { status: 200 }),
    )
    const output = await executor.executeWorkflow({
      nodes: [
        { nodeId: "start", type: "start" },
        { nodeId: "gql", type: "http-request", config: { method: "POST", url: "http://localhost/graphql", bodyType: "graphql", graphql: { query: "{ me }" } } },
        { nodeId: "check", type: "assertion", config: { assertions: [{ source: "prev", path: "response.body.errors", operator: "notExists" }] } },
        { nodeId: "end", type: "end" },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "gql" },
        { edgeId: "e2", source: "gql", target: "check" },
        { edgeId: "e3", source: "check", target: "end", sourceHandle: "pass" },
      ],
    })
    expect(output.nodeStatuses["gql"]).toBe("passed")
    expect(output.nodeStatuses["check"]).toBe("failed")
    expect(output.status).toBe("failed")
  })
})

describe("WorkflowExecutor — placeholder resolution and auth (characterization)", () => {
  function captureExecutor(extra: { data?: Record<string, unknown>; environmentVariables?: Record<string, string> } = {}) {
    const captured: CapturedRequest[] = []
    const fetchImpl = async (url: string, init: UndiciRequestInit): Promise<Response> => {
      captured.push({ url, init })
      return new Response(JSON.stringify({ id: 7 }), { status: 200, headers: { "Content-Type": "application/json" } })
    }
    const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
    const rng = new SeededRandomProvider("0xDEADBEEF")
    const http = new SafeHttp({ fetchImpl: fetchImpl as never })
    const executor = new WorkflowExecutor({
      clock, rng, http, functions: new DynamicFunctions(clock, rng), secrets: { API_KEY: "s3cret" }, ...extra,
    })
    return { executor, captured }
  }

  it("resolves every placeholder kind in a header, and leaves the unresolvable verbatim", async () => {
    const { executor, captured } = captureExecutor({ data: { row: { id: 3 } }, environmentVariables: { HOST: "api" } })
    const headers = {
      "X-Func": "{{ randomHex(4) }}",
      "X-Unknown-Func": "{{nope(1)}}",
      "X-Secret": "{{secrets.API_KEY}}",
      "X-Missing-Secret": "{{secrets.NOPE}}",
      "X-Var": "{{variables.token}}",
      "X-Var-Too-Deep": "{{variables.token.deeper}}",
      "X-Data": "{{data.row.id}}",
      "X-Env": "{{env.HOST}}",
      "X-Prev": "{{prev.response.body.id}}",
      "X-Prev-Index": "{{prev[0].response.body.id}}",
      "X-Prev-Out-Of-Range": "{{prev[99].response.body.id}}",
      "X-Node": "{{first.response.body.id}}",
      "X-Unknown": "{{nowhere.id}}",
    }
    await executor.executeWorkflow({
      variables: { token: "abc" },
      nodes: [
        { nodeId: "start", type: "start" },
        { nodeId: "first", type: "http-request", config: { method: "GET", url: "http://localhost/first" } },
        {
          nodeId: "second",
          type: "http-request",
          config: {
            method: "GET",
            url: "http://localhost/second",
            headers: Object.entries(headers).map(([key, value]) => ({ key, value, active: true })),
          },
        },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "first" },
        { edgeId: "e2", source: "first", target: "second" },
      ],
    })
    const sent = captured[1]!.init.headers as Record<string, string>
    expect(sent["X-Func"]).toMatch(/^[0-9a-f]{4}$/)
    expect({ ...sent, "X-Func": undefined }).toMatchObject({
      "X-Unknown-Func": "{{nope(1)}}",
      "X-Secret": "s3cret",
      "X-Missing-Secret": "{{secrets.NOPE}}",
      "X-Var": "abc",
      "X-Var-Too-Deep": "{{variables.token.deeper}}",
      "X-Data": "3",
      "X-Env": "api",
      "X-Prev": "7",
      "X-Prev-Index": "7",
      "X-Prev-Out-Of-Range": "{{prev[99].response.body.id}}",
      "X-Node": "7",
      "X-Unknown": "{{nowhere.id}}",
    })
  })

  it("refuses a variable that was masked in a rerun's source run", async () => {
    const { executor, captured } = captureExecutor()
    const output = await executor.executeWorkflow(
      singleHttpNodeWorkflow({ method: "GET", url: "http://localhost/a", headers: [{ key: "X-T", value: "{{variables.token}}", active: true }] }),
      { resume: { scope: new Set(["http_1", "end"]), results: [], maskedVariables: ["token"] } },
    )
    expect(captured).toHaveLength(0)
    expect(output.results.find((r) => r.nodeId === "http_1")?.error).toContain(
      "{{variables.token}} was masked in the source run. Rerun from the node that sets it, or run the whole workflow.",
    )
  })

  it("refuses a secret in the URL", async () => {
    const { executor, captured } = captureExecutor()
    const output = await executor.executeWorkflow(
      singleHttpNodeWorkflow({ method: "GET", url: "http://localhost/{{secrets.API_KEY}}" }),
    )
    expect(captured).toHaveLength(0)
    expect(output.results.find((r) => r.nodeId === "http_1")?.error).toContain(
      "Secret substitution not allowed in URL/query/path contexts",
    )
  })

  it("sends apiKey auth as a header by default and skips bearer auth without a token", async () => {
    const { executor, captured } = captureExecutor()
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({ method: "GET", url: "http://localhost/a", auth: { type: "apiKey", apiKey: { key: "X-Key", value: "{{secrets.API_KEY}}" } } }),
    )
    await executor.executeWorkflow(
      singleHttpNodeWorkflow({ method: "GET", url: "http://localhost/b", auth: { type: "bearer", bearer: {} } }),
    )
    expect((captured[0]!.init.headers as Record<string, string>)["X-Key"]).toBe("s3cret")
    expect((captured[1]!.init.headers as Record<string, string>)["Authorization"]).toBeUndefined()
  })

  it("fails an OAuth 2.0 node that has no OAuth 2.0 settings", async () => {
    const { executor, captured } = captureExecutor()
    const output = await executor.executeWorkflow(
      singleHttpNodeWorkflow({ method: "GET", url: "http://localhost/a", auth: { type: "oauth2" } }),
    )
    expect(captured).toHaveLength(0)
    expect(output.results.find((r) => r.nodeId === "http_1")?.error).toContain("OAuth 2.0: the node has no OAuth 2.0 settings")
  })

  it("reports why an assertion could not be evaluated", async () => {
    const { executor } = captureExecutor()
    const output = await executor.executeWorkflow({
      nodes: [
        { nodeId: "start", type: "start" },
        {
          nodeId: "check",
          type: "assertion",
          config: {
            failureMode: "all",
            assertions: [
              { source: "prev", path: "response.body.id", operator: "equals", expectedValue: "{{variables.missing}}" },
              { source: "status", path: "", operator: "equals", expectedValue: 200 },
            ],
          },
        },
      ],
      edges: [{ edgeId: "e1", source: "start", target: "check" }],
    })
    const evaluations = output.results.find((r) => r.nodeId === "check")?.assertions
    expect(evaluations?.map((e) => [e.reasonCode, e.actualState])).toEqual([
      ["template-unresolved", "not-evaluated"],
      ["source-unavailable", "source-unavailable"],
    ])
  })
})
