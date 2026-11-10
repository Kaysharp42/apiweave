import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ToolListChangedNotificationSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { IpcRouter } from "../../ipc/router"
import { registerAllHandlers } from "../../ipc/handlers"
import { createMcpBenchmarkRuntime } from "../harness/services"
import type { McpBenchmarkRuntime } from "../harness/types"
import { McpHost } from "../host"
import { McpLauncher } from "../launcher/launcher"
import { MCP_CATALOG_FILE, MCP_TOKEN_FILE, readCatalog } from "../launcher/contract"

let dataDir: string
let runtime: McpBenchmarkRuntime
let host: McpHost
let agent: Client | null = null
let launcher: McpLauncher | null = null

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "apiweave-mcp-launcher-"))
  runtime = createMcpBenchmarkRuntime()
  const router = new IpcRouter()
  registerAllHandlers(router, runtime.deps)
  host = new McpHost({
    router,
    tokenFilePath: join(dataDir, MCP_TOKEN_FILE),
    catalogFilePath: join(dataDir, MCP_CATALOG_FILE),
    version: "test",
    preferredPort: 0,
  })
})

afterEach(async () => {
  await agent?.close()
  await launcher?.close()
  agent = null
  launcher = null
  await host.stop()
  runtime.db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

/** An agent connected to a launcher over an in-memory pair, as an agent is over stdio. */
async function connectAgent(options: { startApp?: () => void; startTimeoutMs?: number } = {}): Promise<Client> {
  const [agentSide, launcherSide] = InMemoryTransport.createLinkedPair()
  launcher = new McpLauncher({ agent: launcherSide as never, dataDir, retryIntervalMs: 20, ...options })
  await launcher.start()
  agent = new Client({ name: "launcher-test-agent", version: "1" })
  await agent.connect(agentSide as never)
  return agent
}

/** The app ran once with MCP on, then quit: its token and catalog are on disk, nothing is listening. */
async function appRanBefore(): Promise<void> {
  await host.start()
  await host.stop()
}

function text(result: unknown): string {
  const content = (result as CallToolResult).content[0]
  return content?.type === "text" ? content.text : ""
}

describe("McpLauncher", () => {
  it("answers the handshake and the lists from the catalog while the app is closed, and starts it", async () => {
    await appRanBefore()
    let started = 0
    const client = await connectAgent({ startApp: () => void (started += 1) })

    expect(client.getServerVersion()?.name).toBe("APIWeave")
    expect(client.getInstructions()).toBe(readCatalog(join(dataDir, MCP_CATALOG_FILE))?.instructions)
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toContain("workflows_search")
    // Started once, after finding nothing listening — not once per request.
    await expect.poll(() => started).toBe(1)
  })

  it("passes a tool call to the app once it has started, then lets the agent re-read the lists", async () => {
    await appRanBefore()
    const client = await connectAgent({ startApp: () => void host.start() })
    let listChanged = 0
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      listChanged += 1
    })
    await client.listTools()

    const result = await client.callTool({ name: "server_info", arguments: {} })

    expect(result.isError).toBeFalsy()
    expect(text(result)).toContain("APIWeave")
    expect(host.getSessionCount()).toBe(1)
    await expect.poll(() => listChanged).toBe(1)
  })

  it("serves the same tool list the app serves", async () => {
    await host.start()
    const client = await connectAgent({ startApp: () => undefined })
    await client.callTool({ name: "server_info", arguments: {} })

    const live = await client.listTools()

    expect(live.tools).toEqual(readCatalog(join(dataDir, MCP_CATALOG_FILE))?.tools.tools)
  })

  it("opens a new session when the app restarts underneath it", async () => {
    await host.start()
    const client = await connectAgent({ startApp: () => void host.start() })
    await client.callTool({ name: "server_info", arguments: {} })

    // A restart takes a fresh ephemeral port here, written to the token file.
    await host.stop()
    await host.start()
    const result = await client.callTool({ name: "workspaces_list", arguments: {} })

    expect(result.isError, text(result)).toBeFalsy()
    expect(host.getSessionCount()).toBe(1)
  })

  it("tells the agent what to do when the app never comes up", async () => {
    await appRanBefore()
    const client = await connectAgent({ startApp: () => undefined, startTimeoutMs: 100 })

    const result = await client.callTool({ name: "server_info", arguments: {} })

    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/did not start its MCP server.*Settings → MCP Server is on/)
  })

  it("says the app has to be opened once when it has never recorded how to start", async () => {
    await appRanBefore()
    const client = await connectAgent()

    const result = await client.callTool({ name: "server_info", arguments: {} })

    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/has not been opened on this computer yet/)
  })
})
