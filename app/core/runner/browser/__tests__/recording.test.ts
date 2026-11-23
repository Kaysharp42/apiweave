// fallow-ignore-file weakened-tests -- this suite drives a real browser and skips itself when none is installed, so a machine without one still passes.
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { Locator, Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../__tests__/browser_test_channel"
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep"
import { BrowserRecording, selectorImprovementKey } from "../recording"
import type { RecordingValues } from "../recording_values"
import { BrowserSession } from "../session"
import { runBrowserStep, type BrowserStepContext } from "../step"

const EMAIL = "ada@acme.test"
const PASSWORD = "fixture-pass-2468"

const LOGIN_PAGE = `<!doctype html><title>Sign in</title>
<h1>Sign in to Acme</h1>
<form onsubmit="event.preventDefault(); location.href = '/dashboard'">
  <label for="email">Email address</label><input id="email" type="email">
  <label for="pw">Password</label><input id="pw" type="password">
  <button type="submit">Sign in</button>
</form>`
const DASHBOARD_PAGE = `<!doctype html><title>Dashboard</title><h1>Dashboard</h1>`
/** A delete that asks for confirmation, and fields for the recorder toolbar's checks. */
const ORDERS_PAGE = `<!doctype html><title>Orders</title>
<h1>Orders</h1>
<ul><li>Order 42 <button onclick="if (confirm('Delete order 42?')) { this.closest('li').remove(); document.getElementById('msg').textContent = 'Order 42 deleted' }">Delete</button></li></ul>
<p id="msg">1 order</p>
<label for="ref">Reference</label><input id="ref" value="ACME-7">`
/**
 * One element per role, so Playwright writes a bare `internal:role=…` for each:
 * that is the selector the recording adds an accessible name to. The heading's
 * name holds the two characters those selectors escape, and `#box` is an element
 * no role names at all.
 */
const NAMES_PAGE = `<!doctype html><title>Names</title>
<h1>Say "hi" \\ now</h1>
<button>Continue</button>
<div id="box" style="width:120px;height:40px;background:#ccc"></div>`
const UNICODE_PAGE = `<!doctype html><title>Übersicht</title><h1>Café — Übersicht</h1>`
/**
 * A wizard that swaps its step in place, a moment after the click and without
 * changing the address, then a confirmation, and a link to another page. The
 * status message names the client typed into the field, so it is test data and
 * the heading beside it is checked instead.
 */
const WIZARD_PAGE = `<!doctype html><title>Offre</title>
<h1>Nouvelle offre</h1>
<label for="client">Client</label><input id="client">
<section id="step">
  <h2>Step 1</h2>
  <button onclick="later(() => { step.innerHTML = '<h2>Step 2</h2><button onclick=send()>Envoyer au Client</button>' })">Continuer</button>
  <button>Aide</button>
</section>
<div id="note"></div>
<a href="/sent">Terminer</a>
<script>
  function later(change) { setTimeout(change, 300) }
  function send() { later(() => { note.innerHTML = '<h3>Offre envoyée</h3><div role="status">Envoyée à ' + client.value + '</div>' }) }
</script>`
const SENT_PAGE = `<!doctype html><title>Sent</title><h1>Offres envoyées</h1>`
/** A heading with no accessible name, because its only content is an image without alt text. */
const NAMELESS_PAGE = `<!doctype html><title>Nameless</title>
<h2><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></h2>`
/**
 * A form a person fills before moving on, whose step swaps in place a moment
 * later. Clicking a field only puts the cursor in it, so no click into one may
 * hold the queue while the next step is typed and clicked.
 */
const CONTACT_PAGE = `<!doctype html><title>Details</title>
<h1>Your details</h1>
<label for="email">Email</label><input id="email" type="email">
<label for="pw">Password</label><input id="pw" type="password">
<label for="notes">Notes</label><textarea id="notes"></textarea>
<section id="step">
  <h2>Contact</h2>
  <button onclick="setTimeout(() => { document.getElementById('step').innerHTML = '<h2>Payment</h2><button>Pay</button>' }, 300)">Continuer</button>
</section>`
/**
 * A search that focuses its field when clicked and reports the query it found
 * a moment later: the text is typed while the click's outcome check would run,
 * so a check made then would hold it.
 */
const SEARCH_PAGE = `<!doctype html><title>Search</title>
<h1>Search</h1>
<label for="q">Query</label><input id="q">
<button onclick="document.getElementById('q').focus(); setTimeout(() => { document.getElementById('note').textContent = '3 results for ' + document.getElementById('q').value }, 150)">Rechercher</button>
<div id="note" role="status"></div>`
/** A page whose only content to click is inside an iframe, so its snapshot is another document. */
const FRAME_PAGE = `<!doctype html><title>Frame</title>
<h1>Frame demo</h1>
<iframe title="Inner" src="/frame-inner" style="width:320px;height:80px"></iframe>`
const FRAME_INNER = `<!doctype html><title>Inner</title><button>Ping</button>`

let channel: BrowserChannel | undefined
let server: Server
let base: string

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0]
    if (path === "/") response.writeHead(302, { location: "/login" }).end()
    else if (path === "/login") response.writeHead(200, { "content-type": "text/html" }).end(LOGIN_PAGE)
    else if (path === "/dashboard") response.writeHead(200, { "content-type": "text/html" }).end(DASHBOARD_PAGE)
    else if (path === "/orders") response.writeHead(200, { "content-type": "text/html" }).end(ORDERS_PAGE)
    // UTF-8 declared: without it the browser reads the page as windows-1252 and
    // every non-ASCII name it reports back is mojibake.
    else if (path === "/names") response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(NAMES_PAGE)
    else if (path === "/unicode") response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(UNICODE_PAGE)
    else if (path === "/nameless") response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(NAMELESS_PAGE)
    else if (path === "/wizard") response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(WIZARD_PAGE)
    else if (path === "/sent") response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SENT_PAGE)
    else if (path === "/contact") response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(CONTACT_PAGE)
    else if (path === "/search") response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SEARCH_PAGE)
    else if (path === "/frame") response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(FRAME_PAGE)
    else if (path === "/frame-inner") response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(FRAME_INNER)
    else response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  channel = await findTestBrowser()
}, BROWSER_SEARCH_TIMEOUT_MS)

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** Record the login flow, typing with real key events the way a user does. */
async function recordLogin(values: RecordingValues): Promise<{ sent: RecordedBrowserStep[]; steps: BrowserNodeData[]; ended: boolean }> {
  const sent: RecordedBrowserStep[] = []
  let ended = false
  let next = 0
  const recording = await BrowserRecording.start({
    launch: { headless: true, ...(channel === undefined ? {} : { channel }) },
    startUrl: `${base}/`,
    values,
    takenSecretNames: new Set(),
    newStepId: () => `browser-test-${++next}`,
    listener: { step: (step) => sent.push(step), warning: () => undefined, ended: () => (ended = true) },
    throttleMs: 20,
  })
  const page = recording.page
  if (page === null) throw new Error("no page")
  await page.getByLabel("Email address").click()
  await page.keyboard.type(EMAIL, { delay: 15 })
  await page.getByLabel("Password").click()
  await page.keyboard.type(PASSWORD, { delay: 15 })
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(`${base}/dashboard`)
  await recording.stop()
  const steps = new Map<string, BrowserNodeData>()
  for (const step of sent) steps.set(step.stepId, step.config)
  return { sent, steps: [...steps.values()], ended }
}

/** Fills `{{env.*}}` and `{{secrets.*}}` the way a run would, for replaying recorded steps. */
function replayContext(env: Readonly<Record<string, string>>, secrets: Readonly<Record<string, string>>): BrowserStepContext {
  return {
    resolve: (text, allowSecrets) =>
      text.replace(/\{\{(env|secrets)\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (whole, scope: string, name: string) =>
        (scope === "env" ? env[name] : allowSecrets ? secrets[name] : undefined) ?? whole,
      ),
    assertHostAllowed: () => undefined,
    maskValue: () => undefined,
    regexTest: async (pattern, text) => new RegExp(pattern).test(text),
    setVariable: () => undefined,
  }
}

/** Run `steps` in a fresh browser, as a workflow run would; the first failure's message, if any. */
async function replay(steps: readonly BrowserNodeData[], ctx: BrowserStepContext): Promise<string | undefined> {
  const session = new BrowserSession({ headless: true, ...(channel === undefined ? {} : { channel }) })
  try {
    for (const step of steps) {
      const outcome = await session.run((page) => runBrowserStep(page, step, ctx))
      if (outcome.error !== undefined) return outcome.error
    }
    return undefined
  } finally {
    await session.close()
  }
}

/**
 * Record on one page, from its start URL: `drive` does what the user does, in
 * order, and what comes back are the steps the canvas would get, each step's
 * last config once. The recording always starts with the navigate step.
 */
async function recordPage(
  path: string,
  drive: (page: Page) => Promise<void>,
): Promise<{ steps: BrowserNodeData[]; env: { BASE_URL: string } }> {
  const sent: RecordedBrowserStep[] = []
  const env = { BASE_URL: base }
  let next = 0
  const recording = await BrowserRecording.start({
    launch: { headless: true, ...(channel === undefined ? {} : { channel }) },
    startUrl: `${base}${path}`,
    values: { env, secrets: {} },
    takenSecretNames: new Set(),
    newStepId: () => `browser-test-${++next}`,
    listener: { step: (step) => sent.push(step), warning: () => undefined, ended: () => undefined },
    throttleMs: 20,
  })
  const page = recording.page
  try {
    if (page === null) throw new Error("no page")
    await drive(page)
  } finally {
    await recording.stop()
  }
  const byId = new Map<string, BrowserNodeData>()
  for (const step of sent) byId.set(step.stepId, step.config)
  return { steps: [...byId.values()], env }
}

type RecorderWindow = Window & { __pw_recorderSetMode(mode: string): void }

/**
 * Use one of the recorder toolbar's check modes on `target`, as a user does:
 * pick the mode and click the element. A text check opens an in-page box with
 * the element's text, confirmed with its ✓ or Ctrl+Enter (Enter is a new
 * line). `__pw_recorderSetMode` is what the toolbar's buttons call.
 */
async function checkWithToolbar(page: Page, mode: "assertingVisibility" | "assertingText" | "assertingValue", target: Locator): Promise<void> {
  await page.evaluate((next) => (window as unknown as RecorderWindow).__pw_recorderSetMode(next), mode)
  await page.waitForTimeout(150)
  await target.click()
  await page.waitForTimeout(250)
  if (mode === "assertingText") {
    await page.keyboard.press("Control+Enter")
    await page.waitForTimeout(250)
  }
  await page.evaluate(() => (window as unknown as RecorderWindow).__pw_recorderSetMode("recording"))
}

describe("BrowserRecording", () => {
  it(
    "records a login as one step per action, with the email and password as templates",
    async (context) => {
      if (channel === undefined) context.skip()
      const { sent, steps, ended } = await recordLogin({
        env: { BASE_URL: base, TEST_EMAIL: EMAIL },
        secrets: { TEST_PASSWORD: PASSWORD },
      })
      expect(steps).toEqual([
        { action: "navigate", url: "{{env.BASE_URL}}/login" },
        { action: "fill", locator: { kind: "role", role: "textbox", name: "Email address" }, value: "{{env.TEST_EMAIL}}" },
        { action: "fill", locator: { kind: "role", role: "textbox", name: "Password" }, value: "{{secrets.TEST_PASSWORD}}" },
        { action: "click", locator: { kind: "role", role: "button", name: "Sign in" } },
        // The sign-in moved to another page: the recording proves it.
        { action: "expect-url", url: "/dashboard", match: "contains" },
      ])
      expect(ended).toBe(true)
      // Not one keystroke of the password went out.
      expect(JSON.stringify(sent)).not.toContain(PASSWORD.slice(0, 4))
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "gives a password that is no stored secret a placeholder, and never sends what was typed",
    async (context) => {
      if (channel === undefined) context.skip()
      const { sent, steps } = await recordLogin({ env: {}, secrets: {} })
      expect(steps[2]).toEqual({
        action: "fill",
        locator: { kind: "role", role: "textbox", name: "Password" },
        value: "{{secrets.UNSET_PASSWORD_1}}",
      })
      // Any four characters of it would be a leak; shorter fragments occur in any JSON.
      for (const end of [4, 8, PASSWORD.length]) expect(JSON.stringify(sent)).not.toContain(PASSWORD.slice(0, end))
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "records steps that pass when run",
    async (context) => {
      if (channel === undefined) context.skip()
      const env: Record<string, string> = { BASE_URL: base, TEST_EMAIL: EMAIL }
      const secrets: Record<string, string> = { TEST_PASSWORD: PASSWORD }
      const { steps } = await recordLogin({ env, secrets })
      const check: BrowserNodeData = { action: "expect-text", locator: { kind: "role", role: "heading" }, text: "Dashboard", match: "equals" }
      expect(await replay([...steps, check], replayContext(env, secrets))).toBeUndefined()
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "names the roles Playwright leaves bare, with quotes and a backslash intact, and leaves CSS alone",
    async (context) => {
      if (channel === undefined) context.skip()
      const { steps, env } = await recordPage("/names", async (page) => {
        await page.getByRole("heading", { name: 'Say "hi" \\ now' }).click()
        await page.getByRole("button", { name: "Continue" }).click()
        await page.locator("#box").click()
      })
      expect(steps).toEqual([
        { action: "navigate", url: "{{env.BASE_URL}}/names" },
        { action: "click", locator: { kind: "role", role: "heading", name: 'Say "hi" \\ now' } },
        { action: "click", locator: { kind: "role", role: "button", name: "Continue" } },
        { action: "click", locator: { kind: "css", value: "#box" } },
      ])
      expect(await replay(steps, replayContext(env, {}))).toBeUndefined()
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "follows a click that changes the page with one check of what changed, and a click that changes nothing with none",
    async (context) => {
      if (channel === undefined) context.skip()
      // A person reads the page before the next click; the pause lets each click's outcome be read on its own.
      const pause = (page: Page): Promise<void> => page.waitForTimeout(1_500)
      const { steps, env } = await recordPage("/wizard", async (page) => {
        await page.getByLabel("Client").click()
        await page.keyboard.type("Jean Dupont", { delay: 15 })
        await page.getByRole("button", { name: "Aide" }).click()
        await pause(page)
        await page.getByRole("button", { name: "Continuer" }).click()
        await page.getByRole("heading", { name: "Step 2" }).waitFor()
        await pause(page)
        await page.getByRole("button", { name: "Envoyer au Client" }).click()
        await page.getByRole("heading", { name: "Offre envoyée" }).waitFor()
        await pause(page)
        await page.getByRole("link", { name: "Terminer" }).click()
        await page.waitForURL(`${base}/sent`)
      })
      expect(steps).toEqual([
        { action: "navigate", url: "{{env.BASE_URL}}/wizard" },
        { action: "fill", locator: { kind: "role", role: "textbox", name: "Client" }, value: "Jean Dupont" },
        { action: "click", locator: { kind: "role", role: "button", name: "Aide" } },
        { action: "click", locator: { kind: "role", role: "button", name: "Continuer" } },
        { action: "expect-visible", locator: { kind: "role", role: "heading", name: "Step 2", exact: true } },
        { action: "click", locator: { kind: "role", role: "button", name: "Envoyer au Client" } },
        // The status names the typed client, so the heading beside it is checked.
        { action: "expect-visible", locator: { kind: "role", role: "heading", name: "Offre envoyée", exact: true } },
        { action: "click", locator: { kind: "role", role: "link", name: "Terminer" } },
        { action: "expect-url", url: "/sent", match: "contains" },
      ])
      // The checks are what make the replay wait for each step of the wizard.
      expect(await replay(steps, replayContext(env, {}))).toBeUndefined()
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "does not hold the queue for the clicks that only focus a field, so the check of the click that follows keeps its place",
    async (context) => {
      if (channel === undefined) context.skip()
      const { steps, env } = await recordPage("/contact", async (page) => {
        await page.getByLabel("Email").click()
        await page.keyboard.type("ada@acme.test", { delay: 10 })
        await page.getByLabel("Password").click()
        await page.keyboard.type("fixture-pass-2468", { delay: 10 })
        await page.getByLabel("Notes").click()
        await page.keyboard.type("Please hurry", { delay: 10 })
        await page.getByRole("button", { name: "Continuer" }).click()
        await page.getByRole("heading", { name: "Payment" }).waitFor()
        // A person reads the new step before acting on it: the click's check is
        // done by then, unless the clicks into the fields held the queue.
        await page.waitForTimeout(1_500)
        await page.getByRole("button", { name: "Pay" }).click()
      })
      expect(steps).toEqual([
        { action: "navigate", url: "{{env.BASE_URL}}/contact" },
        { action: "fill", locator: { kind: "role", role: "textbox", name: "Email" }, value: "ada@acme.test" },
        { action: "fill", locator: { kind: "role", role: "textbox", name: "Password" }, value: "{{secrets.UNSET_PASSWORD_1}}" },
        { action: "fill", locator: { kind: "role", role: "textbox", name: "Notes" }, value: "Please hurry" },
        { action: "click", locator: { kind: "role", role: "button", name: "Continuer" } },
        { action: "expect-visible", locator: { kind: "role", role: "heading", name: "Payment", exact: true } },
        { action: "click", locator: { kind: "role", role: "button", name: "Pay" } },
      ])
      expect(await replay(steps, replayContext(env, { UNSET_PASSWORD_1: "fixture-pass-2468" }))).toBeUndefined()
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "adds no check while an action that may type the text it would hold is still queued",
    async (context) => {
      if (channel === undefined) context.skip()
      const { steps } = await recordPage("/search", async (page) => {
        await page.getByRole("button", { name: "Rechercher" }).click()
        // The page put the cursor in the field: these fills arrive while the
        // click's check would read the status the query appears in.
        await page.keyboard.type("acmecorp", { delay: 10 })
        await page.waitForTimeout(1_500)
      })
      expect(steps.map((step) => step.action)).toEqual(["navigate", "click", "fill"])
      expect(JSON.stringify(steps)).not.toContain("3 results for acmecorp")
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "adds no check for a click inside an iframe, whose before-snapshot is another document",
    async (context) => {
      if (channel === undefined) context.skip()
      const { steps, env } = await recordPage("/frame", async (page) => {
        await page.frameLocator("iframe").getByRole("button", { name: "Ping" }).click()
      })
      expect(steps).toEqual([
        { action: "navigate", url: "{{env.BASE_URL}}/frame" },
        { action: "click", locator: { kind: "role", role: "button", name: "Ping", frame: 'iframe[title="Inner"]' } },
      ])
      expect(await replay(steps, replayContext(env, {}))).toBeUndefined()
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "keeps a name that is not ASCII",
    async (context) => {
      if (channel === undefined) context.skip()
      const { steps, env } = await recordPage("/unicode", async (page) => {
        await page.getByRole("heading", { name: "Café — Übersicht" }).click()
      })
      expect(steps).toEqual([
        { action: "navigate", url: "{{env.BASE_URL}}/unicode" },
        { action: "click", locator: { kind: "role", role: "heading", name: "Café — Übersicht" } },
      ])
      expect(await replay(steps, replayContext(env, {}))).toBeUndefined()
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "leaves a role with no accessible name bare",
    async (context) => {
      if (channel === undefined) context.skip()
      const { steps, env } = await recordPage("/nameless", async (page) => {
        await page.locator("h2").click()
      })
      expect(steps).toEqual([
        { action: "navigate", url: "{{env.BASE_URL}}/nameless" },
        { action: "click", locator: { kind: "role", role: "heading" } },
      ])
      expect(await replay(steps, replayContext(env, {}))).toBeUndefined()
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "records the toolbar's checks and a confirmed dialog, and the steps pass when run",
    async (context) => {
      if (channel === undefined) context.skip()
      const sent: RecordedBrowserStep[] = []
      const warnings: string[] = []
      let next = 0
      const env = { BASE_URL: base }
      const recording = await BrowserRecording.start({
        launch: { headless: true, ...(channel === undefined ? {} : { channel }) },
        startUrl: `${base}/orders`,
        values: { env, secrets: {} },
        takenSecretNames: new Set(),
        newStepId: () => `browser-test-${++next}`,
        listener: { step: (step) => sent.push(step), warning: (message) => warnings.push(message), ended: () => undefined },
        throttleMs: 20,
      })
      const page = recording.page
      if (page === null) throw new Error("no page")
      await page.getByRole("button", { name: "Delete" }).click()
      // The recording clicked OK: the delete went through, as the user meant it to.
      await page.getByText("Order 42 deleted").waitFor()
      await checkWithToolbar(page, "assertingVisibility", page.getByRole("heading", { name: "Orders" }))
      // Playwright writes a bare `internal:role=heading` for a text check when
      // the page holds one heading; the recording adds its accessible name.
      await checkWithToolbar(page, "assertingText", page.getByRole("heading", { name: "Orders" }))
      await checkWithToolbar(page, "assertingText", page.locator("#msg"))
      await checkWithToolbar(page, "assertingValue", page.getByLabel("Reference"))
      await recording.stop()

      const byId = new Map<string, BrowserNodeData>()
      for (const step of sent) byId.set(step.stepId, step.config)
      const steps = [...byId.values()]
      expect(steps.map((step) => step.action)).toEqual([
        "navigate",
        "click",
        "expect-visible",
        "expect-text",
        "expect-text",
        "expect-value",
      ])
      expect(steps[0]).toEqual({ action: "navigate", url: "{{env.BASE_URL}}/orders" })
      expect(steps[1]).toEqual({ action: "click", locator: { kind: "role", role: "button", name: "Delete" }, dialog: "accept" })
      expect(steps[2]).toMatchObject({ locator: { kind: "role", role: "heading", name: "Orders" } })
      expect(steps[3]).toEqual({
        action: "expect-text",
        locator: { kind: "role", role: "heading", name: "Orders" },
        text: "Orders",
        match: "contains",
      })
      expect(steps[4]).toEqual({ action: "expect-text", locator: { kind: "css", value: "#msg" }, text: "Order 42 deleted", match: "contains" })
      expect(steps[5]).toMatchObject({ locator: { kind: "role", role: "textbox", name: "Reference" }, value: "ACME-7" })
      expect(warnings).toEqual([expect.stringContaining("The page showed a dialog")])

      expect(await replay(steps, replayContext(env, {}))).toBeUndefined()
      // Cancelling the dialog instead leaves the order, so the text check fails: the dialog field is what made it pass.
      const cancelled = steps.map((step): BrowserNodeData => {
        if (step.action === "click") return { ...step, dialog: "dismiss" }
        return step.action === "expect-text" ? { ...step, timeoutMs: 1_000 } : step
      })
      expect(await replay(cancelled, replayContext(env, {}))).toMatch(/locator\('#msg'\) did not contain the expected text/)
    },
    2 * BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "ends when the user closes the browser",
    async (context) => {
      if (channel === undefined) context.skip()
      let ended = 0
      const recording = await BrowserRecording.start({
        launch: { headless: true, ...(channel === undefined ? {} : { channel }) },
        startUrl: `${base}/login`,
        values: { env: {}, secrets: {} },
        takenSecretNames: new Set(),
        newStepId: () => "only",
        listener: { step: () => undefined, warning: () => undefined, ended: () => ended++ },
      })
      await recording.page?.close()
      await recording.stop()
      expect(ended).toBe(1)
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "fails to start, leaving nothing open and telling the listener nothing",
    async (context) => {
      if (channel === undefined) context.skip()
      const sent: RecordedBrowserStep[] = []
      let ended = 0
      await expect(
        BrowserRecording.start({
          launch: { headless: true, ...(channel === undefined ? {} : { channel }) },
          startUrl: "http://127.0.0.1:1/",
          values: { env: {}, secrets: {} },
          takenSecretNames: new Set(),
          newStepId: () => "x",
          listener: { step: (step) => sent.push(step), warning: () => undefined, ended: () => ended++ },
        }),
      ).rejects.toThrow(/^Browser step: the start page could not be opened/)
      // Closing the browser after a failed start must not look like the user ending a recording.
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(ended).toBe(0)
      expect(sent).toEqual([])
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "records on the page a replay left open, from the user's first action, and owns its browser",
    async (context) => {
      if (channel === undefined) context.skip()
      const session = new BrowserSession({ headless: true, ...(channel === undefined ? {} : { channel }) })
      const ctx = replayContext({}, {})
      // The replayed steps: the second arms a Cancel for a dialog it never opens.
      const replayed: BrowserNodeData[] = [
        { action: "navigate", url: `${base}/orders` },
        { action: "click", locator: { kind: "role", role: "heading", name: "Orders" }, dialog: "dismiss" },
      ]
      for (const step of replayed) expect((await session.run((page) => runBrowserStep(page, step, ctx))).error).toBeUndefined()
      const page = await session.currentPage()
      if (page === null) throw new Error("no page")

      const sent: RecordedBrowserStep[] = []
      const warnings: string[] = []
      let ended = false
      const recording = await BrowserRecording.attach(page, {
        values: { env: {}, secrets: {} },
        takenSecretNames: new Set(),
        newStepId: () => "browser-test-1",
        listener: { step: (step) => sent.push(step), warning: (message) => warnings.push(message), ended: () => (ended = true) },
        throttleMs: 20,
      })
      await page.getByRole("button", { name: "Delete" }).click()
      // The replayed step's Cancel was disarmed, so the recording's OK answered the confirm.
      await page.getByText("Order 42 deleted").waitFor()
      await recording.stop()

      expect(sent.map((step) => step.config).at(-1)).toEqual({
        action: "click",
        locator: { kind: "role", role: "button", name: "Delete" },
        dialog: "accept",
      })
      expect(new Set(sent.map((step) => step.stepId))).toEqual(new Set(["browser-test-1"]))
      // No popup warning for the page that was already open; only the dialog note.
      expect(warnings).toEqual([expect.stringContaining("The page showed a dialog")])
      expect(ended).toBe(true)
      // Stopping closed the replay's browser: the recording owns it now.
      expect(page.isClosed()).toBe(true)
      await session.close()
    },
    BROWSER_TEST_TIMEOUT_MS,
  )
})

describe("selectorImprovementKey", () => {
  it("improves the same raw selector independently on another page and for another action kind", () => {
    // A fragile selector such as this one repeats across pages, and the same
    // selector also comes back for a fill after the click that focused the
    // field: an answer computed for one must never be handed to another.
    const selector = "button >> nth=1"
    const onNewOfferAsClick = selectorImprovementKey("/offers/new", selector, true)
    expect(selectorImprovementKey("/offers/new", selector, true)).toBe(onNewOfferAsClick)
    expect(selectorImprovementKey("/offers/sent", selector, true)).not.toBe(onNewOfferAsClick)
    expect(selectorImprovementKey("/offers/new", selector, false)).not.toBe(onNewOfferAsClick)
  })
})
