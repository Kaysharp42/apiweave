import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { initDatabase, type InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  NodePresetRepository,
  RunArtifactRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { ScopeResolver } from "../../services/scope_resolver"
import { WorkspaceService } from "../../services/workspace_service"
import { CollectionService } from "../../services/collection_service"
import { WorkflowService } from "../../services/workflow_service"
import { WorkflowAnalysisService } from "../../services/workflow_analysis_service"
import { AssertionAuthoringService } from "../../services/assertion_authoring_service"
import { EnvironmentService } from "../../services/environment_service"
import { NodePresetService } from "../../services/node_preset_service"
import { RunService } from "../../services/run_service"
import { SecretService, type SecretWriteStore } from "../../services/secret_service"
import { ProjectExportService } from "../../services/project_export_service"
import { IpcRouter } from "../../ipc/router"
import { registerAllHandlers } from "../../ipc/handlers"
import { RunScheduler, type AgentRunApprovalDecision } from "../../runner/scheduler"
import { DynamicFunctions } from "../../runner/dynamic_functions"
import { SafeHttp } from "../../runner/safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../../runner/harness/providers"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../runner/__tests__/browser_test_channel"
import { createMcpServer } from "../server"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import type { BrowserInspection } from "@shared/types/BrowserInspection"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowNode } from "@shared/types/WorkflowNode"

/**
 * `browser_inspect` end to end: an MCP client calls the tool, the router runs
 * the workflow through the real scheduler in a headless browser, and the page
 * comes back masked — over the same path an agent uses.
 */

const PASSWORD = "s3cret-pass-987"
const API_KEY = "key-shown-on-page-4821"

const LOGIN_PAGE = `<!doctype html><title>Sign in</title><h1>Sign in</h1>
<form id="f">
  <label for="email">Email</label><input id="email" type="email">
  <label for="pw">Password</label><input id="pw" type="password">
  <button type="submit">Sign in</button>
</form>
<script>
document.getElementById('f').addEventListener('submit', (event) => {
  event.preventDefault()
  location.href = '/dashboard?user=' + encodeURIComponent(document.getElementById('email').value)
})
</script>`

/** Shows the API key the run sent as a secret, so the masking of what a page displays is tested. */
const DASHBOARD_PAGE = `<!doctype html><title>Dashboard</title><h1>Welcome</h1><p>Your key: ${API_KEY}</p>`

/** Navigates a moment after the click, as a sign-in that waits for its API call does. */
const SLOW_PAGE = `<!doctype html><title>Slow</title>
<button onclick="setTimeout(() => { location.href = '/dashboard' }, 400)">Continue</button>`

let channel: BrowserChannel | undefined
let server: Server
let base: string

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0]
    if (path === "/api/profile") response.writeHead(200, { "content-type": "application/json" }).end("{}")
    else if (path === "/login") response.writeHead(200, { "content-type": "text/html" }).end(LOGIN_PAGE)
    else if (path === "/dashboard") response.writeHead(200, { "content-type": "text/html" }).end(DASHBOARD_PAGE)
    else if (path === "/slow") response.writeHead(200, { "content-type": "text/html" }).end(SLOW_PAGE)
    else response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  channel = await findTestBrowser()
}, BROWSER_SEARCH_TIMEOUT_MS)

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const node = (nodeId: string, type: string, config?: Record<string, unknown>): WorkflowNode =>
  ({ nodeId, type, position: { x: 0, y: 0 }, ...(config ? { config } : {}) }) as WorkflowNode
const step = (nodeId: string, config: Record<string, unknown>): WorkflowNode => node(nodeId, "browser", config)
const edge = (source: string, target: string): WorkflowEdge => ({ edgeId: `${source}-${target}`, source, target })

function chain(...steps: WorkflowNode[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes = [node("start", "start"), ...steps, node("end", "end")]
  return { nodes, edges: nodes.slice(1).map((next, index) => edge(nodes[index]!.nodeId, next.nodeId)) }
}

const loginFlow = (heading: string): WorkflowNode[] => [
  node("profile", "http-request", { method: "GET", url: `${base}/api/profile`, headers: [{ key: "X-Key", value: "{{secrets.API_KEY}}" }] }),
  step("open", { action: "navigate", url: `${base}/login` }),
  step("email", { action: "fill", locator: { kind: "role", role: "textbox", name: "Email" }, value: "ada@example.com" }),
  step("password", { action: "fill", locator: { kind: "label", value: "Password" }, value: "{{secrets.TEST_PASSWORD}}" }),
  step("submit", { action: "click", locator: { kind: "role", role: "button", name: "Sign in" } }),
  step("greets", { action: "expect-text", locator: { kind: "role", role: "heading" }, text: heading, match: "equals" }),
]

const noSecrets: SecretWriteStore = {
  put: () => {
    throw new Error("not used")
  },
  remove: () => false,
  listByScope: () => [],
  getByScopeAndName: () => null,
}

describe("browser_inspect over MCP", { timeout: BROWSER_TEST_TIMEOUT_MS }, () => {
  let db: InitializedDatabase
  let scheduler: RunScheduler
  let workflows: WorkflowRepository
  let runs: RunRepository
  let workspaceId: string
  let client: Client
  let approvals: number
  let approval: AgentRunApprovalDecision

  beforeEach(async (context) => {
    if (channel === undefined) context.skip()
    db = initDatabase({ databasePath: ":memory:" })
    const workspaceRepo = new WorkspaceRepository(db.kvStore)
    workflows = new WorkflowRepository(db.kvStore)
    runs = new RunRepository(db.kvStore)
    const environments = new EnvironmentRepository(db.kvStore)
    const collections = new CollectionRepository(db.kvStore)
    const artifacts = new RunArtifactRepository(db.kvStore)
    workspaceId = workspaceRepo.create({ name: "Local", slug: "local" }).workspaceId
    const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
    const rng = new SeededRandomProvider("0xDEADBEEF")
    approvals = 0
    approval = "once"
    scheduler = new RunScheduler({
      runs, workflows, environments, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng), clock, rng,
      resolveSecret: async (name) => {
        const plaintext = name === "TEST_PASSWORD" ? PASSWORD : name === "API_KEY" ? API_KEY : null
        return { plaintext, scopeType: plaintext === null ? null : "workspace" }
      },
      approveAgentRun: async () => {
        approvals += 1
        return approval
      },
      browser: () => ({ channel: channel!, headless: false }),
      saveArtifact: (artifact) => artifacts.save(artifact),
    })
    const scopeResolver = new ScopeResolver({
      workspaceExists: (id) => workspaceRepo.getById(id) !== undefined,
      environmentExists: (id) => environments.getById(id) !== undefined,
    })
    const workflowService = new WorkflowService(workflows, scopeResolver, collections, environments)
    const runService = new RunService(runs, scopeResolver, scheduler)
    const router = new IpcRouter()
    registerAllHandlers(router, {
      workspaces: new WorkspaceService(workspaceRepo, workflows, scopeResolver),
      collections: new CollectionService(collections, workflows, scopeResolver),
      workflows: workflowService,
      workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
      assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
      environments: new EnvironmentService(environments, scopeResolver),
      nodePresets: new NodePresetService(new NodePresetRepository(db.kvStore), scopeResolver),
      runs: runService,
      secrets: new SecretService(noSecrets, scopeResolver, environments, new Uint8Array(32)),
      projects: new ProjectExportService(collections, workflows, environments, scopeResolver, noSecrets, () => "2026-01-01T00:00:00.000Z"),
      runArtifacts: artifacts,
    })
    const mcp = createMcpServer(router, "test")
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverTransport as never)
    client = new Client({ name: "test-agent", version: "1.0.0" })
    await client.connect(clientTransport as never)
  })

  afterEach(async () => {
    if (channel === undefined) return
    await client.close()
    await scheduler.shutdown(500)
    db.close()
  })

  function create(steps: WorkflowNode[]): string {
    return workflows.create({ workspaceId, name: "web", ...chain(...steps) }).workflowId
  }

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: { workspaceId, ...args } })
    const content = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    const structured = result.structuredContent as { result: unknown } | undefined
    return { isError: result.isError === true, content, result: structured?.result }
  }

  it("returns the page as it was before a step, with what was typed masked, and records the run", async () => {
    const workflowId = create(loginFlow("Welcome"))
    const { isError, content, result } = await call("browser_inspect", { workflowId, beforeNodeId: "submit" })
    expect(isError).toBe(false)
    const inspection = result as BrowserInspection
    expect(inspection.status).toBe("completed")
    expect(inspection.stoppedBeforeNodeId).toBe("submit")
    expect(inspection.page?.url).toBe(`${base}/login`)
    expect(inspection.page?.title).toBe("Sign in")
    const snapshot = inspection.page?.ariaSnapshot?.preview ?? ""
    expect(snapshot).toContain('button "Sign in"')
    expect(snapshot).toContain("ada@example.com")
    expect(inspection.page?.ariaSnapshot?.previewTruncated).toBe(false)
    // An agent run with secrets asked first, like runs_create.
    expect(approvals).toBe(1)
    // Nothing the run typed or sent as a secret reaches the agent.
    const wire = JSON.stringify(content)
    expect(wire).not.toContain(PASSWORD)
    expect(wire).not.toContain(API_KEY)
    // No screenshot unless asked for.
    expect(content.some((item) => item.type === "image")).toBe(false)
    // The run is in history, and stopped where it was told to.
    const run = runs.getById(inspection.runId)!
    expect(run.results.map((stored) => stored.nodeId)).toEqual(expect.arrayContaining(["open", "email", "password"]))
    expect(run.results.some((stored) => stored.nodeId === "submit")).toBe(false)
  })

  it("reports a refusal as deniedByUser, and tells the agent not to inspect again", async () => {
    approval = "deny"
    const workflowId = create(loginFlow("Welcome"))
    const { isError, result } = await call("browser_inspect", { workflowId })
    expect(isError).toBe(false)
    const inspection = result as BrowserInspection
    expect(inspection).toMatchObject({ status: "failed", terminal: true, deniedByUser: true, page: null })
    expect(inspection.error).toContain("not allowed to send secrets")
    expect(inspection.note).toMatch(/do not call browser_inspect again/)
    expect(approvals).toBe(1)
  })

  it("runs the whole workflow, masks a secret the page shows, and sends the screenshot as image content", async () => {
    const workflowId = create(loginFlow("Welcome"))
    const { content, result } = await call("browser_inspect", { workflowId, screenshot: true })
    const inspection = result as BrowserInspection
    expect(inspection.status).toBe("completed")
    expect(inspection.stoppedBeforeNodeId).toBeUndefined()
    expect(inspection.page?.url).toBe(`${base}/dashboard?<REDACTED>`)
    expect(inspection.page?.ariaSnapshot?.preview).toContain("<SECRET>")
    const image = content.find((item) => item.type === "image")
    expect(image?.mimeType).toBe("image/jpeg")
    expect(Buffer.from(image?.data ?? "", "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    // The image travels once, as an image: not in the JSON text or the structured result.
    expect(JSON.stringify(result)).not.toContain("screenshot")
    expect(content.filter((item) => item.type === "text").map((item) => item.text).join("")).not.toContain(image?.data?.slice(0, 64))
    expect(JSON.stringify(content)).not.toContain(API_KEY)
  })

  it("waits for a navigation the last step set off before reading the page", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/slow` }),
      step("continue", { action: "click", locator: { kind: "role", role: "button", name: "Continue" } }),
    ])
    const { result } = await call("browser_inspect", { workflowId })
    const inspection = result as BrowserInspection
    expect(inspection.page?.url).toBe(`${base}/dashboard`)
    expect(inspection.page?.title).toBe("Dashboard")
  })

  it("says no page was open when no browser step ran before the node", async () => {
    const workflowId = create(loginFlow("Welcome"))
    const { result } = await call("browser_inspect", { workflowId, beforeNodeId: "open" })
    const inspection = result as BrowserInspection
    expect(inspection.page).toBeNull()
    expect(inspection.note).toMatch(/no page was open/i)
  })

  it("returns a runId at the deadline, and resumes on it without a second approval or run", async () => {
    const workflowId = create(loginFlow("Welcome"))
    const first = await call("browser_inspect", { workflowId, waitMs: 0 })
    expect(first.isError).toBe(false)
    const pending = first.result as BrowserInspection
    expect(pending.terminal).toBe(false)
    expect(["pending", "running"]).toContain(pending.status)
    expect(pending.page).toBeNull()
    expect(pending.note).toMatch(/browser_inspect with this runId/)

    const second = await call("browser_inspect", { runId: pending.runId, waitMs: 30_000 })
    expect(second.isError).toBe(false)
    const done = second.result as BrowserInspection
    expect(done).toMatchObject({ runId: pending.runId, terminal: true, status: "completed" })
    expect(done.page?.url).toBe(`${base}/dashboard?<REDACTED>`)
    expect(done.page?.ariaSnapshot?.preview).toContain('heading "Welcome"')
    // One run, one approval: the continuation only waits on the run it was given.
    expect(approvals).toBe(1)
    expect(runs.getById(pending.runId)?.status).toBe("completed")

    const again = await call("browser_inspect", { runId: pending.runId })
    expect(again.isError).toBe(true)
    expect(JSON.stringify(again.content)).toMatch(/browser_inspect with a workflowId/)
  })

  it("refuses runId together with workflowId", async () => {
    const workflowId = create(loginFlow("Welcome"))
    const { isError, content } = await call("browser_inspect", { workflowId, runId: "run-1" })
    expect(isError).toBe(true)
    expect(JSON.stringify(content)).toMatch(/exactly one of workflowId/)
  })

  it("refuses a node that is not in the workflow", async () => {
    const workflowId = create(loginFlow("Welcome"))
    const { isError, content } = await call("browser_inspect", { workflowId, beforeNodeId: "nope" })
    expect(isError).toBe(true)
    expect(JSON.stringify(content)).toMatch(/nope is not in workflow/)
  })

  it("sends a failed step's screenshot as image content through runs_getNodeResult when asked", async () => {
    const workflowId = create(loginFlow("Goodbye"))
    const created = await call("runs_create", { workflowId, waitMs: 30_000 })
    const runId = (created.result as { runId: string }).runId
    const evidence = await call("runs_getNodeResult", { runId, nodeId: "greets", sections: ["browser"], screenshot: true })
    const page = evidence.result as { items: Array<{ browser?: { hasScreenshot: boolean } }> }
    expect(page.items[0]?.browser?.hasScreenshot).toBe(true)
    expect(evidence.content.find((item) => item.type === "image")?.mimeType).toBe("image/jpeg")
    expect(JSON.stringify(evidence.result)).not.toContain("base64")

    const without = await call("runs_getNodeResult", { runId, nodeId: "greets", sections: ["browser"] })
    expect(without.content.some((item) => item.type === "image")).toBe(false)

    const several = await call("runs_getNodeResult", { runId, nodeIds: ["greets", "open"], screenshot: true })
    expect(several.isError).toBe(true)
  })
})
