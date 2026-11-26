import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  BrowserNodeDataSchema,
  DelayNodeDataSchema,
  HTTPNodeDataSchema,
  WorkflowNodeSchema,
} from "@shared/zod-schemas"
import { createMcpBenchmarkRuntime, openMcpBenchmarkClient } from "../harness/services"
import type { McpBenchmarkRuntime } from "../harness/types"

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean }

let runtime: McpBenchmarkRuntime
let client: Client
let close: () => Promise<void>
let workspaceId: string

beforeEach(async () => {
  runtime = createMcpBenchmarkRuntime()
  ;({ client, close } = await openMcpBenchmarkClient(runtime.deps))
  workspaceId = runtime.repositories.workspaces.create({ name: "Hints", slug: "hints" }).workspaceId
})

afterEach(async () => {
  await close()
  runtime.db.close()
})

async function text(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  return { text: result.content[0]?.text ?? "", isError: result.isError === true }
}

const start = { nodeId: "start", type: "start" }
const done = { nodeId: "done", type: "end" }
const edges = [{ edgeId: "e1", source: "start", target: "wait" }, { edgeId: "e2", source: "wait", target: "done" }]

function delayWith(config: Record<string, unknown>): Record<string, unknown> {
  return { nodeId: "wait", type: "delay", config: { duration: 1, ...config } }
}

describe("a node field put inside config", () => {
  it("leaves each config's JSON Schema exactly as the data schema alone produces it", () => {
    const raw = new Map<string, z.ZodType>([
      ["delay", DelayNodeDataSchema],
      ["http-request", HTTPNodeDataSchema],
      ["browser", BrowserNodeDataSchema],
    ])
    for (const member of WorkflowNodeSchema.options) {
      const original = raw.get(member.shape.type.value)
      if (original === undefined) continue
      const options = { target: "draft-7", io: "input" } as const
      expect(z.toJSONSchema(member.shape.config.unwrap(), options), member.shape.type.value).toEqual(z.toJSONSchema(original, options))
    }
  })

  it("says where a description belongs when a non-browser config carries one", () => {
    const parsed = WorkflowNodeSchema.safeParse(delayWith({ description: "wait a bit" }))
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(
      'Unrecognized key "description". Put text on the node `label` (only browser steps have a description).',
    )
  })

  it("accepts a description on a browser step and still hints node-level keys there", () => {
    const step = { nodeId: "go", type: "browser", config: { action: "navigate", url: "https://example.test", description: "open" } }
    expect(WorkflowNodeSchema.safeParse(step).success).toBe(true)
    const bad = WorkflowNodeSchema.safeParse({ ...step, config: { ...step.config, position: { x: 1, y: 2 } } })
    expect(bad.error?.issues[0]?.message).toContain("`position` belongs on the node, not in `config`.")
  })

  it("keeps zod's own message for a config that is not an object", () => {
    const parsed = WorkflowNodeSchema.safeParse({ nodeId: "wait", type: "delay", config: "5" })
    expect(parsed.error?.issues[0]?.message).toMatch(/expected object/i)
  })

  it.each([
    ["description", /Put text on the node `label`/],
    ["label", /`label` belongs on the node, not in `config`/],
    ["position", /`position` belongs on the node, not in `config`/],
    ["parentId", /`parentId` belongs on the node, not in `config`/],
  ])("workflows_create and workflows_patch name the fix for %s", async (key, hint) => {
    const create = await text("workflows_create", {
      workspaceId,
      name: "x",
      nodes: [start, delayWith({ [key]: "a" }), done],
      edges,
    })
    expect(create.isError).toBe(true)
    expect(create.text).toMatch(hint)

    const made = await text("workflows_create", { workspaceId, name: "x", nodes: [start, delayWith({}), done], edges })
    const stored = JSON.parse(made.text) as { result: { workflowId: string; rev: number } }
    const patch = await text("workflows_patch", {
      workspaceId,
      workflowId: stored.result.workflowId,
      expectedRevision: stored.result.rev,
      upsertNodes: [delayWith({ [key]: "a" })],
    })
    expect(patch.isError).toBe(true)
    expect(patch.text).toMatch(hint)
  })
})
