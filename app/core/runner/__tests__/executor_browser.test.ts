import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { Page } from "playwright-core"
import { initDatabase, type InitializedDatabase } from "../../db"
import { RunRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { RunScheduler } from "../scheduler"
import { WorkflowExecutor, type ExecutorDeps, type RunArtifactInput, type WorkflowGraph, type WorkflowNode as RunnerNode } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { BrowserSession } from "../browser/session"
import { replayToNode } from "../../services/browser_replay"
import { pickElement, type PickOutcome } from "../browser/pick"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "./browser_test_channel"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import type { Run } from "@shared/types/Run"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowNode } from "@shared/types/WorkflowNode"

const SECRET_PASSWORD = "s3cret-pass-987"

/**
 * One test holds a settle open to cancel the run between its step passing and
 * its evidence being taken, which timing a real page cannot do reliably.
 * Every other test's settle goes straight through.
 */
const settleHold = vi.hoisted(() => ({ wait: undefined as (() => Promise<void>) | undefined }))

vi.mock("../browser/settle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../browser/settle")>()
  return {
    ...actual,
    settle: async (page: Page, maxMs: number, intervalMs?: number) => {
      if (settleHold.wait !== undefined) await settleHold.wait()
      return actual.settle(page, maxMs, intervalMs)
    },
  }
})

/** The login form's button; a test renames it, as a frontend change would. */
let loginLabel = "Sign in"

const loginPage = (): string => `<!doctype html><title>Sign in</title><h1>Sign in</h1>
<form id="f">
  <label for="email">Email</label><input id="email" type="email">
  <label for="pw">Password</label><input id="pw" type="password">
  <button type="submit">${loginLabel}</button>
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
<button onclick="window.open('/slow')">Help</button>
<script>
const user = new URLSearchParams(location.search).get('user') || 'guest'
setTimeout(() => { document.getElementById('h').textContent = ${JSON.stringify(greeting)} + ' ' + user }, 300)
document.getElementById('del').onclick = () => {
  document.getElementById('status').textContent = confirm('Sure?') ? 'deleted' : 'kept'
}
</script>`

/**
 * A page that leaves its `load` event behind still moving: its heading
 * changes every 40ms for `ms` after load, then it goes to `/arrived`, which
 * changes the URL and title too. It keeps changing while that navigation is
 * in flight, until `/arrived` replaces it: a heading frozen for the request's
 * round trip would be a still page, which settle rightly calls settled. So
 * settle sees two snapshots differ for as long as the page churns, whatever
 * interval it checks at, and these tests depend on what settle promises
 * rather than on when it happens to look.
 */
const unsettledPage = (ms: number): string => `<!doctype html><title>Before</title><h1>Before</h1>
<script>addEventListener('load', () => {
  const start = Date.now()
  let leaving = false
  const tick = () => {
    const elapsed = Date.now() - start
    if (elapsed >= ${ms} && !leaving) { leaving = true; location.href = '/arrived' }
    document.querySelector('h1').textContent = (leaving ? 'Leaving ' : 'Loading ') + elapsed
    setTimeout(tick, 40)
  }
  tick()
})</script>`

const arrivedPage = (): string => `<!doctype html><title>Arrived</title><h1>Arrived</h1><p>The page settled here.</p>`

/**
 * Widgets that misbehave the way real pages do: a select whose change handler
 * puts the old value back, a combobox popover that closes when focus leaves,
 * and a visually hidden radio.
 */
const widgetsPage = (): string => `<!doctype html><title>Widgets</title>
<label for="plan">Plan</label>
<select id="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
<label for="locked">Locked</label>
<select id="locked"><option value="a">Alpha</option><option value="b">Beta</option></select>
<input id="combo" aria-label="Country" autocomplete="off">
<ul id="pop" hidden><li><button id="pick">Norway</button></li></ul>
<button>Save draft</button><button>Save</button>
<script>
document.getElementById('locked').addEventListener('change', (event) => { event.target.value = 'a' })
const combo = document.getElementById('combo'), pop = document.getElementById('pop')
combo.addEventListener('focus', () => { pop.hidden = false })
combo.addEventListener('blur', () => { setTimeout(() => { if (!pop.contains(document.activeElement)) pop.hidden = true }, 0) })
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
      response.writeHead(200, { "content-type": "text/html" }).end(loginPage())
    } else if (path === "/dashboard") {
      response.writeHead(200, { "content-type": "text/html" }).end(dashboardPage(greeting))
    } else if (path === "/widgets") {
      response.writeHead(200, { "content-type": "text/html" }).end(widgetsPage())
    } else if (path === "/unsettled") {
      const ms = Number(new URLSearchParams((request.url ?? "").split("?")[1] ?? "").get("ms") ?? "300")
      response.writeHead(200, { "content-type": "text/html" }).end(unsettledPage(ms))
    } else if (path === "/arrived") {
      response.writeHead(200, { "content-type": "text/html" }).end(arrivedPage())
    } else if (path === "/slow") {
      // Slower than any click: Playwright reports a new tab only once its first page has loaded.
      setTimeout(() => response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Help</title>"), 1_500)
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
    loginLabel = "Sign in"
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

  it("replays up to a step in a browser the caller keeps, and leaves its page open", async () => {
    const workflowId = create([
      ...loginSteps("{{secrets.TEST_PASSWORD}}"),
      step("submit", { action: "click", locator: role("button", "Sign in") }),
      step("greets", { action: "expect-text", locator: role("heading"), text: "Welcome", match: "contains" }),
    ])
    const request = { workspaceId, workflowId, environmentId: null, stop: { beforeNodeId: "submit" } }
    const outcome = await replayToNode(scheduler, { channel: channel!, headless: true }, request, new AbortController().signal)
    expect(outcome.kind).toBe("page")
    if (outcome.kind !== "page") return
    try {
      // Stopped before the click: still on the filled-in login form.
      expect(outcome.page.url()).toBe(`${base}/login`)
      await expect(outcome.page.getByLabel("Email").inputValue()).resolves.toBe("ada@example.com")
    } finally {
      await outcome.close()
    }
    expect(outcome.page.isClosed()).toBe(true)
  })

  it("replays through a step, running it and nothing after it, and leaves the page it led to", async () => {
    const workflowId = create([
      ...loginSteps("{{secrets.TEST_PASSWORD}}"),
      step("submit", { action: "click", locator: role("button", "Sign in") }),
      step("greets", { action: "expect-text", locator: role("heading"), text: "Nobody", match: "contains", timeoutMs: 500 }),
    ])
    const request = { workspaceId, workflowId, environmentId: null, stop: { afterNodeId: "submit" } }
    const outcome = await replayToNode(scheduler, { channel: channel!, headless: true }, request, new AbortController().signal)
    // "greets" would fail: the replay passing shows it never ran.
    expect(outcome.kind).toBe("page")
    if (outcome.kind !== "page") return
    try {
      // The click ran: its navigation lands on the dashboard (throws if it never does).
      await outcome.page.waitForURL(/\/dashboard\?/, { timeout: 5_000 })
    } finally {
      await outcome.close()
    }
  })

  it("closes the replay's browser and says the run failed when a step before fails", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/login` }),
      step("missing", { action: "click", locator: role("button", "Nope"), timeoutMs: 500 }),
      step("submit", { action: "click", locator: role("button", "Sign in") }),
    ])
    const request = { workspaceId, workflowId, environmentId: null, stop: { beforeNodeId: "submit" } }
    const outcome = await replayToNode(scheduler, { channel: channel!, headless: true }, request, new AbortController().signal)
    expect(outcome).toMatchObject({ kind: "failed", status: "failed" })
  })

  it("fixes a step broken by a renamed button with one re-pick, and changes no other step", async () => {
    const workflowId = create([
      ...loginSteps("{{secrets.TEST_PASSWORD}}"),
      step("submit", { action: "click", locator: role("button", "Sign in"), timeoutMs: 1_000 }),
      step("greets", { action: "expect-text", locator: role("heading"), text: "Welcome", match: "contains" }),
    ])
    loginLabel = "Log in"
    const broken = await run(workflowId)
    expect(broken.failedNodes).toEqual(["submit"])

    const request = { workspaceId, workflowId, environmentId: null, stop: { beforeNodeId: "submit" } }
    const outcome = await replayToNode(scheduler, { channel: channel!, headless: true }, request, new AbortController().signal)
    if (outcome.kind !== "page") throw new Error(`replay: ${JSON.stringify(outcome)}`)
    let picked: PickOutcome
    try {
      const picking = pickElement(outcome.page, { env: {}, secrets: { TEST_PASSWORD: SECRET_PASSWORD } })
      await outcome.page.waitForTimeout(300)
      const box = await outcome.page.getByRole("button", { name: "Log in" }).boundingBox()
      if (box === null) throw new Error("no Log in button")
      await outcome.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      picked = await picking
    } finally {
      await outcome.close()
    }
    expect(picked).toEqual({ kind: "locator", locator: { kind: "role", role: "button", name: "Log in" } })
    if (picked.kind !== "locator") return

    // What the canvas does with it: the new locator on that step, nothing else.
    const before = workflows.getById(workflowId)!.nodes
    const nodes = before.map((candidate) =>
      candidate.nodeId === "submit" ? { ...candidate, config: { ...candidate.config, locator: picked.locator } } : candidate,
    ) as WorkflowNode[]
    workflows.update(workflowId, { nodes })
    const fixed = await run(workflowId)
    expect(fixed.status, JSON.stringify(fixed.results.map((r) => [r.nodeId, r.error]))).toBe("completed")
    const after = workflows.getById(workflowId)!.nodes
    expect(after.filter((candidate) => candidate.nodeId !== "submit")).toEqual(before.filter((candidate) => candidate.nodeId !== "submit"))
  })

  it("reports no page when no browser step runs before the node", async () => {
    const workflowId = create([step("open", { action: "navigate", url: `${base}/login` })])
    const request = { workspaceId, workflowId, environmentId: null, stop: { beforeNodeId: "open" } }
    const outcome = await replayToNode(scheduler, { channel: channel!, headless: true }, request, new AbortController().signal)
    expect(outcome).toEqual({ kind: "no-page" })
  })

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
      // A plain routing parameter stays legible, so the evidence says whose
      // dashboard this was; only secret-named parameters are withheld.
      url: `${base}/dashboard?user=ada%40example.com`,
      title: "Dashboard",
      // A passed step keeps its evidence too: the fifth browser step's screenshot.
      screenshotArtifactId: "artifact-5",
    })
    expect(result(stored, "greets")?.browser?.ariaSnapshot).toContain('heading "Welcome')
    expect(JSON.stringify(stored)).not.toContain(SECRET_PASSWORD)
    expect(artifacts).toHaveLength(9)
    expect(artifacts[4]).toMatchObject({ runId: stored.runId, nodeId: "greets", kind: "screenshot", mime: "image/jpeg" })
    expect([...artifacts[4]!.body.subarray(0, 2)]).toEqual([0xff, 0xd8])
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
    expect(failed.browser).toMatchObject({ expected: "Welcome", actual: "Sign in", screenshotArtifactId: "artifact-4" })
    expect(failed.browser?.ariaSnapshot).toContain('textbox "Password": <SECRET>')
    expect(failed.browser?.ariaSnapshot).toContain("ada@example.com")
    // A fill records what it typed; a password never.
    expect(result(stored, "email")?.browser?.actual).toBe("ada@example.com")
    expect(result(stored, "password")?.browser?.actual).toBe("<SECRET>")
    expect(JSON.stringify(stored)).not.toContain(typed)
    // Every browser step kept its evidence; the failed check is the fourth.
    expect(artifacts).toHaveLength(4)
    expect(artifacts[3]).toMatchObject({ runId: stored.runId, nodeId: "greets", kind: "screenshot", mime: "image/jpeg" })
    expect([...artifacts[3]!.body.subarray(0, 2)]).toEqual([0xff, 0xd8])
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
    expect(failed.browser).toMatchObject({ expected: "Welcome", actual: "Sign in", screenshotArtifactId: "artifact-3" })
    expect(failed.browser?.evidenceNote).toBeUndefined()
    expect(failed.browser?.ariaSnapshot).toContain('textbox "Email": <SECRET>')
    expect(result(stored, "email")?.browser?.actual).toBe("<SECRET>")
    expect(JSON.stringify(stored)).not.toContain(SECRET_PASSWORD)
    expect(artifacts).toHaveLength(3)
    expect(artifacts[2]).toMatchObject({ nodeId: "greets", kind: "screenshot", mime: "image/jpeg" })
    expect([...artifacts[2]!.body.subarray(0, 2)]).toEqual([0xff, 0xd8])
  })

  it("keeps a passed step's evidence from the page it settled on, not the page its action finished on", async () => {
    // The page churns for 200ms after load, then leaves: the navigate is done
    // well before that, and a passed step's 1s settle outlasts it.
    const workflowId = create([step("open", { action: "navigate", url: `${base}/unsettled?ms=200` })])

    const stored = await run(workflowId)

    expect(stored.status, JSON.stringify(stored.results.map((r) => [r.nodeId, r.error]))).toBe("completed")
    expect(result(stored, "open")?.browser).toMatchObject({ url: `${base}/arrived`, title: "Arrived" })
    expect(result(stored, "open")?.browser?.ariaSnapshot).toContain('heading "Arrived"')
  })

  it("keeps a plain parameter in a step's evidence URL and withholds a secret-named one", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/dashboard?user=ada&token=literal-ticket-9` }),
    ])

    const stored = await run(workflowId)

    expect(stored.status, JSON.stringify(stored.results.map((r) => [r.nodeId, r.error]))).toBe("completed")
    // The plain parameter says whose dashboard the evidence is of; the
    // secret-named one is withheld by name, not by cutting the whole query.
    expect(result(stored, "open")?.browser?.url).toBe(`${base}/dashboard?user=ada&token=<REDACTED>`)
    expect(JSON.stringify(stored)).not.toContain("literal-ticket-9")
  })

  it("takes no evidence of a step that passed when the run is cancelled while its page settles", async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered: () => void = () => undefined
    const settling = new Promise<void>((resolve) => {
      entered = resolve
    })
    settleHold.wait = async () => {
      entered()
      await held
    }
    try {
      const workflowId = create([step("open", { action: "navigate", url: `${base}/login` })])
      const runId = scheduler.enqueue({ workspaceId, workflowId })
      await settling
      // The step has passed and its settle holds; the cancel closes the page
      // underneath it, so capturing afterwards would evidence a dead page.
      expect(scheduler.cancel(runId)).toBe(true)
      release()
      expect(await scheduler.whenFinished(runId)).toBe("cancelled")

      const opened = result(runs.getById(runId)!, "open")
      expect(opened?.status).toBe("passed")
      expect(opened?.browser?.ariaSnapshot).toBeUndefined()
      expect(opened?.browser?.evidenceNote).toBeUndefined()
      expect(artifacts).toEqual([])
    } finally {
      settleHold.wait = undefined
    }
  })

  it("gives a failed step's evidence the fuller settle, where a page that changed late is the diagnosis", async () => {
    // The page churns for 3s after load. The navigate's 1s settle gives up
    // while it still churns, the check fails 300ms later, and only the failed
    // step's 3s settle lasts long enough to show what the page became.
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/unsettled?ms=3000` }),
      step("missing", { action: "expect-text", locator: role("heading"), text: "Never", match: "equals", timeoutMs: 300 }),
    ])

    const stored = await run(workflowId)

    expect(stored.status).toBe("failed")
    const failed = result(stored, "missing")!
    expect(failed.error).toBe("Browser step: the text of getByRole('heading') did not equal the expected text within 0.3s")
    // The evidence shows what the page became. What the check compared while
    // it polled is not asserted: on a loaded machine the steps before it can
    // outlast the churn, and the check then reads the arrived page itself.
    expect(failed.browser).toMatchObject({ url: `${base}/arrived`, title: "Arrived" })
    expect(failed.browser?.ariaSnapshot).toContain('heading "Arrived"')
    // FB-043: the passed navigate's own settle ran out while the page was
    // still moving, and its evidence says so — a click that starts a slow
    // change no longer looks like a no-op. (The navigate's 1s settle window
    // lies wholly inside the 3s churn, so this is deterministic; the failed
    // step's fuller settle is not asserted either way.)
    expect(result(stored, "open")?.browser?.evidenceNote).toBe(
      "The page was still changing when its evidence was taken.",
    )
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

  it("fails a step that opens a new tab or window, even one slow to load, and keeps driving its own page", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/dashboard` }),
      step("help", { action: "click", locator: role("button", "Help"), continueOnFail: true }),
      step("greeted", { action: "expect-text", locator: { kind: "css", value: "#h" }, text: "Welcome" }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "help")?.error).toBe("Browser step: the step opened a new tab or window, which browser steps do not support yet")
    expect(result(stored, "greeted")?.status, result(stored, "greeted")?.error).toBe("passed")
  })

  it("fails a step with an unset placeholder instead of typing the braces", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/login` }),
      step("email", { action: "fill", locator: role("textbox", "Email"), value: "{{env.TEST_EMAIL}}" }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "email")?.error).toBe("Browser step: {{env.TEST_EMAIL}} is not set")
  })

  it("finds an element by a name held in a workflow variable, and fails one whose variable is unset", async () => {
    const workflowId = create(
      [
        step("open", { action: "navigate", url: `${base}/login` }),
        step("email", { action: "fill", locator: role("textbox", "Email"), value: "ada@example.com" }),
        step("submit", { action: "click", locator: role("button", "{{variables.button}}") }),
        step("arrived", { action: "expect-url", url: "/dashboard", match: "contains" }),
        step("missing", { action: "click", locator: role("button", "{{variables.missing}}") }),
      ],
      { button: "Sign in" },
    )

    const stored = await run(workflowId)

    expect(result(stored, "submit")?.status, result(stored, "submit")?.error).toBe("passed")
    expect(result(stored, "arrived")?.status, result(stored, "arrived")?.error).toBe("passed")
    expect(result(stored, "missing")?.error).toBe("Browser step: {{variables.missing}} is not set")
  })

  it("names an ambiguous locator", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/login` }),
      step("field", { action: "fill", locator: role("textbox"), value: "x", timeoutMs: 1000 }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "field")?.error).toBe(
      "Browser step: getByRole('textbox') matches 2 elements (getByRole('textbox', { name: 'Email' }); getByRole('textbox', { name: 'Password' })); add hasText, nth or within to pick one",
    )
  })

  it("compares an expect-value by equality unless it asks for contains", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/dashboard` }),
      step("part", { action: "expect-value", locator: { kind: "label", value: "Query" }, value: "ab", match: "contains" }),
      step("pattern", { action: "expect-value", locator: { kind: "label", value: "Query" }, value: "^a.c$", match: "matches" }),
      step("whole", { action: "expect-value", locator: { kind: "label", value: "Query" }, value: "ab", timeoutMs: 300 }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "part")?.status, result(stored, "part")?.error).toBe("passed")
    expect(result(stored, "pattern")?.status, result(stored, "pattern")?.error).toBe("passed")
    expect(result(stored, "whole")?.error).toContain("did not equal the expected value")
  })

  it("passes a select the page keeps, and fails one whose handler puts the old value back", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/widgets` }),
      step("keeps", { action: "select", locator: { kind: "label", value: "Plan" }, values: ["Pro"] }),
      step("reverts", { action: "select", locator: { kind: "label", value: "Locked" }, values: ["b"], timeoutMs: 600 }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "keeps")?.status, result(stored, "keeps")?.error).toBe("passed")
    expect(result(stored, "keeps")?.browser).toMatchObject({ expected: "Pro", actual: "Pro" })
    expect(result(stored, "reverts")?.error).toContain("did not hold the selected option")
    expect(result(stored, "reverts")?.browser).toMatchObject({ expected: "b", actual: "Alpha" })
  })

  it("keeps a focus-opened popover open across the evidence taken between steps", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/widgets` }),
      step("focus", { action: "click", locator: { kind: "label", value: "Country" } }),
      step("shown", { action: "expect-visible", locator: role("button", "Norway") }),
      step("pick", { action: "press", locator: role("button", "Norway"), key: "Enter", timeoutMs: 1000 }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "pick")?.status, result(stored, "pick")?.error).toBe("passed")
  })

  it("says an element may have closed when a click cannot find what an earlier step saw", async () => {
    const workflowId = create([
      step("open", { action: "navigate", url: `${base}/widgets` }),
      step("focus", { action: "click", locator: { kind: "label", value: "Country" } }),
      step("shown", { action: "expect-visible", locator: role("button", "Norway") }),
      step("away", { action: "click", locator: role("button", "Save draft") }),
      step("closed", { action: "expect-visible", locator: role("button", "Norway"), visible: false }),
      step("pick", { action: "click", locator: role("button", "Norway"), timeoutMs: 500 }),
    ])

    const stored = await run(workflowId)

    expect(result(stored, "pick")?.error).toContain("it was not found (if an earlier step saw it, it may have closed or moved since)")
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

    expect(rerun.status, JSON.stringify(rerun.results.map((r) => [r.nodeId, r.error]))).toBe("completed")
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

  it("stops after a node: it runs, and nothing after it does", async () => {
    const session = new BrowserSession({ channel: channel!, headless: true })
    try {
      const executor = new WorkflowExecutor(executorDeps({ browserSession: session }))
      const graph = chain(
        step("open", { action: "navigate", url: `${base}/dashboard?user=ada` }),
        step("delete", { action: "click", locator: role("button", "Delete"), dialog: "accept" }),
      ) as unknown as WorkflowGraph

      const output = await executor.executeWorkflow(graph, { stopAfterNodeId: "open" })

      expect(output.results.map((stored) => stored.nodeId)).toEqual(["open"])
      expect(await (await session.currentPage())?.locator("#status").innerText()).toBe("idle")
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
