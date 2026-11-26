import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { createMcpBenchmarkRuntime, openMcpBenchmarkClient } from "../harness/services"
import type { McpBenchmarkRuntime } from "../harness/types"
import { MCP_TOOLS } from "../tools"

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean }

let runtime: McpBenchmarkRuntime
let client: Client
let close: () => Promise<void>
let workspaceId: string

beforeEach(async () => {
  runtime = createMcpBenchmarkRuntime()
  ;({ client, close } = await openMcpBenchmarkClient(runtime.deps))
  workspaceId = runtime.repositories.workspaces.create({ name: "Surface", slug: "surface" }).workspaceId
})

afterEach(async () => {
  await close()
  runtime.db.close()
})

async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  return { text: result.content[0]?.text ?? "", isError: result.isError === true }
}

describe("secrets_list", () => {
  it("lists the workspace scope when only workspaceId is given", async () => {
    const list = vi.spyOn(runtime.deps.secrets, "list")
    const result = await call("secrets_list", { workspaceId })
    expect(result.isError).toBe(false)
    expect(list).toHaveBeenCalledWith(workspaceId, "workspace", workspaceId)
  })

  it("still needs the environment id for an environment scope", async () => {
    const result = await call("secrets_list", { workspaceId, scopeType: "environment" })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("scopeId")
  })
})

describe("a project's id", () => {
  it("is collectionId, and the project carries no projectId", async () => {
    const created = await call("projects_create", { workspaceId, name: "Checkout" })
    const project = JSON.parse(created.text) as Record<string, unknown>
    expect(project["collectionId"]).toEqual(expect.any(String))
    expect(project).not.toHaveProperty("projectId")
  })

  it("is explained on the project tools, naming the ones that call it projectId", () => {
    for (const spec of MCP_TOOLS.filter((tool) => tool.domain === "projects" && ["create", "get", "update", "delete", "list", "run", "listRuns", "export"].includes(tool.action))) {
      expect(spec.description, spec.action).toContain("A project's id is its `collectionId`; projects_run, projects_listRuns and projects_export call that same id `projectId`.")
    }
  })
})
