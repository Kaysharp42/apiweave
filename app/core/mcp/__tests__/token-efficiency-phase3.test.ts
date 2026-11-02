import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { WorkflowNodeSchema, WorkflowNodeTypeSchema } from "@shared/zod-schemas"
import { createMcpBenchmarkRuntime, openMcpBenchmarkClient } from "../harness/services"
import type { McpBenchmarkRuntime } from "../harness/types"

/**
 * Token-efficiency Phase 3: the write tools advertise a loose node shape, an
 * agent learns per-type configs from `workflows_nodeSchema` and from precise
 * validation errors, and the router keeps validating against the real union.
 */

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean }
type Issue = { path: Array<string | number>; message: string }
type ErrorBody = { error: { code: string; message: string; details?: { issues?: Issue[] } } }

let runtime: McpBenchmarkRuntime
let client: Client
let close: () => Promise<void>
let workspaceId: string

beforeEach(async () => {
  runtime = createMcpBenchmarkRuntime()
  ;({ client, close } = await openMcpBenchmarkClient(runtime.deps))
  workspaceId = runtime.repositories.workspaces.create({ name: "P3", slug: "p3" }).workspaceId
})

afterEach(async () => {
  await close()
  runtime.db.close()
})

/** One tool call; counts every round so the trial can report how many it took. */
let rounds = 0
async function call(name: string, args: Record<string, unknown>): Promise<{ body: Record<string, unknown>; isError: boolean }> {
  rounds += 1
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  return { body: JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>, isError: result.isError === true }
}

function issuesOf(body: Record<string, unknown>): Issue[] {
  return (body as ErrorBody).error.details?.issues ?? []
}

describe("tool catalogue", () => {
  it("drops workflows_update and guides_list, and publishes workflows_nodeSchema as a read", async () => {
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name)
    expect(names).not.toContain("workflows_update")
    expect(names).not.toContain("guides_list")
    const nodeSchema = tools.find((tool) => tool.name === "workflows_nodeSchema")
    expect(nodeSchema?.annotations?.readOnlyHint).toBe(true)
    expect(nodeSchema?.inputSchema).toMatchObject({ properties: { type: { enum: WorkflowNodeTypeSchema.options } } })
  })

  it("marks exactly the five everyday tools alwaysLoad", async () => {
    const { tools } = await client.listTools()
    const alwaysLoaded = tools
      .filter((tool) => (tool._meta as Record<string, unknown> | undefined)?.["anthropic/alwaysLoad"] === true)
      .map((tool) => tool.name)
      .sort()
    expect(alwaysLoaded).toEqual(["runs_create", "workflows_debugContext", "workflows_get", "workflows_patch", "workflows_search"])
  })

  it("advertises loose node items on the write tools, never the union", async () => {
    const { tools } = await client.listTools()
    for (const [name, field] of [["workflows_create", "nodes"], ["workflows_patch", "upsertNodes"]] as const) {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as {
        additionalProperties?: unknown
        properties: Record<string, { items?: { properties?: Record<string, unknown>; oneOf?: unknown } }>
      }
      // The top level stays strict: an unknown argument is still refused.
      expect(schema.additionalProperties, name).toBe(false)
      const items = schema.properties[field]?.items
      expect(items?.oneOf, name).toBeUndefined()
      expect(items?.properties?.["type"], name).toMatchObject({ enum: WorkflowNodeTypeSchema.options })
      expect(items?.properties?.["config"], name).toMatchObject({ type: "object" })
      expect(JSON.stringify(schema).length, name).toBeLessThan(8_000)
    }
  })
})

describe("workflows_nodeSchema", () => {
  it("returns every type's config schema exactly as converted from the node union", async () => {
    const discriminants = WorkflowNodeSchema.options.map((member) => member.shape.type.value)
    expect([...discriminants].sort()).toEqual([...WorkflowNodeTypeSchema.options].sort())
    for (const member of WorkflowNodeSchema.options) {
      const type = member.shape.type.value
      const { body, isError } = await call("workflows_nodeSchema", { type })
      expect(isError, type).toBe(false)
      const expected: Record<string, unknown> = { ...z.toJSONSchema(member.shape.config.unwrap(), { target: "draft-7", io: "input" }) }
      delete expected["$schema"]
      expect(body["config"], type).toEqual(expected)
      expect(body["description"], type).toBe(member.description)
    }
  })

  it("rejects an unknown type", async () => {
    // The type enum is advertised, so the SDK refuses it before dispatch, as text.
    const result = (await client.callTool({ name: "workflows_nodeSchema", arguments: { type: "graphql" } })) as ToolResult
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("type")
  })
})

describe("scripted trial: learn a node's shape from the tool and the errors", () => {
  it("creates an http-request node with bearer auth and retry, and locates a bad config by node index", async () => {
    rounds = 0
    const schema = await call("workflows_nodeSchema", { type: "http-request" })
    const config = schema.body["config"] as { properties: Record<string, { properties?: Record<string, unknown> }> }
    expect(Object.keys(config.properties)).toEqual(expect.arrayContaining(["auth", "retry", "headers", "body"]))
    expect(config.properties["auth"]?.properties).toHaveProperty("bearer")
    expect(config.properties["retry"]?.properties).toHaveProperty("maxAttempts")

    const start = { nodeId: "start", type: "start" }
    const login = {
      nodeId: "login",
      type: "http-request",
      config: {
        method: "POST",
        url: "{{env.BASE_URL}}/login",
        auth: { type: "bearer", bearer: { token: "{{secrets.API_TOKEN}}" } },
        retry: { maxAttempts: 3, intervalMs: 500, backoff: "exponential" },
      },
    }
    const done = { nodeId: "done", type: "end" }
    const edges = [
      { edgeId: "e1", source: "start", target: "login" },
      { edgeId: "e2", source: "login", target: "done" },
    ]

    // A plausible first draft: the body as an object instead of its JSON text,
    // and the retry count under the wrong name. The SDK lets it through (config
    // is advertised open); the router's real schema rejects it with paths an
    // agent can act on.
    const draft = { ...login, config: { ...login.config, body: { user: "a" }, retry: { attempts: 3, intervalMs: 500 } } }
    const rejected = await call("workflows_create", { workspaceId, name: "login", nodes: [start, draft, done], edges })
    expect(rejected.isError).toBe(true)
    expect((rejected.body as ErrorBody).error).toMatchObject({ code: "validation", message: "request validation failed" })
    const paths = issuesOf(rejected.body).map((issue) => issue.path)
    expect(paths).toEqual(expect.arrayContaining([
      ["nodes", 1, "config", "body"],
      expect.arrayContaining(["nodes", 1, "config", "retry"]),
    ]))
    expect(rejected.body).not.toHaveProperty("result")

    // Header maps are a legacy shape the router canonicalizes, not an error:
    // the loose advertisement must not get in the way of that either.
    const created = await call("workflows_create", {
      workspaceId,
      name: "login",
      nodes: [start, { ...login, config: { ...login.config, headers: { Accept: "application/json" } } }, done],
      edges,
    })
    expect(created.isError).toBe(false)
    const workflowId = (created.body["result"] as { workflowId: string }).workflowId

    const read = await call("workflows_get", { workspaceId, workflowId, nodeIds: ["login"] })
    const stored = (read.body["nodes"] as Array<{ config: Record<string, unknown> }>)[0]!.config
    expect(stored["auth"]).toEqual({ type: "bearer", bearer: { token: "{{secrets.API_TOKEN}}" } })
    expect(stored["retry"]).toEqual({ maxAttempts: 3, intervalMs: 500, backoff: "exponential" })
    expect(stored["headers"]).toEqual([{ key: "Accept", value: "application/json" }])

    // nodeSchema, one rejected draft, the corrected create, the read-back.
    expect(rounds).toBe(4)
  })
})

describe("the loose advertisement never weakens dispatch validation", () => {
  it("lets unknown node keys through the SDK so the router rejects them with the node's path", async () => {
    const createBad = await call("workflows_create", {
      workspaceId,
      name: "x",
      nodes: [{ nodeId: "a", type: "delay", config: { duration: 1 }, bogus: true }],
    })
    expect(createBad.isError).toBe(true)
    expect(issuesOf(createBad.body).some((issue) => issue.path[0] === "nodes" && issue.path[1] === 0)).toBe(true)

    const { workflowId } = await runtime.deps.workflows.create(workspaceId, { name: "y" })
    const patchBad = await call("workflows_patch", {
      workspaceId,
      workflowId,
      upsertNodes: [{ nodeId: "n", type: "http-request", config: { method: "FETCH" } }],
    })
    expect(patchBad.isError).toBe(true)
    const issue = issuesOf(patchBad.body).find((item) => item.path.includes("method"))
    expect(issue?.path.slice(0, 2)).toEqual(["upsertNodes", 0])
    expect(issue?.message).toContain('nodeId "n"')
  })
})

describe("workflows_patch covers what workflows_update did for agents", () => {
  it("replaces tags", async () => {
    const { workflowId } = await runtime.deps.workflows.create(workspaceId, { name: "tagged", tags: ["old"] })
    const patched = await call("workflows_patch", { workspaceId, workflowId, tags: ["smoke", "auth"] })
    expect(patched.isError).toBe(false)
    expect((await runtime.deps.workflows.get(workspaceId, workflowId)).tags).toEqual(["smoke", "auth"])
    const found = await call("workflows_search", { workspaceId, tags: ["smoke"] })
    expect((found.body["items"] as Array<{ workflowId: string }>).map((item) => item.workflowId)).toEqual([workflowId])
  })
})
