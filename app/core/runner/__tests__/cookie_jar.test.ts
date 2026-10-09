import { describe, expect, it } from "vitest"
import { CookieJar } from "tough-cookie"
import { Headers as UndiciHeaders, type RequestInit } from "undici"
import { SafeHttp } from "../safe_http"
import { WorkflowExecutor, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"

type Sent = { url: string; cookie: string | null }

/** A SafeHttp whose fetch answers from `route` and records the Cookie header of every hop. */
function fakeHttp(route: (url: string) => Response) {
  const sent: Sent[] = []
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    sent.push({ url, cookie: new UndiciHeaders(init.headers).get("cookie") })
    return route(url)
  }
  return { http: new SafeHttp({ fetchImpl: fetchImpl as never }), sent }
}

const ok = (): Response => new Response("{}", { status: 200 })
const setting = (...cookies: string[]): Response => {
  const headers = new Headers()
  for (const cookie of cookies) headers.append("set-cookie", cookie)
  return new Response("{}", { status: 200, headers })
}

describe("SafeHttp cookie jar", () => {
  it("sends a cookie a redirect set to the next hop", async () => {
    const { http, sent } = fakeHttp((url) =>
      url.endsWith("/login")
        ? new Response("", { status: 302, headers: { location: "/home", "set-cookie": "sid=abc; Path=/" } })
        : ok(),
    )
    await http.safeFetch("https://app.example.com/login", {}, { cookieJar: new CookieJar() })
    expect(sent).toEqual([
      { url: "https://app.example.com/login", cookie: null },
      { url: "https://app.example.com/home", cookie: "sid=abc" },
    ])
  })

  it("on a cross-origin redirect drops the request's own Cookie but sends the jar's cookies for the new host", async () => {
    const jar = new CookieJar()
    jar.setCookieSync("theirs=1", "https://other.example.org/")
    jar.setCookieSync("mine=1", "https://app.example.com/")
    const { http, sent } = fakeHttp((url) =>
      url.startsWith("https://app.") ? new Response("", { status: 302, headers: { location: "https://other.example.org/x" } }) : ok(),
    )
    await http.safeFetch("https://app.example.com/", { headers: { Cookie: "manual=1" } }, { cookieJar: jar })
    expect(sent).toEqual([
      { url: "https://app.example.com/", cookie: "mine=1; manual=1" },
      { url: "https://other.example.org/x", cookie: "theirs=1" },
    ])
  })

  it("matches domain, path, Secure and expiry", async () => {
    const jar = new CookieJar()
    const base = "https://example.com/api/login"
    jar.setCookieSync("hostOnly=1; Path=/", base)
    jar.setCookieSync("wide=1; Domain=example.com; Path=/", base)
    jar.setCookieSync("apiOnly=1; Path=/api", base)
    jar.setCookieSync("secure=1; Secure; Path=/", base)
    jar.setCookieSync("gone=1; Path=/; Max-Age=0", base)
    jar.setCookieSync("expired=1; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT", base)
    jar.setCookieSync("elsewhere=1; Domain=evil.test", base, { ignoreError: true })
    const { http, sent } = fakeHttp(ok)

    await http.safeFetch("https://example.com/api/users", {}, { cookieJar: jar })
    await http.safeFetch("https://sub.example.com/other", {}, { cookieJar: jar })
    await http.safeFetch("http://example.com/", {}, { cookieJar: jar })

    expect(sent.map((s) => s.cookie?.split("; ").sort())).toEqual([
      ["apiOnly=1", "hostOnly=1", "secure=1", "wide=1"],
      ["wide=1"],
      ["hostOnly=1", "wide=1"],
    ])
  })

  it("forgets a cookie the server deletes", async () => {
    const jar = new CookieJar()
    jar.setCookieSync("sid=abc; Path=/", "https://example.com/")
    const { http, sent } = fakeHttp((url) => (url.endsWith("/logout") ? setting("sid=; Path=/; Max-Age=0") : ok()))
    await http.safeFetch("https://example.com/logout", {}, { cookieJar: jar })
    await http.safeFetch("https://example.com/me", {}, { cookieJar: jar })
    expect(sent.map((s) => s.cookie)).toEqual(["sid=abc", null])
  })

  it("lets the request's own cookie override the jar's cookie of the same name", async () => {
    const jar = new CookieJar()
    jar.setCookieSync("sid=fromJar; Path=/", "https://example.com/")
    jar.setCookieSync("theme=dark; Path=/", "https://example.com/")
    const { http, sent } = fakeHttp(ok)
    await http.safeFetch("https://example.com/", { headers: { Cookie: "sid=manual" } }, { cookieJar: jar })
    expect(sent[0]!.cookie).toBe("theme=dark; sid=manual")
  })
})

describe("WorkflowExecutor cookie jar", () => {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")

  function chain(...nodes: { nodeId: string; config?: Record<string, unknown>; type?: string }[]): WorkflowGraph {
    const all = [{ nodeId: "start", type: "start" }, ...nodes.map((n) => ({ type: "http-request", ...n })), { nodeId: "end", type: "end" }]
    return {
      nodes: all,
      edges: all.slice(1).map((node, index) => ({ edgeId: `e${index}`, source: all[index]!.nodeId, target: node.nodeId })),
    }
  }

  function executorFor(route: (url: string) => Response, extra: Partial<ConstructorParameters<typeof WorkflowExecutor>[0]> = {}) {
    const { http, sent } = fakeHttp(route)
    const executor = new WorkflowExecutor({ clock, rng, http, functions: new DynamicFunctions(clock, rng), ...extra })
    return { executor, sent }
  }

  const loginRoute = (url: string): Response => (url.endsWith("/login") ? setting("sid=s3cr3t; Path=/; HttpOnly") : ok())

  it("carries a session cookie from one node to the next, merged with the node's own cookie rows", async () => {
    const { executor, sent } = executorFor(loginRoute)
    await executor.executeWorkflow(
      chain(
        { nodeId: "login", config: { method: "POST", url: "https://api.example.com/login" } },
        { nodeId: "me", config: { url: "https://api.example.com/me", cookies: [{ key: "lang", value: "fr", active: true }] } },
      ),
    )
    expect(sent.map((s) => s.cookie)).toEqual([null, "sid=s3cr3t; lang=fr"])
  })

  it("useCookieJar: false sends only the node's own cookies and stores nothing", async () => {
    const { executor, sent } = executorFor(loginRoute)
    await executor.executeWorkflow(
      chain(
        { nodeId: "login", config: { url: "https://api.example.com/login" } },
        { nodeId: "anon", config: { url: "https://api.example.com/me", useCookieJar: false } },
        { nodeId: "login2", config: { url: "https://api.example.com/login", useCookieJar: false } },
      ),
    )
    expect(sent.map((s) => s.cookie)).toEqual([null, null, null])
  })

  it("shares the jar with a Call Workflow child, so a login sub-workflow signs the caller in", async () => {
    const { executor, sent } = executorFor(loginRoute, {
      resolveWorkflow: () => chain({ nodeId: "login", config: { url: "https://api.example.com/login" } }),
    })
    await executor.executeWorkflow(
      chain(
        { nodeId: "call", type: "workflow", config: { targetWorkflowId: "wf_login" } },
        { nodeId: "me", config: { url: "https://api.example.com/me" } },
      ),
    )
    expect(sent.map((s) => s.cookie)).toEqual([null, "sid=s3cr3t"])
  })

  it("starts each executor (each run) with an empty jar", async () => {
    const { http, sent } = fakeHttp(loginRoute)
    const deps = { clock, rng, http, functions: new DynamicFunctions(clock, rng) }
    await new WorkflowExecutor(deps).executeWorkflow(chain({ nodeId: "login", config: { url: "https://api.example.com/login" } }))
    await new WorkflowExecutor(deps).executeWorkflow(chain({ nodeId: "me", config: { url: "https://api.example.com/me" } }))
    expect(sent.map((s) => s.cookie)).toEqual([null, null])
  })
})
