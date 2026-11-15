import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { initDatabase, type InitializedDatabase } from "../../db"
import { RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { RunScheduler } from "../scheduler"
import { WorkflowExecutor, type ExecutorDeps, type RunArtifactInput, type WorkflowGraph, type WorkflowNode as RunnerNode } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { BrowserSession } from "../browser/session"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "./browser_test_channel"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import type { Run } from "@shared/types/Run"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowNode } from "@shared/types/WorkflowNode"

const SECRET_PASSWORD = "s3cret-pass-987"

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

/** The heading appears late, so checks have to wait for it rather than read once. */
const dashboardPage = (greeting: string): string => `<!doctype html><title>Dashboard</title><h1 id="h"></h1>
<label for="q">Query</label><input id="q" value="abc">
<a href="/orders/42" data-id="42">Order 42</a>
<button id="del">Delete</button><p id="status">idle</p>
<button onclick="window.open('/login')">Help</button>
<script>
const user = new URLSearchParams(location.search).get('user') || 'guest'
setTimeout(() => { document.getElementById('h').textContent = ${JSON.stringify(greeting)} + ' ' + user }, 300)
document.getElementById('del').onclick = () => {
  document.getElementById('status').textContent = confirm('Sure?') ? 'deleted' : 'kept'
}
</script>`

let channel: BrowserChannel | undefined
let server: Server
let base: string
/** What the dashboard greets with; a test changes it to make a check fail and then pass. */
let greeting = "Welcome"
/** What the `/outer` page embeds in its iframe; a test points it at another server. */
let frameSrc = ""

// The server comes first so `afterAll` always has one to close. Finding a
// browser launches up to three, which is slow on a loaded CI runner.
beforeAll(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0]
    if (path === "/api/profile") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: "Ada" }))
    } else if (path === "/login") {
      response.writeHead(200, { "content-type": "text/html" }).end(LOGIN_PAGE)
    } else if (path === "/dashboard") {
      response.writeHead(200, { "content-type": "text/html" }).end(dashboardPage(greeting))
    } else if (path === "/outer") {
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(`<!doctype html><title>Outer</title><h1>Outer</h1><iframe src="${frameSrc}" width="400" height="200"></iframe>`)
    } else {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  channel = await findTestBrowser()
}, BROWSER_SEARCH_TIMEOUT_MS)

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const step = (nodeId: string, config: Record<string, unknown>): WorkflowNode =>
  ({ nodeId, type: "browser", position: { x: 0, y: 0 }, config }) as WorkflowNode
const node = (nodeId: string, type: string, config?: Record<string, unknown>): WorkflowNode =>
  ({ nodeId, type, position: { x: 0, y: 0 }, ...(config ? { config } : {}) }) as WorkflowNode
const edge = (source: string, target: string): WorkflowEdge => ({ edgeId: `${source}-${target}`, source, target })
const role = (role: string, name?: string): Record<string, unknown> => ({ kind: "role", role, ...(name ? { name } : {}) })

function chain(...steps: WorkflowNode[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes = [node("start", "start"), ...steps, node("end", "end")]
  return { nodes, edges: nodes.slice(1).map((next, index) => edge(nodes[index]!.nodeId, next.nodeId)) }
}

const loginSteps = (password: string): WorkflowNode[] => [
  step("open", { action: "navigate", url: `${base}/login` }),
  step("email", { action: "fill", locator: role("textbox", "Email"), value: "{{variables.email}}" }),
  step("password", { action: "fill", locator: { kind: "label", value: "Password" }, value: password }),
]

function executorDeps(extra: Partial<ExecutorDeps> = {}): ExecutorDeps {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return { clock, rng, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng), browser: { channel: channel!, headless: true }, ...extra }
}

describe("browser steps in a real browser", { timeout: BROWSER_TEST_TIMEOUT_MS }, () => {
  let db: InitializedDatabase
  let workflows: WorkflowRepository
  let runs: RunRepository
  let scheduler: RunScheduler
  let workspaceId: string
  let artifacts: RunArtifactInput[]

  beforeEach((context) => {
    if (channel === undefined) context.skip()
    greeting = "Welcome"
    frameSrc = ""
    db = initDatabase({ databasePath: ":memory:" })
    workflows = new WorkflowRepository(db.kvStore)
    runs = new RunRepository(db.kvStore)
    workspaceId = new WorkspaceRepository(db.kvStore).create({ name: "Local", slug: "local" }).workspaceId
    artifacts = []
    const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
    const rng = new SeededRandomProvider("0xDEADBEEF")
    scheduler = new RunScheduler({
      runs, workflows, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng), clock, rng,
      resolveSecret: async (name) =>
        name === "TEST_PASSWORD" ? { plaintext: SECRET_PASSWORD, scopeType: "workspace" } : { plaintext: null, scopeType: null },
      browser: () => ({ channel: channel!, headless: true }),
      saveArtifact: (artifact) => {
        artifacts.push(artifact)
        return `artifact-${artifacts.length}`
      },
    })
  })

  afterEach(async () => {
    if (channel === undefined) return
    await scheduler.shutdown(500)
    db.close()
  })

  function create(steps: WorkflowNode[], variables: Record<string, unknown> = { email: "ada@example.com" }): string {
    return workflows.create({ workspaceId, name: "web", ...chain(...steps), variables }).workflowId
  }

  async function run(workflowId: string, resume?: { nodeId: string }): Promise<Run> {
    const runId = scheduler.enqueue({ workspaceId, workflowId, ...(resume ? { resume } : {}) })
    await scheduler.whenFinished(runId)
    return runs.getById(runId)!
  }

  const result = (stored: Run, nodeId: string) => stored.results.find((candidate) => candidate.nodeId === nodeId)

  it("runs HTTP and browser steps in one run, sharing variables", async () => {
    const workflowId = create([
      node("profile", "http-request", { method: "GET", url: `${base}/api/profile`, extractors: { name: "body.name" } }),
      ...loginSteps("{{secrets.TEST_PASSWORD}}"),
      step("submit", { action: "click", locator: role("button", "Sign in") }),
      step("greets", { action: "expect-text", locator: role("heading"), text: "Welcome ada@example.com", match: "equals" }),
      step("on-dashboard", { action: "expect-url", url: "/dashboard" }),
      step("query", { action: "expect-value", locator: { kind: "label", value: "Query" }, value: "abc" }),
      step("order", { action: "extract", locator: role("link", "Order {{variables.orderId}}"), from: "attribute", attribute: "data-id", variable: "order" }),
      step("title", { action: "extract", from: "title", variable: "pageTitle" }),
    ], { email: "ada@example.com", orderId: "42" })

    const stored = await run(workflowId)

    expect(stored.status, JSON.stringify(stored.results.map((r) => [r.nodeId, r.error]))).toBe("completed")
    expect(stored.variables).toMatchObject({ name: "Ada", order: "42", pageTitle: "Dashboard" })
    expect(result(stored, "greets")?.browser).toMatchObject({
      action: "expect-text",
      expected: "Welcome ada@example.com",
      actual: "Welcome ada@example.com",
      url: `${base}/dashboard?<REDACTED>`,
      title: "Dashboard",
    })
    expect(JSON.stringify(stored)).not.toContain(SECRET_PASSWORD)
    expect(artifacts).toHaveLength(0)
  })

  it.each([
    ["a secret", "{{secrets.TEST_PASSWORD}}", SECRET_PASSWORD],
    ["a literal", "literal-pass-123", "literal-pass-123"],
  ])("a failed check keeps a value-free error, the compared text and masked evidence (password from %s)", async (_label, password, typed) => {
    const workflowId = create([
      ...loginSteps(password),
      step("greets", { action: "expect-text", locator: role("heading"), text: "Welcome", match: "equals", timeoutMs: 600 }),
    ])

    const stored = await run(workflowId)

    expect(stored.status).toBe("failed")
    const failed = result(stored, "greets")!
    expect(failed.error).toBe("Browser step: the text of getByRole('heading') did not equal the expected text within 0.6s")
    expect(failed.browser).toMatchObject({ expected: "Welcome", actual: "Sign in", screenshotArtifactId: "artifact-1" })
    expect(failed.browser?.ariaSnapshot).toContain('textbox "Password": <SECRET>')
    expect(failed.browser?.ariaSnapshot).toContain("ada@example.com")
    expect(JSON.stringify(stored)).not.toContain(typed)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ runId: stored.runId, nodeId: "greets", kind: "screenshot", mime: "image/jpeg" })
    expect([...artifacts[0]!.body.subarray(0, 2)]).toEqual([0xff, 0xd8])
  })

  it("keeps the screenshot when a secret was typed into an ordinary text field", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/login` }),
      step("email", { action: "fill", locator: role("textbox", "Email"), value: "{{secrets.TEST_PASSWORD}}" }),
      step("greets", { action: "expect-text", locator: role("heading"), text: "Welcome", match: "equals", timeoutMs: 600 }),
    ])

    const stored = await run(workflowId)

    expect(stored.status).toBe("failed")
    const failed = result(stored, "greets")!
    expect(failed.browser).toMatchObject({ expected: "Welcome", actual: "Sign in", screenshotArtifactId: "artifact-1" })
    expect(failed.browser?.evidenceNote).toBeUndefined()
    expect(failed.browser?.ariaSnapshot).toContain('textbox "Email": <SECRET>')
    expect(JSON.stringify(stored)).not.toContain(SECRET_PASSWORD)
    expect(artifacts).toHaveLength(1)
    expect([...artifacts[0]!.body.subarray(0, 2)]).toEqual([0xff, 0xd8])
  })

  it("answers a confirm() only when the step says so", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/dashboard` }),
      step("delete", { action: "click", locator: role("button", "Delete"), dialog: "accept" }),
      step("deleted", { action: "expect-text", locator: { kind: "css", value: "#status" }, text: "deleted", match: "equals" }),
      step("again", { action: "click", locator: role("button", "Delete") }),
      step("kept", { action: "expect-text", locator: { kind: "css", value: "#status" }, text: "kept", match: "equals" }),
    ])

    const stored = await run(workflowId)

    expect(stored.status, JSON.stringify(stored.results.map((r) => [r.nodeId, r.error]))).toBe("completed")
  })

  it("fails a step that opens a new tab or window", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/dashboard` }),
      step("help", { action: "click", locator: role("button", "Help") }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "help")?.error).toBe("Browser step: the step opened a new tab or window, which browser steps do not support yet")
  })

  it("fails a step with an unset placeholder instead of typing the braces", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/login` }),
      step("email", { action: "fill", locator: role("textbox", "Email"), value: "{{env.TEST_EMAIL}}" }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "email")?.error).toBe("Browser step: {{env.TEST_EMAIL}} is not set")
  })

  it("names an ambiguous locator", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/login` }),
      step("field", { action: "fill", locator: role("textbox"), value: "x", timeoutMs: 1000 }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "field")?.error).toBe("Browser step: getByRole('textbox') matches 2 elements; add hasText, nth or within to pick one")
  })

  it("reruns a failed check from the start of the browser chain", async () => {
    const workflowId = create([
      node("profile", "http-request", { method: "GET", url: `${base}/api/profile` }),
      step("open", { action: "navigate", url: `${base}/dashboard?user=ada` }),
      step("greets", { action: "expect-text", locator: role("heading"), text: "Hello ada", match: "equals", timeoutMs: 1000 }),
    ])
    const source = await run(workflowId)
    expect(source.failedNodes).toEqual(["greets"])

    greeting = "Hello"
    const rerun = await run(workflowId, { nodeId: "greets" })

    expect(rerun.status).toBe("completed")
    expect(rerun.resumeFromNodeIds).toEqual(["open"])
    expect(rerun.results.map((stored) => stored.nodeId)).toEqual(["open", "greets"])
  })

  it("refuses to navigate to a host an agent-run was not approved for", async () => {
    const executor = new WorkflowExecutor(executorDeps({ http: new SafeHttp().restrictedTo(["api.example.com"]) }))
    const graph = chain(step("open", { action: "navigate", url: `${base}/login` })) as unknown as WorkflowGraph

    const output = await executor.executeWorkflow(graph)

    const host = new URL(base).host
    expect(output.results.find((stored) => stored.nodeId === "open")?.error).toBe(
      `Browser step: navigation to ${host} was refused: this run may only reach the hosts approved for it`,
    )
  })

  it("refuses to type a secret into an iframe on a host an agent-run was not approved for", async () => {
    const frameServer = createServer((_request, response) => {
      response
        .writeHead(200, { "content-type": "text/html" })
        .end('<!doctype html><title>Frame</title><label for="token">Token</label><input id="token" type="text">')
    })
    await new Promise<void>((resolve) => frameServer.listen(0, "127.0.0.1", resolve))
    const frameHost = `127.0.0.1:${(frameServer.address() as AddressInfo).port}`
    frameSrc = `http://${frameHost}/`
    try {
      const executor = new WorkflowExecutor(executorDeps({
        http: new SafeHttp().restrictedTo([new URL(base).host]),
        secrets: { TEST_PASSWORD: SECRET_PASSWORD },
      }))
      const graph = chain(
        step("open", { action: "navigate", url: `${base}/outer` }),
        step("token", { action: "fill", locator: { kind: "css", value: "#token", frame: "iframe" }, value: "{{secrets.TEST_PASSWORD}}" }),
      ) as unknown as WorkflowGraph

      const output = await executor.executeWorkflow(graph)

      expect(output.results.find((stored) => stored.nodeId === "token")?.error).toBe(
        `Browser step: typing a secret into ${frameHost} was refused: this run may only reach the hosts approved for it`,
      )
    } finally {
      await new Promise<void>((resolve) => frameServer.close(() => resolve()))
    }
  })

  it("shares the page with a called workflow", async () => {
    const login = chain(...loginSteps("pw"), step("submit", { action: "click", locator: role("button", "Sign in") }))
    const executor = new WorkflowExecutor(executorDeps({
      resolveWorkflow: (id) => (id === "login" ? { name: "Log in", nodes: login.nodes as unknown as RunnerNode[], edges: login.edges, variables: { email: "ada@example.com" } } : undefined),
    }))
    const graph = chain(
      node("call", "workflow", { targetWorkflowId: "login" }),
      step("greets", { action: "expect-text", locator: role("heading"), text: "Welcome ada@example.com" }),
    ) as unknown as WorkflowGraph

    const output = await executor.executeWorkflow(graph)

    expect(output.status, JSON.stringify(output.results.map((r) => [r.nodeId, r.error]))).toBe("passed")
  })

  it("stops before a node and leaves a caller-owned page as that node would find it", async () => {
    const session = new BrowserSession({ channel: channel!, headless: true })
    try {
      const executor = new WorkflowExecutor(executorDeps({ browserSession: session }))
      const graph = chain(
        step("open", { action: "navigate", url: `${base}/dashboard?user=ada` }),
        step("delete", { action: "click", locator: role("button", "Delete"), dialog: "accept" }),
      ) as unknown as WorkflowGraph

      const output = await executor.executeWorkflow(graph, { stopBeforeNodeId: "delete" })

      expect(output.results.map((stored) => stored.nodeId)).toEqual(["open"])
      const page = await session.currentPage()
      expect(page?.url()).toBe(`${base}/dashboard?user=ada`)
      expect(await page?.locator("#status").innerText()).toBe("idle")
    } finally {
      await session.close()
    }
  })
})

describe("browser steps without a browser", () => {
  it("refuses a for-each with concurrency above 1 into a workflow with browser steps", async () => {
    const child = chain(step("open", { action: "navigate", url: "http://127.0.0.1:1/" }))
    const executor = new WorkflowExecutor({
      ...executorDeps(),
      resolveWorkflow: () => ({ name: "Web", nodes: child.nodes as unknown as RunnerNode[], edges: child.edges }),
    })
    const graph = chain(
      node("each", "workflow", { targetWorkflowId: "web", forEach: { items: "[1,2]", itemVariable: "item", concurrency: 2 } }),
    ) as unknown as WorkflowGraph

    const output = await executor.executeWorkflow(graph)

    expect(output.results.find((stored) => stored.nodeId === "each")?.error).toBe(
      "Browser step: a for-each with concurrency above 1 cannot call a workflow with browser steps; set concurrency to 1",
    )
  })

  it("fails an invalid step without starting a browser", async () => {
    const executor = new WorkflowExecutor(executorDeps({ browser: { channel: "chromium", headless: true } }))
    const output = await executor.executeWorkflow(chain(step("bad", { action: "click" })) as unknown as WorkflowGraph)

    expect(output.results.find((stored) => stored.nodeId === "bad")?.error).toBe("Browser step: the step's configuration is invalid at locator")
  })

  // The refusal lands before any node runs, so no browser is launched: this is
  // testable with no browser on the machine.
  it("refuses a run whose page-driving nodes are on parallel branches", async () => {
    const child = chain(step("open", { action: "navigate", url: "http://127.0.0.1:1/" }))
    const login = { name: "Log in", nodes: child.nodes as unknown as RunnerNode[], edges: child.edges }
    const executor = new WorkflowExecutor({
      ...executorDeps(),
      resolveWorkflow: (id) => (id === "login" ? login : undefined),
    })
    const graph = {
      nodes: [
        node("start", "start"),
        node("login-a", "workflow", { targetWorkflowId: "login" }),
        node("login-b", "workflow", { targetWorkflowId: "login" }),
        node("end", "end"),
      ],
      edges: [edge("start", "login-a"), edge("start", "login-b"), edge("login-a", "end"), edge("login-b", "end")],
    } as unknown as WorkflowGraph

    const output = await executor.executeWorkflow(graph)

    expect(output.status).toBe("failed")
    expect(output.failureMessage).toMatch(/^Browser step: these nodes drive the run's page/)
    expect(output.results).toEqual([])
    expect([...output.failedNodes].sort()).toEqual(["login-a", "login-b"])
    expect(output.nodeStatuses["login-a"]).toBe("failed")
    expect(output.nodeStatuses["end"]).toBeUndefined()
  })

  it("refuses a browser step parallel to a call into a workflow with browser steps", async () => {
    const child = chain(step("open", { action: "navigate", url: "http://127.0.0.1:1/" }))
    const login = { name: "Log in", nodes: child.nodes as unknown as RunnerNode[], edges: child.edges }
    const executor = new WorkflowExecutor({
      ...executorDeps(),
      resolveWorkflow: (id) => (id === "login" ? login : undefined),
    })
    const graph = {
      nodes: [
        node("start", "start"),
        node("login", "workflow", { targetWorkflowId: "login" }),
        step("open", { action: "navigate", url: "http://127.0.0.1:1/" }),
        node("end", "end"),
      ],
      edges: [edge("start", "login"), edge("start", "open"), edge("login", "end"), edge("open", "end")],
    } as unknown as WorkflowGraph

    const output = await executor.executeWorkflow(graph)

    expect(output.status).toBe("failed")
    expect(output.failureMessage).toMatch(/^Browser step: these nodes drive the run's page/)
    expect([...output.failedNodes].sort()).toEqual(["login", "open"])
  })
})
