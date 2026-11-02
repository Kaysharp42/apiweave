import { describe, expect, it } from "vitest"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import { nodeEndpoint, nodeReferences, REFERENCE_FILTER_RE, urlPathTemplate } from "../node_facts"

/** The safe facts node search and the workspace map are both built from. */
describe("urlPathTemplate", () => {
  it("keeps the path with its placeholders and drops host, base reference, query and fragment", () => {
    expect(urlPathTemplate("https://api.test/v1/users/{{variables.id}}?page=2#top")).toBe("/v1/users/{{variables.id}}")
    expect(urlPathTemplate("{{env.BASE_URL}}/orders/{{variables.orderId}}?expand=1")).toBe("/orders/{{variables.orderId}}")
    expect(urlPathTemplate("{{env.BASE_URL}}")).toBe("/")
    expect(urlPathTemplate("https://api.test")).toBe("/")
    expect(urlPathTemplate("/relative/path?x=1")).toBe("/relative/path")
  })

  it("never carries userinfo, query credentials or a credential-looking path segment", () => {
    const path = urlPathTemplate("https://bob:hunter2@{{env.HOST}}/v1/login?api_key=sk_live_0123456789abcdef")
    expect(path).toBe("/v1/login")
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    expect(urlPathTemplate(`https://api.test/reset/${jwt}/confirm`)).not.toContain(jwt)
  })
})

describe("nodeEndpoint", () => {
  it("gives request nodes method and path, SSE a GET, and nothing to other types", () => {
    const request = { nodeId: "r", type: "http-request", position: { x: 0, y: 0 }, config: { method: "PUT", url: "https://a.test/x" } } as WorkflowNode
    const sse = { nodeId: "s", type: "sse", position: { x: 0, y: 0 }, config: { url: "{{env.B}}/events" } } as WorkflowNode
    const delay = { nodeId: "d", type: "delay", position: { x: 0, y: 0 }, config: { duration: 5 } } as WorkflowNode
    expect(nodeEndpoint(request)).toEqual({ method: "PUT", urlPath: "/x" })
    expect(nodeEndpoint(sse)).toEqual({ method: "GET", urlPath: "/events" })
    expect(nodeEndpoint(delay)).toBeUndefined()
  })
})

describe("nodeReferences", () => {
  it("reads JSON-escaped script calls and deduplicates per field and role", () => {
    const node = {
      nodeId: "r",
      type: "http-request",
      position: { x: 0, y: 0 },
      config: {
        url: "{{env.B}}/{{variables.id}}/{{variables.id}}",
        scripts: { postResponse: "aw.variables.set(\\\"next\\\", 1); aw.env.get('REGION'); const x = \"{{variables.notResolvedInScripts}}\"" },
      },
    } as WorkflowNode
    expect(nodeReferences(node)).toEqual([
      { ref: "env.B", field: "url", role: "consumes" },
      { ref: "variables.id", field: "url", role: "consumes" },
      { ref: "variables.next", field: "scripts", role: "produces" },
      { ref: "env.REGION", field: "scripts", role: "consumes" },
    ])
  })

  it("returns names only, never a literal value", () => {
    const node = {
      nodeId: "r",
      type: "http-request",
      position: { x: 0, y: 0 },
      config: {
        url: "https://u:p@h.test/x?token=abc",
        headers: [{ key: "Authorization", value: "Bearer literal-0123456789" }],
        body: "{\"password\":\"hunter2\"}",
      },
    } as WorkflowNode
    expect(nodeReferences(node)).toEqual([])
  })

  it("accepts a namespace and one name as a filter, nothing else", () => {
    for (const ok of ["variables.token", "env.BASE_URL", "secrets.API_KEY"]) expect(REFERENCE_FILTER_RE.test(ok), ok).toBe(true)
    for (const bad of ["prev.x", "variables.a.b", "{{env.X}}", "env.", "secrets.1X"]) expect(REFERENCE_FILTER_RE.test(bad), bad).toBe(false)
  })
})
