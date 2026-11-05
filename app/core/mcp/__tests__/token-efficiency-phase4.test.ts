import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { IpcRouter } from "../../ipc/router"
import { registerAllHandlers } from "../../ipc/handlers"
import { MCP_TOOLS, toolName } from "../tools"
import { createMcpBenchmarkRuntime, openMcpBenchmarkClient } from "../harness/services"
import type { McpBenchmarkRuntime } from "../harness/types"

/**
 * Token-efficiency Phase 4: one workspace-wide node search that also finds
 * placeholder references, and a workspace map — both built from names and URL
 * path templates only, never values.
 */

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean }
type Match = {
  workflowId?: string
  workflowName?: string
  nodeId: string
  type: string
  method?: string
  urlPath?: string
  matchedOn: string[]
  references?: Array<{ field: string; role: "produces" | "consumes" }>
  neighborNodeIds?: string[]
}
type SearchPage = {
  workflowId?: string
  rev?: number
  items: Match[]
  totalMatched: number
  omittedMatchCount: number
  nextCursor: string | null
}
type MapEntry = {
  workflowId: string
  name: string
  rev: number
  collectionId: string | null
  endpoints?: string[]
  produces?: string[]
  consumes?: string[]
  env?: string[]
  secrets?: string[]
  calls?: string[]
  omitted?: Record<string, number>
  lastRun?: { runId: string; status: string }
}
type MapPage = { items: MapEntry[]; nextCursor: string | null }

/** Literal credentials seeded into configs; none may appear in any response. */
const CANARIES = ["hunter2", "LEAKCANARY", "sk_live", "bob:"]

let runtime: McpBenchmarkRuntime
let client: Client
let close: () => Promise<void>
let workspaceId: string
let projectId: string
let authId: string
let ordersId: string

beforeEach(async () => {
  runtime = createMcpBenchmarkRuntime()
  ;({ client, close } = await openMcpBenchmarkClient(runtime.deps))
  workspaceId = runtime.repositories.workspaces.create({ name: "P4", slug: "p4" }).workspaceId
  projectId = runtime.repositories.collections.create({ workspaceId, name: "Auth" }).collectionId
  // Seeded through the service — the canvas path — because MCP writes refuse
  // some literal credentials; a user's own workflow can still hold them.
  authId = (await runtime.deps.workflows.create(workspaceId, {
    name: "auth",
    collectionId: projectId,
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      {
        nodeId: "login",
        type: "http-request",
        label: "Log in",
        position: { x: 0, y: 0 },
        config: {
          method: "POST",
          url: "https://bob:hunter2-pass@{{env.HOST}}/v1/login?api_key=sk_live_LEAKCANARY0123456789&page=2",
          headers: [
            { key: "Authorization", value: "Bearer LEAKCANARY-header-0123456789abcdef" },
            { key: "X-Trace", value: "{{variables.traceId}}" },
          ],
          queryParams: [{ key: "q", value: "{{variables.term}}" }],
          cookies: [{ key: "sid", value: "{{secrets.SESSION}}" }],
          bodyType: "json",
          body: "{\"password\":\"LEAKCANARY-body-Zx9!q\",\"user\":\"{{env.USER}}\"}",
          auth: { type: "bearer", bearer: { token: "{{secrets.API_KEY}}" } },
          extractors: { token: "response.body.token" },
          scripts: {
            preRequest: "aw.request.headers[\"X-Sig\"] = aw.secrets.get(\"SIGNING_KEY\")",
            postResponse: "aw.variables.set(\"userId\", aw.response.json().id)",
          },
        },
      },
      {
        nodeId: "me",
        type: "http-request",
        label: "Who am I",
        position: { x: 0, y: 0 },
        config: {
          method: "POST",
          url: "{{env.BASE_URL}}/graphql",
          bodyType: "graphql",
          graphql: { query: "query { me { id } }", variables: "{\"t\": \"{{variables.token}}\"}" },
        },
      },
      {
        nodeId: "check",
        type: "assertion",
        position: { x: 0, y: 0 },
        config: {
          assertions: [
            { source: "variables", path: "token", operator: "exists" },
            { source: "prev", path: "response.body.owner", operator: "equals", expectedValue: "{{variables.userId}}" },
          ],
        },
      },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "login" },
      { edgeId: "e2", source: "login", target: "me" },
      { edgeId: "e3", source: "me", target: "check" },
    ],
  })).workflowId
  // `updatedAt` has millisecond precision and paging breaks ties by id, so the
  // newer workflow must be created in a later millisecond to page first.
  await nextMillisecond()
  ordersId = (await runtime.deps.workflows.create(workspaceId, {
    name: "orders",
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      {
        nodeId: "call-auth",
        type: "workflow",
        position: { x: 0, y: 0 },
        config: { targetWorkflowId: authId, inputMapping: { seed: "{{variables.token}}" }, outputMapping: { orderId: "createdId" } },
      },
      {
        nodeId: "get-order",
        type: "http-request",
        label: "Fetch order",
        position: { x: 0, y: 0 },
        config: {
          method: "GET",
          url: "{{env.BASE_URL}}/orders/{{variables.orderId}}?expand=1",
          headers: [{ key: "Authorization", value: "Bearer {{variables.token}}" }],
        },
      },
      {
        nodeId: "list-orders",
        type: "http-request",
        position: { x: 0, y: 0 },
        config: { method: "GET", url: "{{env.BASE_URL}}/orders/{{variables.page}}" },
      },
      { nodeId: "watch", type: "sse", position: { x: 0, y: 0 }, config: { url: "{{env.BASE_URL}}/orders/stream" } },
    ],
    edges: [
      { edgeId: "o1", source: "start", target: "call-auth" },
      { edgeId: "o2", source: "call-auth", target: "get-order" },
    ],
  })).workflowId
})

afterEach(async () => {
  await close()
  runtime.db.close()
})

/** Wait until the wall clock has advanced past the current millisecond. */
async function nextMillisecond(): Promise<void> {
  const started = Date.now()
  do {
    await new Promise((resolve) => setTimeout(resolve, 1))
  } while (Date.now() === started)
}

/** Wait until the wall clock has moved past a timestamp the touch trigger stamped ahead of it. */
async function waitPast(timestamp: string): Promise<void> {
  const until = Date.parse(timestamp)
  while (Date.now() <= until) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; body: Record<string, unknown>; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  const text = result.content[0]?.text ?? "{}"
  return { text, body: JSON.parse(text.startsWith("{") ? text : "{}") as Record<string, unknown>, isError: result.isError === true }
}

async function search(args: Record<string, unknown>): Promise<SearchPage> {
  const { body, isError, text } = await call("workflows_searchNodes", { workspaceId, ...args })
  expect(isError, text).toBe(false)
  return body as SearchPage
}

async function workspaceMap(args: Record<string, unknown> = {}): Promise<{ page: MapPage; text: string }> {
  const { body, isError, text } = await call("workspaces_map", { workspaceId, ...args })
  expect(isError, text).toBe(false)
  return { page: body as MapPage, text }
}

function expectNoCanary(text: string): void {
  for (const canary of CANARIES) expect(text, canary).not.toContain(canary)
}

describe("tool surface", () => {
  it("publishes one node search and a read-only workspace map; the palette handler is gone", async () => {
    const names = MCP_TOOLS.map(toolName)
    expect(names.filter((name) => name.toLowerCase().includes("searchnodes"))).toEqual(["workflows_searchNodes"])
    const { tools } = await client.listTools()
    const map = tools.find((tool) => tool.name === "workspaces_map")
    expect(map?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(map?.description?.startsWith("Workspace map")).toBe(true)
    const router = new IpcRouter()
    registerAllHandlers(router, runtime.deps)
    expect(router.getRegistration("workflows", "searchWorkspaceNodes")).toBeUndefined()
    expect(router.getRegistration("workflows", "searchNodes")).toBeDefined()
  })
})

describe("workflows_searchNodes — workspace-wide", () => {
  it("finds every node on a route across workflows, with workflow identity, method and path", async () => {
    const page = await search({ query: "/orders" })
    expect(page.workflowId).toBeUndefined()
    expect(page.items.map((item) => item.nodeId).sort()).toEqual(["get-order", "list-orders", "watch"])
    expect(page.items.find((item) => item.nodeId === "get-order")).toEqual({
      workflowId: ordersId,
      workflowName: "orders",
      nodeId: "get-order",
      type: "http-request",
      label: "Fetch order",
      method: "GET",
      urlPath: "/orders/{{variables.orderId}}",
      matchedOn: ["urlPath"],
    })
    expect(page.items.find((item) => item.nodeId === "watch")).toMatchObject({ method: "GET", urlPath: "/orders/stream" })
  })

  it("keeps the one-workflow shape: page-level identity and neighbour context", async () => {
    const page = await search({ workflowId: ordersId, query: "fetch" })
    expect(page).toMatchObject({ workflowId: ordersId, rev: 1, totalMatched: 1, nextCursor: null })
    expect(page.items[0]).toMatchObject({ nodeId: "get-order", neighborNodeIds: ["call-auth"], method: "GET" })
    expect(page.items[0]?.workflowId).toBeUndefined()
  })

  it("narrows to one project with collectionId, and refuses it alongside workflowId", async () => {
    const page = await search({ collectionId: projectId, nodeTypes: ["http-request"] })
    expect(page.items.map((item) => item.nodeId).sort()).toEqual(["login", "me"])
    const both = await call("workflows_searchNodes", { workspaceId, workflowId: authId, collectionId: projectId, query: "x" })
    expect(both.isError).toBe(true)
  })

  it("pages with a cursor bound to the filters and the workflows' revisions", async () => {
    const first = await search({ query: "/orders", limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first).toMatchObject({ totalMatched: 3, omittedMatchCount: 1 })
    expect(first.nextCursor).not.toBeNull()
    const second = await search({ query: "/orders", limit: 2, cursor: first.nextCursor })
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map((item) => item.nodeId)).size).toBe(3)

    const otherFilter = await call("workflows_searchNodes", { workspaceId, query: "/order", limit: 2, cursor: first.nextCursor })
    expect(otherFilter.isError).toBe(true)
    expect(otherFilter.text).toContain("validation")

    await runtime.deps.workflows.patch(workspaceId, ordersId, { name: "orders v2" })
    const stale = await call("workflows_searchNodes", { workspaceId, query: "/orders", limit: 2, cursor: first.nextCursor })
    expect(stale.isError).toBe(true)
    expect(stale.text).toContain("conflict")
  })
})

describe("workflows_searchNodes — references", () => {
  async function uses(ref: string): Promise<Record<string, Match["references"]>> {
    const page = await search({ ref })
    for (const item of page.items) expect(item.matchedOn).toContain("ref")
    return Object.fromEntries(page.items.map((item) => [item.nodeId, item.references]))
  }

  it("classifies producers and consumers in every location", async () => {
    expect(await uses("variables.token")).toEqual({
      login: [{ field: "extractors", role: "produces" }],
      me: [{ field: "graphql", role: "consumes" }],
      check: [{ field: "assertions", role: "consumes" }],
      "call-auth": [{ field: "inputMapping", role: "consumes" }],
      "get-order": [{ field: "headers", role: "consumes" }],
    })
    expect(await uses("variables.userId")).toEqual({
      login: [{ field: "scripts", role: "produces" }],
      check: [{ field: "assertions", role: "consumes" }],
    })
    expect(await uses("variables.orderId")).toEqual({
      "call-auth": [{ field: "outputMapping", role: "produces" }],
      "get-order": [{ field: "url", role: "consumes" }],
    })
    expect(await uses("variables.term")).toEqual({ login: [{ field: "queryParams", role: "consumes" }] })
    expect(await uses("variables.traceId")).toEqual({ login: [{ field: "headers", role: "consumes" }] })
    expect(await uses("env.HOST")).toEqual({ login: [{ field: "url", role: "consumes" }] })
    expect(await uses("env.USER")).toEqual({ login: [{ field: "body", role: "consumes" }] })
    expect(await uses("secrets.SESSION")).toEqual({ login: [{ field: "cookies", role: "consumes" }] })
    expect(await uses("secrets.API_KEY")).toEqual({ login: [{ field: "auth", role: "consumes" }] })
    expect(await uses("secrets.SIGNING_KEY")).toEqual({ login: [{ field: "scripts", role: "consumes" }] })
    expect(await uses("secrets.NOPE")).toEqual({})
  })

  it("combines ref with query and nodeTypes, every filter holding", async () => {
    const page = await search({ ref: "variables.token", query: "fetch" })
    expect(page.items.map((item) => item.nodeId)).toEqual(["get-order"])
    expect(page.items[0]?.matchedOn).toEqual(["label", "ref"])
    const typed = await search({ ref: "variables.token", nodeTypes: ["assertion"] })
    expect(typed.items.map((item) => item.nodeId)).toEqual(["check"])
  })

  it("accepts names only, in the three namespaces", async () => {
    for (const ref of ["prev.body", "variables.a b", "{{variables.token}}", "secrets.", "variables.x.y"]) {
      const result = await call("workflows_searchNodes", { workspaceId, ref })
      expect(result.isError, ref).toBe(true)
    }
  })
})

describe("secret safety", () => {
  it("never matches or returns userinfo, query values, literal headers or bodies", async () => {
    for (const query of ["hunter2", "LEAKCANARY", "sk_live", "api_key", "Bearer", "password", "page=2", "bob"]) {
      const page = await search({ query })
      expect(page.totalMatched, query).toBe(0)
    }
    const login = await call("workflows_searchNodes", { workspaceId, query: "log in" })
    expectNoCanary(login.text)
    expect((login.body as SearchPage).items[0]?.urlPath).toBe("/v1/login")
    for (const ref of ["env.HOST", "env.USER", "secrets.API_KEY", "variables.userId"]) {
      expectNoCanary((await call("workflows_searchNodes", { workspaceId, ref })).text)
    }
    const { page, text } = await workspaceMap()
    expectNoCanary(text)
    const auth = page.items.find((entry) => entry.workflowId === authId)
    expect(auth?.endpoints).toEqual(["POST /v1/login", "POST /graphql"])
  })
})

describe("workspaces_map", () => {
  it("summarises each workflow from names and path templates", async () => {
    const runs = runtime.repositories.runs
    const older = runs.create({ workspaceId, workflowId: ordersId })
    runs.update(older.runId, { status: "completed" })
    const newest = runs.create({ workspaceId, workflowId: ordersId })
    runs.update(newest.runId, { status: "failed" })

    const { page } = await workspaceMap()
    expect(page.nextCursor).toBeNull()
    const orders = page.items.find((entry) => entry.workflowId === ordersId)
    expect(orders).toEqual({
      workflowId: ordersId,
      name: "orders",
      rev: 1,
      collectionId: null,
      // Placeholders collapse, so one route with two variables is one endpoint.
      endpoints: ["GET /orders/{{…}}", "GET /orders/stream"],
      produces: ["orderId"],
      consumes: ["token", "orderId", "page"],
      env: ["BASE_URL"],
      calls: [authId],
      lastRun: { runId: newest.runId, status: "failed" },
    })
    const auth = page.items.find((entry) => entry.workflowId === authId)
    expect(auth).toMatchObject({
      collectionId: projectId,
      produces: ["token", "userId"],
      env: ["HOST", "USER", "BASE_URL"],
      secrets: ["SESSION", "API_KEY", "SIGNING_KEY"],
    })
    expect(auth?.consumes?.sort()).toEqual(["term", "token", "traceId", "userId"])
    expect(auth?.lastRun).toBeUndefined()
    expect(auth?.calls).toBeUndefined()
  })

  it("reads the latest runs of a whole page in one query, never one per workflow", async () => {
    for (let index = 0; index < 5; index += 1) {
      const workflow = await runtime.deps.workflows.create(workspaceId, { name: `extra ${index}` })
      runtime.repositories.runs.create({ workspaceId, workflowId: workflow.workflowId })
    }
    const runs = runtime.repositories.runs
    const batched = vi.spyOn(runs, "latestRunsByWorkflow")
    const perWorkflow = [
      vi.spyOn(runs, "getLatestRun"),
      vi.spyOn(runs, "getLatestFailedRun"),
      vi.spyOn(runs, "listByWorkflow"),
      vi.spyOn(runs, "listRunSummaries"),
      vi.spyOn(runs, "getById"),
    ]
    const store = runtime.db.kvStore
    const query = vi.spyOn(store, "query")
    const get = vi.spyOn(store, "get")

    const { page } = await workspaceMap()
    expect(page.items).toHaveLength(7)
    expect(batched).toHaveBeenCalledOnce()
    for (const spy of perWorkflow) expect(spy).not.toHaveBeenCalled()
    const runQueries = [...query.mock.calls, ...get.mock.calls].filter(([sql]) => /\bFROM runs\b/.test(String(sql)))
    expect(runQueries).toHaveLength(1)
  })

  it("pages newest-updated first, narrows to a project, and caps long lists", async () => {
    const first = await workspaceMap({ limit: 1 })
    expect(first.page.items.map((entry) => entry.workflowId)).toEqual([ordersId])
    const second = await workspaceMap({ limit: 1, cursor: first.page.nextCursor })
    expect(second.page.items.map((entry) => entry.workflowId)).toEqual([authId])
    expect(second.page.nextCursor).toBeNull()
    const wrongScope = await call("workspaces_map", { workspaceId, collectionId: projectId, cursor: first.page.nextCursor })
    expect(wrongScope.isError).toBe(true)
    const patched = await runtime.deps.workflows.patch(workspaceId, authId, { name: "auth v2" })
    const stale = await call("workspaces_map", { workspaceId, limit: 1, cursor: first.page.nextCursor })
    expect(stale.isError).toBe(true)
    expect(stale.text).toContain("conflict")

    const project = await workspaceMap({ collectionId: projectId })
    expect(project.page.items.map((entry) => entry.workflowId)).toEqual([authId])

    // The touch trigger stamps an edit `rev + 1` milliseconds ahead of the wall
    // clock, so a workflow created before that offset passes would sort behind
    // `auth v2` (or tie with it and lose the id tie-break).
    await waitPast(patched.updatedAt)
    await runtime.deps.workflows.create(workspaceId, {
      name: "wide",
      nodes: Array.from({ length: 25 }, (_, index) => ({
        nodeId: `r${index}`,
        type: "http-request" as const,
        position: { x: 0, y: 0 },
        config: { method: "GET" as const, url: `{{env.BASE_URL}}/r${index}`, extractors: { [`v${index}`]: "response.body.id" } },
      })),
    })
    const wide = (await workspaceMap({ limit: 1 })).page.items[0]
    expect(wide?.name).toBe("wide")
    expect(wide?.endpoints).toHaveLength(20)
    expect(wide?.produces).toHaveLength(20)
    expect(wide?.omitted).toEqual({ endpoints: 5, produces: 5 })
  })
})
